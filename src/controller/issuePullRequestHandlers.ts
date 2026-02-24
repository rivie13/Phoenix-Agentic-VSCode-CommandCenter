import * as vscode from "vscode";
import type {
  CommentPullRequestFromViewPayload,
  CreateIssueFromViewPayload,
  CreatePullRequestFromViewPayload,
  IssueCreateMetadataRequestPayload
} from "./CommandCenterPayloads";
import type { CommandCenterViewProvider } from "../providers/CommandCenterViewProvider";
import type { DataService, RefreshReason } from "../services/DataService";
import type { BoardItem, DashboardSnapshot, ProjectFieldName } from "../types";
import type { AgentModelCatalogPayload } from "../utils/agentModelCatalog";
import {
  buildIssueTemplateBody,
  sanitizeIssueBoardFields,
  sanitizeIssueTemplatePayload,
  suggestPlannedBranch
} from "../utils/issueTemplates";
import { repoUrlToSlug } from "../utils/workspace";

export interface PendingBoardUiAction {
  tab: "board" | "issues" | "actions" | "pullRequests";
  openIssueCreate?: boolean;
  openPullRequestCreate?: boolean;
  preferredRepo?: string | null;
}

interface IssuePullRequestHandlersDeps {
  dataService: DataService;
  boardViewProvider: Pick<CommandCenterViewProvider, "show" | "hasView" | "postMessage">;
  getSnapshot: () => DashboardSnapshot | null;
  setPendingBoardUiAction: (value: PendingBoardUiAction | null) => void;
  getRuntimeSettings: () => ReturnType<DataService["getSettings"]>;
  resolveCurrentWorkspaceContext: () => Promise<{ repoSlug: string | null; branch: string | null; workspace: string | null } | null>;
  resolveAvailableMcpToolIds: () => string[];
  resolveAgentModelCatalog: (settings: ReturnType<DataService["getSettings"]>) => Promise<AgentModelCatalogPayload>;
  refreshNow: (reason: RefreshReason) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  postWebviewResponse: (sourceWebview: vscode.Webview | undefined, type: string, payload: unknown) => Promise<void>;
}

function findBoardItemByRepoAndIssueNumber(snapshot: DashboardSnapshot | null, repo: string, issueNumber: number): BoardItem | null {
  if (!snapshot || !Number.isFinite(issueNumber) || issueNumber <= 0) {
    return null;
  }
  const normalizedRepo = repoUrlToSlug(repo).toLowerCase();
  return snapshot.board.items.find((item) => (
    item.issueNumber === issueNumber
    && repoUrlToSlug(item.repo).toLowerCase() === normalizedRepo
  )) ?? null;
}

