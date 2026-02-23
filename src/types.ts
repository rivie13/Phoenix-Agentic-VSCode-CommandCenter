export interface BoardItem {
  itemId: string;
  issueNumber: number | null;
  title: string;
  url: string | null;
  repo: string;
  status: string;
  workMode: string | null;
  priority: string | null;
  size: string | null;
  area: string | null;
  assignees: string[];
  labels: string[];
  claimOwner: string | null;
  leaseExpires: string | null;
  lastHeartbeat: string | null;
  runLink: string | null;
}

export interface ActionRun {
  id: number;
  repo: string;
  workflowName: string;
  name: string;
  displayTitle: string;
  status: string;
  conclusion: string | null;
  event: string;
  headBranch: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
  number: number;
}

export interface ActionJob {
  id: string;
  runId: number;
  repo: string;
  runUrl: string;
  workflowName: string;
  jobName: string;
  status: string;
  conclusion: string | null;
  failedSteps: string[];
}

export type PullRequestReviewState = "review_required" | "changes_requested" | "approved" | "draft" | "unknown";

export interface PullRequestSummary {
  id: string;
  repo: string;
  number: number;
  title: string;
  state: string;
  reviewState: PullRequestReviewState;
  isDraft: boolean;
  headBranch: string | null;
  baseBranch: string | null;
  author: string | null;
  updatedAt: string;
  createdAt: string;
  url: string;
}

export type AgentTransport = "cli" | "local" | "cloud" | "unknown";
export type AgentStatus = "online" | "busy" | "idle" | "waiting" | "error" | "offline";
export type AgentFeedLevel = "info" | "warn" | "error";
export type AgentCommandRisk = "low" | "medium" | "high";
export type AgentCommandState = "pending" | "approved" | "rejected" | "expired";

export interface AgentUsageStats {
  continues?: number | null;
  chatMessages?: number | null;
  contextTokens?: number | null;
  contextWindow?: number | null;
  model?: string | null;
}

export interface AgentSession {
  sessionId: string;
  agentId: string;
  transport: AgentTransport;
  status: AgentStatus;
  summary: string | null;
  service?: string | null;
  mode?: string | null;
  model?: string | null;
  toolProfile?: string | null;
  mcpTools?: string[];
  workspace: string | null;
  repository: string | null;
  branch: string | null;
  startedAt: string;
  lastHeartbeat: string;
  updatedAt: string;
  usage?: AgentUsageStats | null;
  stats?: AgentUsageStats | null;
  metrics?: AgentUsageStats | null;
  pinned?: boolean;
  archived?: boolean;
}

export interface AgentFeedEntry {
  entryId: string;
  sessionId: string | null;
  agentId: string;
  transport: AgentTransport;
  level: AgentFeedLevel;
  message: string;
  service?: string | null;
  mode?: string | null;
  model?: string | null;
  toolProfile?: string | null;
  mcpTools?: string[];
  repository: string | null;
  workspace: string | null;
  occurredAt: string;
  usage?: AgentUsageStats | null;
  stats?: AgentUsageStats | null;
  metrics?: AgentUsageStats | null;
}

export interface AgentPendingCommand {
  commandId: string;
  sessionId: string | null;
  agentId: string;
  transport: AgentTransport;
  command: string;
  reason: string | null;
  risk: AgentCommandRisk;
  status: AgentCommandState;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardSnapshot {
  board: {
    items: BoardItem[];
  };
  actions: {
    runs: ActionRun[];
    jobs: ActionJob[];
    pullRequests: PullRequestSummary[];
  };
  agents: {
    sessions: AgentSession[];
    feed: AgentFeedEntry[];
    pendingCommands: AgentPendingCommand[];
  };
  meta: {
    generatedAt: string;
    sequence: number;
    source: "supervisor" | "local-gh";
    streamConnected: boolean;
    stale: boolean;
  };
}

export type ProjectFieldName = "Status" | "Work mode" | "Priority" | "Size" | "Area";

export interface ProjectFieldOption {
  id: string;
  name: string;
}

export interface ProjectFieldSchema {
  id: string;
  name: string;
  options: ProjectFieldOption[];
}

export interface ProjectSchema {
  projectId: string;
  fields: ProjectFieldSchema[];
}

export interface StreamEnvelope {
  eventId: string;
  sequence: number;
  eventType:
    | "snapshot"
    | "project.item.upserted"
    | "project.item.removed"
    | "actions.run.upserted"
    | "actions.job.upserted"
    | "actions.pull_request.upserted"
    | "agents.session.upserted"
    | "agents.feed.appended"
    | "agents.command.upserted"
    | "heartbeat";
  occurredAt: string;
  source: string;
  payload: unknown;
}
