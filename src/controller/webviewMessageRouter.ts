import * as vscode from "vscode";
import type {
  ActionRunLogRequestPayload,
  AgentCommandDecisionPayload,
  AgentDispatchPayload,
  AgentMessagePayload,
  AgentStopPayload,
  CommentPullRequestFromViewPayload,
  CreateIssueFromViewPayload,
  CreatePullRequestFromViewPayload,
  IssueActionPayload,
  IssueCreateMetadataRequestPayload,
  PullRequestInsightsRequestPayload,
  PullRequestOpenPayload,
  RetryActionRunPayload
} from "./CommandCenterPayloads";
import type { PendingBoardUiAction } from "./issuePullRequestHandlers";
import type { RefreshReason } from "../services/DataService";
import type { BoardItem } from "../types";

interface WebviewMessageRouterContext {
  getSnapshot: () => import("../types").DashboardSnapshot | null;
  postAuthState: () => Promise<void>;
  postJarvisState: (sourceWebview?: vscode.Webview) => Promise<void>;
  pushSnapshot: () => Promise<void>;
  refreshNow: (reason: RefreshReason) => Promise<void>;
  postRuntimeContext: (sourceWebview?: vscode.Webview) => Promise<void>;
  getPendingBoardUiAction: () => PendingBoardUiAction | null;
  clearPendingBoardUiAction: () => void;
  boardViewOwnsWebview: (webview?: vscode.Webview) => boolean;
  postWebviewResponse: (sourceWebview: vscode.Webview | undefined, type: string, payload: unknown) => Promise<void>;
  activateJarvis: (prompt: string) => Promise<void>;
  jarvisToggleManualModeCommand: () => Promise<void>;
  issueCreateMetadataRequest: (payload: IssueCreateMetadataRequestPayload, sourceWebview?: vscode.Webview) => Promise<void>;
  createIssueFromView: (payload: CreateIssueFromViewPayload, sourceWebview?: vscode.Webview) => Promise<void>;
  createPullRequestFromView: (payload: CreatePullRequestFromViewPayload, sourceWebview?: vscode.Webview) => Promise<void>;
  commentPullRequestFromView: (payload: CommentPullRequestFromViewPayload, sourceWebview?: vscode.Webview) => Promise<void>;
  findBoardItemById: (itemId: string) => BoardItem | undefined;
  updateProjectFieldForItem: (item: BoardItem) => Promise<void>;
  updateLabelsForItem: (item: BoardItem) => Promise<void>;
  openUrl: (url: string) => Promise<void>;
  getPullRequestInsights: (repo: string, number: number) => Promise<unknown>;
  getActionRunLog: (repo: string, runId: number) => Promise<unknown>;
  retryActionRun: (repo: string, runId: number, failedOnly: boolean) => Promise<void>;
  runWrite: (action: () => Promise<void>) => Promise<void>;
  openAgentWorkspacePanel: () => Promise<void>;
  setSessionPinned: (sessionId: string, pinned: boolean) => Promise<void>;
  archiveSession: (sessionId: string) => Promise<void>;
  restoreSession: (sessionId: string) => Promise<void>;
  sendAgentMessage: (payload: AgentMessagePayload) => Promise<void>;
  dispatchAgent: (payload: AgentDispatchPayload) => Promise<void>;
  resolvePendingCommand: (payload: AgentCommandDecisionPayload) => Promise<void>;
  stopAgent: (payload: AgentStopPayload) => Promise<void>;
  addActiveFileContext: (sourceWebview?: vscode.Webview) => Promise<void>;
  addSelectionContext: (sourceWebview?: vscode.Webview) => Promise<void>;
  addWorkspaceFileContext: (sourceWebview?: vscode.Webview) => Promise<void>;
  openSessionInEditor: (sessionId: string) => Promise<void>;
  openPullRequestByNumber: (repo: string, number: number) => Promise<void>;
  logInfo: (message: string) => void;
  logWarn: (message: string) => void;
}