async function applyIssueBoardFieldUpdates(
  deps: IssuePullRequestHandlersDeps,
  repo: string,
  issueNumber: number | null,
  boardFields: ReturnType<typeof sanitizeIssueBoardFields>
): Promise<string[]> {
  const updates: Array<{ field: ProjectFieldName; value: string }> = [];
  if (boardFields.status) updates.push({ field: "Status", value: boardFields.status });
  if (boardFields.workMode) updates.push({ field: "Work mode", value: boardFields.workMode });
  if (boardFields.priority) updates.push({ field: "Priority", value: boardFields.priority });
  if (boardFields.size) updates.push({ field: "Size", value: boardFields.size });
  if (boardFields.area) updates.push({ field: "Area", value: boardFields.area });

  if (updates.length === 0) {
    return [];
  }
  if (!issueNumber) {
    return ["Project field updates skipped because the issue number could not be resolved."];
  }

  let boardItem = findBoardItemByRepoAndIssueNumber(deps.getSnapshot(), repo, issueNumber);
  for (let attempt = 0; !boardItem && attempt < 3; attempt += 1) {
    await deps.refreshNow("write");
    boardItem = findBoardItemByRepoAndIssueNumber(deps.getSnapshot(), repo, issueNumber);
    if (!boardItem) {
      await deps.sleep(450);
    }
  }
  if (!boardItem) {
    return ["Project field updates are pending because the issue is not visible on the board yet."];
  }

  const warnings: string[] = [];
  for (const update of updates) {
    try {
      await deps.dataService.updateProjectField(boardItem, update.field, update.value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to set ${update.field}: ${message}`);
    }
  }
  return warnings;
}

export async function issueCreateMetadataRequest(
  deps: IssuePullRequestHandlersDeps,
  payload: IssueCreateMetadataRequestPayload,
  sourceWebview?: vscode.Webview
): Promise<void> {
  const requestedRepo = typeof payload.repo === "string" ? payload.repo.trim() : "";
  const workspaceContext = await deps.resolveCurrentWorkspaceContext();
  const repo = requestedRepo || workspaceContext?.repoSlug || "";
  const fieldOptions: Record<"status" | "workMode" | "priority" | "size" | "area", string[]> = {
    status: [],
    workMode: [],
    priority: [],
    size: [],
    area: []
  };
  const fieldMap: Array<{ field: ProjectFieldName; key: "status" | "workMode" | "priority" | "size" | "area" }> = [
    { field: "Status", key: "status" },
    { field: "Work mode", key: "workMode" },
    { field: "Priority", key: "priority" },
    { field: "Size", key: "size" },
    { field: "Area", key: "area" }
  ];

  let labels: string[] = [];
  let errorMessage = "";
  try {
    await Promise.all(
      fieldMap.map(async ({ field, key }) => {
        const options = await deps.dataService.getFieldOptions(field);
        fieldOptions[key] = options;
      })
    );
    if (repo) {
      labels = await deps.dataService.getRepositoryLabels(repo);
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  const defaultType: "Epic" | "Feature" | "Subfeature" = "Subfeature";
  const defaultBaseBranch = workspaceContext?.repoSlug === repo && workspaceContext.branch
    ? workspaceContext.branch
    : "main";

  await deps.postWebviewResponse(sourceWebview, "issueCreateMetadata", {
    repo,
    labels,
    fieldOptions,
    defaults: {
      baseBranch: defaultBaseBranch,
      plannedBranch: suggestPlannedBranch(defaultType, repo, "")
    },
    error: errorMessage || undefined
  });
}

export async function createIssueFromView(
  deps: IssuePullRequestHandlersDeps,
  payload: CreateIssueFromViewPayload,
  sourceWebview?: vscode.Webview
): Promise<void> {
  const repo = typeof payload.repo === "string" ? payload.repo.trim() : "";
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const additionalBody = typeof payload.body === "string" ? payload.body : "";
  const labels = Array.isArray(payload.labels)
    ? payload.labels
        .map((entry) => String(entry ?? "").trim())
        .filter((entry) => entry.length > 0)
    : [];
  const template = sanitizeIssueTemplatePayload(payload.template, repo, title);
  const boardFields = sanitizeIssueBoardFields(payload.boardFields);

  const missing: string[] = [];
  if (!repo) missing.push("repository");
  if (!title) missing.push("title");
  if (!template.baseBranch) missing.push("base branch");
  if (!template.plannedBranch) missing.push("planned branch");
  if (!template.problemStatement) missing.push("problem statement");
  if (!template.scopeIn) missing.push("scope in");
  if (!template.definitionOfDone) missing.push("definition of done");
  if (!template.validationPlan) missing.push("validation plan");
  if (template.type !== "Epic" && !template.parentLinks) missing.push("parent links");

  if (missing.length > 0) {
    await deps.postWebviewResponse(sourceWebview, "issueCreateResult", {
      ok: false,
      repo,
      message: `Missing required fields: ${missing.join(", ")}.`
    });
    return;
  }

  const body = buildIssueTemplateBody(repo, template, additionalBody);

  try {
    const createdIssue = await deps.dataService.createIssue(repo, title, body, labels);
    const fieldWarnings = await applyIssueBoardFieldUpdates(deps, repo, createdIssue.number, boardFields);
    await deps.refreshNow("write");
    const issueSuffix = createdIssue.number ? ` (#${createdIssue.number})` : "";
    const warningSuffix = fieldWarnings.length > 0 ? ` ${fieldWarnings.join(" ")}` : "";
    const successMessage = `Issue created in ${repo}${issueSuffix}.${warningSuffix}`.trim();
    await deps.postWebviewResponse(sourceWebview, "issueCreateResult", {
      ok: true,
      repo,
      issueNumber: createdIssue.number,
      message: successMessage
    });
    vscode.window.showInformationMessage(successMessage);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await deps.postWebviewResponse(sourceWebview, "issueCreateResult", {
      ok: false,
      repo,
      message: errorMessage
    });
    vscode.window.showErrorMessage(`Phoenix Command Center write failed: ${errorMessage}`);
  }
}

export async function createPullRequestFromView(
  deps: IssuePullRequestHandlersDeps,
  payload: CreatePullRequestFromViewPayload,
  sourceWebview?: vscode.Webview
): Promise<void> {
  const repo = typeof payload.repo === "string" ? payload.repo.trim() : "";
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const body = typeof payload.body === "string" ? payload.body : "";
  const head = typeof payload.head === "string" ? payload.head.trim() : "";
  const base = typeof payload.base === "string" ? payload.base.trim() : "";
  const draft = Boolean(payload.draft);

  if (!repo || !title || !head || !base) {
    await deps.postWebviewResponse(sourceWebview, "pullRequestCreateResult", {
      ok: false,
      repo,
      message: "Repository, title, head branch, and base branch are required."
    });
    return;
  }

  try {
    await deps.dataService.createPullRequest({
      repo,
      title,
      body,
      head,
      base,
      draft
    });
    const successMessage = `Pull request created in ${repo}.`;
    await deps.postWebviewResponse(sourceWebview, "pullRequestCreateResult", {
      ok: true,
      repo,
      message: successMessage
    });
    vscode.window.showInformationMessage(successMessage);
    await deps.refreshNow("write");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await deps.postWebviewResponse(sourceWebview, "pullRequestCreateResult", {
      ok: false,
      repo,
      message: errorMessage
    });
    vscode.window.showErrorMessage(`Phoenix Command Center write failed: ${errorMessage}`);
  }
}

export async function commentPullRequestFromView(
  deps: IssuePullRequestHandlersDeps,
  payload: CommentPullRequestFromViewPayload,
  sourceWebview?: vscode.Webview
): Promise<void> {
  const repo = typeof payload.repo === "string" ? payload.repo.trim() : "";
  const number = typeof payload.number === "number" ? payload.number : Number(payload.number ?? 0);
  const body = typeof payload.body === "string" ? payload.body.trim() : "";

  if (!repo || !Number.isFinite(number) || number <= 0 || !body) {
    await deps.postWebviewResponse(sourceWebview, "pullRequestCommentResult", {
      ok: false,
      repo,
      number,
      message: "Repository, pull request number, and comment body are required."
    });
    return;
  }

  try {
    await deps.dataService.commentPullRequest(repo, number, body);
    const successMessage = `Comment posted on PR #${number}.`;
    await deps.postWebviewResponse(sourceWebview, "pullRequestCommentResult", {
      ok: true,
      repo,
      number,
      message: successMessage
    });
    vscode.window.showInformationMessage(successMessage);
    await deps.refreshNow("write");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await deps.postWebviewResponse(sourceWebview, "pullRequestCommentResult", {
      ok: false,
      repo,
      number,
      message: errorMessage
    });
    vscode.window.showErrorMessage(`Phoenix Command Center write failed: ${errorMessage}`);
  }
}

export async function postRuntimeContext(
  deps: IssuePullRequestHandlersDeps,
  sourceWebview?: vscode.Webview
): Promise<void> {
  const settings = deps.getRuntimeSettings();
  const workspaceContext = await deps.resolveCurrentWorkspaceContext();
  const modelCatalog = await deps.resolveAgentModelCatalog(settings);
  const payload = {
    repositories: settings.repositories,
    workspaceRepo: workspaceContext?.repoSlug ?? null,
    workspaceBranch: workspaceContext?.branch ?? null,
    mcpTools: deps.resolveAvailableMcpToolIds(),
    modelCatalog,
    dispatchConfig: {
      codexCliPath: settings.codexCliPath,
      copilotCliPath: settings.copilotCliPath,
      codexDefaultModel: settings.codexDefaultModel || null,
      copilotDefaultModel: settings.copilotDefaultModel || null,
      copilotCloudEnabled: settings.copilotCloudEnabled
    }
  };
  await deps.postWebviewResponse(sourceWebview, "runtimeContext", payload);
}

export async function openCommandCenterForTabAction(
  deps: IssuePullRequestHandlersDeps,
  payload: PendingBoardUiAction
): Promise<void> {
  deps.setPendingBoardUiAction(payload);
  const revealed = deps.boardViewProvider.show(false);
  if (!revealed) {
    try {
      await vscode.commands.executeCommand("workbench.view.extension.phoenixOps");
    } catch {
      // Best effort only: continue even if container reveal command is unavailable.
    }
    deps.boardViewProvider.show(false);
  }
  await postRuntimeContext(deps);
  if (deps.boardViewProvider.hasView()) {
    await deps.boardViewProvider.postMessage("uiAction", payload);
    deps.setPendingBoardUiAction(null);
  }
}
