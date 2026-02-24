import * as vscode from "vscode";
import type {
  AgentCommandDecisionPayload,
  AgentDispatchPayload,
  AgentMessagePayload,
  AgentStopPayload,
  GitApiLike,
  GitExtensionApiLike
} from "./CommandCenterPayloads";
import type { DataService, RefreshReason } from "../services/DataService";
import type { DashboardSnapshot } from "../types";
import { repoUrlToSlug } from "../utils/workspace";

export interface AgentRuntimeHandlersDeps {
  dataService: DataService;
  getRuntimeSettings: () => ReturnType<DataService["getSettings"]>;
  getSnapshot: () => DashboardSnapshot | null;
  refreshNow: (reason: RefreshReason) => Promise<void>;
  openSessionPanel: (sessionId: string) => Promise<void>;
  openUrl: (url: string) => Promise<void>;
  postContextResponse: (sourceWebview: vscode.Webview | undefined, type: "contextAdded" | "contextError", payload: unknown) => Promise<void>;
}

export function normalizeToolIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const normalized = raw
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 32);
  return [...new Set(normalized)];
}

export async function postSupervisorJson(
  deps: AgentRuntimeHandlersDeps,
  pathname: string,
  payload: unknown
): Promise<void> {
  const settings = deps.getRuntimeSettings();
  const baseUrl = settings.supervisorBaseUrl.replace(/\/$/, "");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (settings.supervisorAuthToken) {
      headers.Authorization = `Bearer ${settings.supervisorAuthToken}`;
    }

    const response = await fetch(`${baseUrl}${pathname}`, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}${text ? `: ${text}` : ""}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

export function defaultWorkspacePath(): string | null {
  const firstFolder = vscode.workspace.workspaceFolders?.[0];
  return firstFolder?.uri.fsPath ?? null;
}

export function getGitApi(): GitApiLike | null {
  const extension = vscode.extensions.getExtension<GitExtensionApiLike>("vscode.git");
  if (!extension) {
    return null;
  }
  if (!extension.isActive) {
    void extension.activate();
  }
  try {
    return extension.exports.getAPI(1);
  } catch {
    return null;
  }
}

export async function resolveCurrentWorkspaceContext(): Promise<{
  repoSlug: string | null;
  branch: string | null;
  workspace: string | null;
} | null> {
  const gitApi = getGitApi();
  if (!gitApi || gitApi.repositories.length === 0) {
    return null;
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const candidate = activeUri
    ? gitApi.repositories.find((repo) => activeUri.fsPath.toLowerCase().startsWith(repo.rootUri.fsPath.toLowerCase()))
    : gitApi.repositories[0];

  if (!candidate) {
    return null;
  }

  const remote = (candidate.state.remotes ?? []).find((entry) => entry.name === "origin");
  const repoSlug = repoUrlToSlug(remote?.fetchUrl ?? remote?.pushUrl ?? "");
  const cleanRepoSlug = repoSlug && repoSlug.includes("/") ? repoSlug : null;
  return {
    repoSlug: cleanRepoSlug,
    branch: candidate.state.HEAD?.name ?? null,
    workspace: candidate.rootUri.fsPath
  };
}

export async function sendAgentMessage(
  deps: AgentRuntimeHandlersDeps,
  payload: AgentMessagePayload
): Promise<void> {
  if (!payload.message || payload.message.trim().length === 0) {
    vscode.window.showWarningMessage("Message text is required.");
    return;
  }

  try {
    const contextItems = Array.isArray(payload.contextItems)
      ? payload.contextItems
          .filter((entry) => entry && typeof entry.id === "string" && typeof entry.label === "string")
          .slice(-12)
          .map((entry) => ({
            id: String(entry.id),
            label: String(entry.label),
            kind: typeof entry.kind === "string" ? entry.kind : "context",
            value: typeof entry.value === "string" ? entry.value.slice(0, 4000) : null,
            uri: typeof entry.uri === "string" ? entry.uri : null,
            range: typeof entry.range === "string" ? entry.range : null
          }))
      : [];

    await postSupervisorJson(deps, "/agents/message", {
      sessionId: payload.sessionId ?? null,
      agentId: payload.agentId ?? null,
      transport: payload.transport ?? null,
      message: payload.message.trim(),
      service: payload.service?.trim() || null,
      mode: payload.mode?.trim() || null,
      model: payload.model?.trim() || null,
      effort: payload.effort?.trim() || null,
      toolProfile: payload.toolProfile?.trim() || null,
      mcpTools: normalizeToolIds(payload.mcpTools),
      contextItems,
      requiresApproval: Boolean(payload.requiresApproval),
      pendingCommand: payload.pendingCommand ?? null,
      pendingRisk: payload.pendingRisk ?? null,
      pendingReason: payload.pendingReason ?? null
    });
    await deps.refreshNow("manual");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to send agent message: ${message}`);
  }
}

export async function dispatchAgent(
  deps: AgentRuntimeHandlersDeps,
  payload: AgentDispatchPayload
): Promise<void> {
  const agentId = payload.agentId?.trim();
  if (!agentId) {
    vscode.window.showWarningMessage("Agent ID is required to dispatch.");
    return;
  }

  try {
    const workspaceContext = await resolveCurrentWorkspaceContext();
    const settings = deps.getRuntimeSettings();
    const transport = (payload.transport ?? "unknown").trim().toLowerCase();
    const service = (payload.service ?? "").trim().toLowerCase() || (transport === "cloud" ? "copilot" : "codex");
    const localLikeTransport = transport === "local" || transport === "cli";
    const cloudTransport = transport === "cloud";
    const repository = localLikeTransport
      ? (payload.repository ?? workspaceContext?.repoSlug ?? null)
      : (payload.repository ?? workspaceContext?.repoSlug ?? null);
    const branch = localLikeTransport
      ? (payload.branch ?? workspaceContext?.branch ?? null)
      : (payload.branch ?? workspaceContext?.branch ?? null);
    const workspace = localLikeTransport
      ? (payload.workspace ?? workspaceContext?.workspace ?? defaultWorkspacePath())
      : null;
    const issueNumber = Number.isInteger(payload.issueNumber) && Number(payload.issueNumber) > 0
      ? Number(payload.issueNumber)
      : null;
    const issueNodeId = payload.issueNodeId?.trim() || null;
    const model =
      payload.model?.trim() ||
      (service === "copilot" ? settings.copilotDefaultModel : settings.codexDefaultModel) ||
      null;

    if (!localLikeTransport && !cloudTransport) {
      vscode.window.showWarningMessage("Transport must be local, cli, or cloud.");
      return;
    }

    if (service === "codex" && !localLikeTransport) {
      vscode.window.showWarningMessage("Codex dispatch requires transport=local or transport=cli.");
      return;
    }
    if (service === "copilot" && !localLikeTransport && !cloudTransport) {
      vscode.window.showWarningMessage("Copilot dispatch requires transport=local, transport=cli, or transport=cloud.");
      return;
    }
    if (localLikeTransport && !workspace) {
      vscode.window.showWarningMessage("Workspace path is required for local/cli dispatch.");
      return;
    }
    if (cloudTransport && service !== "copilot") {
      vscode.window.showWarningMessage("Cloud dispatch currently supports service=copilot only.");
      return;
    }
    if (cloudTransport && service === "copilot" && !settings.copilotCloudEnabled) {
      vscode.window.showWarningMessage("Copilot cloud dispatch is disabled in settings (phoenixOps.copilotCloudEnabled=false).");
      return;
    }
    if (cloudTransport && service === "copilot" && !repository) {
      vscode.window.showWarningMessage("Repository is required for Copilot cloud dispatch.");
      return;
    }
    if (cloudTransport && service === "copilot" && !issueNumber) {
      vscode.window.showWarningMessage("Issue number is required for Copilot cloud dispatch.");
      return;
    }

    await postSupervisorJson(deps, "/agents/dispatch", {
      sessionId: payload.sessionId ?? null,
      agentId,
      transport,
      summary: payload.summary ?? null,
      service,
      mode: payload.mode?.trim() || null,
      model,
      effort: payload.effort?.trim() || null,
      toolProfile: payload.toolProfile?.trim() || null,
      mcpTools: normalizeToolIds(payload.mcpTools),
      repository,
      branch,
      workspace,
      issueNumber,
      issueNodeId
    });
    await deps.refreshNow("manual");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to dispatch agent: ${message}`);
  }
}

export async function stopAgent(
  deps: AgentRuntimeHandlersDeps,
  payload: AgentStopPayload
): Promise<void> {
  const sessionId = payload.sessionId?.trim() ?? "";
  const agentId = payload.agentId?.trim() ?? "";
  if (!sessionId && !agentId) {
    vscode.window.showWarningMessage("Select an active session to stop.");
    return;
  }

  try {
    await postSupervisorJson(deps, "/agents/stop", {
      sessionId: sessionId || null,
      agentId: agentId || null,
      transport: payload.transport ?? null
    });
    await deps.refreshNow("manual");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to stop agent session: ${message}`);
  }
}

export async function resolvePendingCommand(
  deps: AgentRuntimeHandlersDeps,
  payload: AgentCommandDecisionPayload
): Promise<void> {
  if (!payload.commandId) {
    return;
  }

  try {
    await postSupervisorJson(deps, "/agents/command/decision", {
      commandId: payload.commandId,
      approve: Boolean(payload.approve),
      note: payload.note ?? null
    });
    await deps.refreshNow("manual");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to submit command decision: ${message}`);
  }
}

