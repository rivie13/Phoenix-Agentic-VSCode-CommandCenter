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

export interface DashboardSnapshot {
  board: {
    items: BoardItem[];
  };
  actions: {
    runs: ActionRun[];
    jobs: ActionJob[];
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
    | "heartbeat";
  occurredAt: string;
  source: string;
  payload: unknown;
}