export async function routeWebviewMessage(
  ctx: WebviewMessageRouterContext,
  message: { type?: unknown; command?: unknown; url?: unknown },
  sourceWebview?: vscode.Webview
): Promise<void> {
  const type = typeof message.type === "string" ? message.type : "";
  if (!type) {
    return;
  }

  if (type === "ready") {
    await ctx.postAuthState();
    await ctx.postJarvisState(sourceWebview);
    if (ctx.getSnapshot()) {
      await ctx.pushSnapshot();
    } else {
      await ctx.refreshNow("startup");
    }
    await ctx.postRuntimeContext(sourceWebview);
    const pending = ctx.getPendingBoardUiAction();
    if (pending && ctx.boardViewOwnsWebview(sourceWebview)) {
      await ctx.postWebviewResponse(sourceWebview, "uiAction", pending);
      ctx.clearPendingBoardUiAction();
    }
    return;
  }

  if (type === "jarvisActivate") {
    const payload = message as { prompt?: unknown };
    const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    await ctx.activateJarvis(prompt);
    return;
  }

  if (type === "jarvisToggleManualMode") {
    await ctx.jarvisToggleManualModeCommand();
    return;
  }

  if (type === "jarvisAudioTrace") {
    const payload = message as {
      level?: unknown;
      stage?: unknown;
      detail?: unknown;
      reason?: unknown;
      auto?: unknown;
      mimeType?: unknown;
      errorName?: unknown;
      errorMessage?: unknown;
      bytesBase64?: unknown;
      attempt?: unknown;
      delayMs?: unknown;
    };
    const level = payload.level === "warn" ? "warn" : "info";
    const stage = typeof payload.stage === "string" ? payload.stage.trim() : "unknown";
    const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
    const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
    const auto = typeof payload.auto === "boolean" ? payload.auto : null;
    const mimeType = typeof payload.mimeType === "string" ? payload.mimeType.trim() : "";
    const errorName = typeof payload.errorName === "string" ? payload.errorName.trim() : "";
    const errorMessage = typeof payload.errorMessage === "string" ? payload.errorMessage.trim() : "";
    const bytesBase64 = typeof payload.bytesBase64 === "number" ? payload.bytesBase64 : null;
    const attempt = typeof payload.attempt === "number" ? payload.attempt : null;
    const delayMs = typeof payload.delayMs === "number" ? payload.delayMs : null;

    const parts = [
      `[jarvis-audio] stage=${stage}`,
      reason ? `reason=${reason}` : "",
      auto === null ? "" : `auto=${auto}`,
      mimeType ? `mimeType=${mimeType}` : "",
      bytesBase64 === null ? "" : `bytesBase64=${bytesBase64}`,
      attempt === null ? "" : `attempt=${attempt}`,
      delayMs === null ? "" : `delayMs=${delayMs}`,
      detail ? `detail=${detail}` : "",
      errorName ? `error=${errorName}` : "",
      errorMessage ? `message=${errorMessage}` : ""
    ].filter((value) => value.length > 0);
    const line = parts.join(" ");
    if (level === "warn") {
      ctx.logWarn(line);
    } else {
      ctx.logInfo(line);
    }
    return;
  }

  if (type === "command" && typeof message.command === "string") {
    await vscode.commands.executeCommand(message.command);
    return;
  }

  if (type === "issueCreateMetadataRequest") {
    await ctx.issueCreateMetadataRequest(message as unknown as IssueCreateMetadataRequestPayload, sourceWebview);
    return;
  }

  if (type === "createIssueFromView") {
    await ctx.createIssueFromView(message as unknown as CreateIssueFromViewPayload, sourceWebview);
    return;
  }

  if (type === "createPullRequestFromView") {
    await ctx.createPullRequestFromView(message as unknown as CreatePullRequestFromViewPayload, sourceWebview);
    return;
  }

  if (type === "commentPullRequestFromView") {
    await ctx.commentPullRequestFromView(message as unknown as CommentPullRequestFromViewPayload, sourceWebview);
    return;
  }

  if (type === "issueUpdateField") {
    const payload = message as IssueActionPayload;
    const itemId = String(payload.itemId ?? "");
    const item = ctx.findBoardItemById(itemId);
    if (!item) {
      vscode.window.showWarningMessage("Selected issue is not available in the current snapshot.");
      return;
    }
    await ctx.updateProjectFieldForItem(item);
    return;
  }

  if (type === "issueUpdateLabels") {
    const payload = message as IssueActionPayload;
    const itemId = String(payload.itemId ?? "");
    const item = ctx.findBoardItemById(itemId);
    if (!item) {
      vscode.window.showWarningMessage("Selected issue is not available in the current snapshot.");
      return;
    }
    await ctx.updateLabelsForItem(item);
    return;
  }

  if ((type === "openIssue" || type === "openRun" || type === "openPullRequest") && typeof message.url === "string") {
    await ctx.openUrl(message.url);
    return;
  }

  if (type === "fetchPullRequestInsights") {
    const payload = message as PullRequestInsightsRequestPayload;
    const repo = typeof payload.repo === "string" ? payload.repo.trim() : "";
    const number = typeof payload.number === "number" ? payload.number : 0;
    if (!repo || !number) {
      return;
    }
    try {
      const insights = await ctx.getPullRequestInsights(repo, number);
      await ctx.postWebviewResponse(sourceWebview, "pullRequestInsights", insights);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await ctx.postWebviewResponse(sourceWebview, "pullRequestInsights", {
        repo,
        number,
        reviews: [],
        comments: [],
        fetchedAt: new Date().toISOString(),
        error: messageText
      });
    }
    return;
  }

  if (type === "fetchActionRunLog") {
    const payload = message as ActionRunLogRequestPayload;
    const repo = typeof payload.repo === "string" ? payload.repo.trim() : "";
    const runId = typeof payload.runId === "number" ? payload.runId : 0;
    if (!repo || !runId) {
      return;
    }
    try {
      const log = await ctx.getActionRunLog(repo, runId);
      await ctx.postWebviewResponse(sourceWebview, "actionRunLog", log);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await ctx.postWebviewResponse(sourceWebview, "actionRunLog", {
        repo,
        runId,
        text: "",
        truncated: false,
        fetchedAt: new Date().toISOString(),
        error: messageText
      });
    }
    return;
  }

  if (type === "retryActionRun") {
    const payload = message as RetryActionRunPayload;
    const repo = typeof payload.repo === "string" ? payload.repo.trim() : "";
    const runId = typeof payload.runId === "number" ? payload.runId : 0;
    const failedOnly = Boolean(payload.failedOnly);
    if (!repo || !runId) {
      return;
    }
    await ctx.runWrite(async () => {
      await ctx.retryActionRun(repo, runId, failedOnly);
      vscode.window.showInformationMessage(
        failedOnly
          ? `Retry requested for failed jobs in run ${repo}#${runId}.`
          : `Retry requested for run ${repo}#${runId}.`
      );
    });
    return;
  }

  if (type === "openAgentWorkspacePanel") {
    await ctx.openAgentWorkspacePanel();
    return;
  }

  if (type === "sessionPin") {
    const payload = message as { sessionId?: unknown; pinned?: unknown };
    await ctx.setSessionPinned(String(payload.sessionId ?? ""), Boolean(payload.pinned));
    return;
  }

  if (type === "sessionArchive") {
    const payload = message as { sessionId?: unknown };
    await ctx.archiveSession(String(payload.sessionId ?? ""));
    return;
  }

  if (type === "sessionRestore") {
    const payload = message as { sessionId?: unknown };
    await ctx.restoreSession(String(payload.sessionId ?? ""));
    return;
  }

  if (type === "agentSendMessage") {
    await ctx.sendAgentMessage(message as unknown as AgentMessagePayload);
    return;
  }

  if (type === "agentDispatch") {
    await ctx.dispatchAgent(message as unknown as AgentDispatchPayload);
    return;
  }

  if (type === "agentCommandDecision") {
    await ctx.resolvePendingCommand(message as unknown as AgentCommandDecisionPayload);
    return;
  }

  if (type === "agentStop") {
    await ctx.stopAgent(message as unknown as AgentStopPayload);
    return;
  }

  if (type === "contextAddActiveFile") {
    await ctx.addActiveFileContext(sourceWebview);
    return;
  }

  if (type === "contextAddSelection") {
    await ctx.addSelectionContext(sourceWebview);
    return;
  }

  if (type === "contextAddWorkspaceFile") {
    await ctx.addWorkspaceFileContext(sourceWebview);
    return;
  }

  if (type === "openSessionEditor") {
    const payload = message as { sessionId?: unknown };
    await ctx.openSessionInEditor(String(payload.sessionId ?? ""));
    return;
  }

  if (type === "openPullRequestInEditor") {
    const payload = message as PullRequestOpenPayload;
    if (typeof payload.repo === "string" && typeof payload.number === "number") {
      await ctx.openPullRequestByNumber(payload.repo, payload.number);
    }
  }
}
