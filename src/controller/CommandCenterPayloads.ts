import type * as vscode from "vscode";
import type { PollinationsFailureKind } from "../services/PollinationsResilience";

export interface AgentMessagePayload {
  sessionId?: string;
  agentId?: string;
  transport?: string;
  message: string;
  service?: string;
  mode?: string;
  model?: string;
  toolProfile?: string;
  mcpTools?: string[];
  contextItems?: Array<{ id?: string; label?: string; kind?: string; value?: string | null; uri?: string | null; range?: string | null }>;
  requiresApproval?: boolean;
  pendingCommand?: string;
  pendingRisk?: string;
  pendingReason?: string;
}

export interface AgentDispatchPayload {
  sessionId?: string;
  agentId?: string;
  transport?: string;
  summary?: string;
  service?: string;
  mode?: string;
  model?: string;
  toolProfile?: string;
  mcpTools?: string[];
  repository?: string;
  branch?: string;
  workspace?: string;
  issueNumber?: number | null;
  issueNodeId?: string | null;
}

export interface PullRequestOpenPayload {
  repo?: string;
  number?: number;
}

export interface AgentCommandDecisionPayload {
  commandId: string;
  approve: boolean;
  note?: string;
}

export interface AgentStopPayload {
  sessionId?: string;
  agentId?: string;
  transport?: string;
}

export interface IssueActionPayload {
  itemId?: string;
}

export interface IssueCreateMetadataRequestPayload {
  repo?: string;
}

export interface PullRequestInsightsRequestPayload {
  repo?: string;
  number?: number;
}

export interface ActionRunLogRequestPayload {
  repo?: string;
  runId?: number;
}

export interface RetryActionRunPayload {
  repo?: string;
  runId?: number;
  failedOnly?: boolean;
}

export interface CreateIssueFromViewPayload {
  repo?: string;
  title?: string;
  body?: string;
  labels?: unknown;
  template?: unknown;
  boardFields?: unknown;
}

export interface CreatePullRequestFromViewPayload {
  repo?: string;
  title?: string;
  body?: string;
  base?: string;
  head?: string;
  draft?: boolean;
}

export interface CommentPullRequestFromViewPayload {
  repo?: string;
  number?: number;
  body?: string;
}

export interface GitHeadLike {
  name?: string;
}

export interface GitRemoteLike {
  name?: string;
  fetchUrl?: string;
  pushUrl?: string;
}

export interface GitRepositoryLike {
  rootUri: vscode.Uri;
  state: {
    HEAD?: GitHeadLike;
    remotes?: GitRemoteLike[];
  };
}

export interface GitApiLike {
  repositories: GitRepositoryLike[];
}

export interface GitExtensionApiLike {
  getAPI(version: number): GitApiLike;
}

export type JarvisFocusKind = "session" | "run" | "issue" | "pullRequest";

export interface JarvisFocusHint {
  kind: JarvisFocusKind;
  id: string;
  label: string;
}

export interface JarvisStatePayload {
  enabled: boolean;
  manualMode: boolean;
  autoAnnouncements: boolean;
  maxAnnouncementsPerHour: number;
  minSecondsBetweenAnnouncements: number;
  announcementsLastHour: number;
  lastReason: string | null;
  lastMessage: string | null;
  chatDegraded: boolean;
  chatFailureKind: PollinationsFailureKind | null;
  chatCooldownUntil: string | null;
  speechDegraded: boolean;
  speechFailureKind: PollinationsFailureKind | null;
  speechCooldownUntil: string | null;
}

export interface JarvisSpeakPayload {
  text: string;
  reason: string;
  auto: boolean;
  focusHint: JarvisFocusHint | null;
  mimeType: string | null;
  audioBase64: string | null;
  audioHandledByHost?: boolean;
}

export interface SupervisorJarvisRespondPayload {
  accepted?: unknown;
  source?: unknown;
  personality?: unknown;
  text?: unknown;
  mimeType?: unknown;
  audioBase64?: unknown;
  failureKind?: unknown;
}