export async function addActiveFileContext(
  deps: AgentRuntimeHandlersDeps,
  sourceWebview?: vscode.Webview
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await deps.postContextResponse(sourceWebview, "contextError", { message: "No active editor." });
    return;
  }

  const document = editor.document;
  const relativePath = vscode.workspace.asRelativePath(document.uri, false);
  const preview = document.getText().slice(0, 4000);
  await deps.postContextResponse(sourceWebview, "contextAdded", {
    id: `file:${document.uri.toString()}`,
    kind: "file",
    label: relativePath || document.uri.fsPath,
    value: preview,
    uri: document.uri.toString(),
    range: null
  });
}

export async function addSelectionContext(
  deps: AgentRuntimeHandlersDeps,
  sourceWebview?: vscode.Webview
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await deps.postContextResponse(sourceWebview, "contextError", { message: "No active editor." });
    return;
  }

  const text = editor.document.getText(editor.selection).trim();
  if (!text) {
    await deps.postContextResponse(sourceWebview, "contextError", { message: "No selected text." });
    return;
  }

  const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false);
  const label = `${relativePath}:${editor.selection.start.line + 1}-${editor.selection.end.line + 1}`;
  await deps.postContextResponse(sourceWebview, "contextAdded", {
    id: `selection:${editor.document.uri.toString()}:${editor.selection.start.line}:${editor.selection.start.character}:${editor.selection.end.line}:${editor.selection.end.character}`,
    kind: "selection",
    label,
    value: text.slice(0, 4000),
    uri: editor.document.uri.toString(),
    range: `${editor.selection.start.line + 1}:${editor.selection.start.character + 1}-${editor.selection.end.line + 1}:${editor.selection.end.character + 1}`
  });
}

export async function addWorkspaceFileContext(
  deps: AgentRuntimeHandlersDeps,
  sourceWebview?: vscode.Webview
): Promise<void> {
  const files = await vscode.workspace.findFiles(
    "**/*",
    "**/{node_modules,.git,out,dist,build,target,coverage}/**",
    200
  );
  if (!files.length) {
    await deps.postContextResponse(sourceWebview, "contextError", { message: "No files found in workspace." });
    return;
  }

  const selected = await vscode.window.showQuickPick(
    files.map((uri) => ({
      label: vscode.workspace.asRelativePath(uri, false),
      uri
    })),
    {
      title: "Add Workspace File Context",
      placeHolder: "Select file"
    }
  );

  if (!selected) {
    return;
  }

  let preview = "";
  try {
    const document = await vscode.workspace.openTextDocument(selected.uri);
    preview = document.getText().slice(0, 4000);
  } catch {
    // Best-effort preview; keep attachment metadata even if file cannot be opened.
  }

  await deps.postContextResponse(sourceWebview, "contextAdded", {
    id: `file:${selected.uri.toString()}`,
    kind: "file",
    label: selected.label,
    uri: selected.uri.toString(),
    value: preview,
    range: null
  });
}

export async function openSessionInEditor(
  deps: AgentRuntimeHandlersDeps,
  sessionId: string
): Promise<void> {
  const trimmed = sessionId.trim();
  if (!trimmed) {
    return;
  }
  await deps.openSessionPanel(trimmed);
}

export async function openPullRequestByNumber(
  deps: AgentRuntimeHandlersDeps,
  repo: string,
  number: number
): Promise<void> {
  if (!deps.getSnapshot()) {
    await deps.refreshNow("manual");
  }

  const match = deps.getSnapshot()?.actions.pullRequests.find((entry) => entry.repo === repo && entry.number === number);
  if (!match?.url) {
    vscode.window.showWarningMessage(`Unable to find pull request ${repo}#${number}.`);
    return;
  }
  await deps.openUrl(match.url);
}
