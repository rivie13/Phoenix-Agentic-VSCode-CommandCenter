import { ActionRun, BoardItem, DashboardSnapshot, StreamEnvelope } from "../types";

function readAny(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in raw) {
      return raw[key];
    }
  }
  return undefined;
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      if (entry && typeof entry === "object") {
        const maybe = (entry as { name?: unknown }).name;
        return typeof maybe === "string" ? maybe : "";
      }

      return "";
    })
    .filter((entry) => entry.length > 0);
}

function repoUrlToSlug(repoUrlOrSlug: string): string {
  if (!repoUrlOrSlug.includes("github.com")) {
    return repoUrlOrSlug;
  }

  try {
    const parsed = new URL(repoUrlOrSlug);
    return parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  } catch {
    return repoUrlOrSlug;
  }
}

export function mapBoardItems(rawItems: unknown[]): BoardItem[] {
  const mapped: BoardItem[] = [];

  for (const entry of rawItems) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const raw = entry as Record<string, unknown>;
    const content = (raw.content ?? {}) as Record<string, unknown>;

    const repoValue = asStringOrNull(readAny(raw, "repository")) ?? asStringOrNull(readAny(content, "repository")) ?? "";
    const issueNumberValue = readAny(raw, "number") ?? readAny(content, "number");

    mapped.push({
      itemId: asStringOrNull(readAny(raw, "id")) ?? `item-${Math.random().toString(16).slice(2)}`,
      issueNumber: typeof issueNumberValue === "number" ? issueNumberValue : null,
      title: asStringOrNull(readAny(raw, "title")) ?? asStringOrNull(readAny(content, "title")) ?? "Untitled",
      url: asStringOrNull(readAny(content, "url")) ?? asStringOrNull(readAny(raw, "url")),
      repo: repoUrlToSlug(repoValue),
      status: asStringOrNull(readAny(raw, "status")) ?? "Backlog",
      workMode: asStringOrNull(readAny(raw, "work mode", "workMode", "Work mode")),
      priority: asStringOrNull(readAny(raw, "priority", "Priority")),
      size: asStringOrNull(readAny(raw, "size", "Size")),
      area: asStringOrNull(readAny(raw, "area", "Area")),
      assignees: asStringArray(readAny(raw, "assignees", "Assignees")),
      labels: asStringArray(readAny(raw, "labels", "Labels")),
      claimOwner: asStringOrNull(readAny(raw, "claim owner", "Claim Owner")),
      leaseExpires: asStringOrNull(readAny(raw, "lease expires", "Lease Expires")),
      lastHeartbeat: asStringOrNull(readAny(raw, "last heartbeat", "Last Heartbeat")),
      runLink: asStringOrNull(readAny(raw, "run link", "Run Link"))
    });
  }

  return mapped;
}

export function isNeedsAttention(conclusion: string | null): boolean {
  if (!conclusion) {
    return false;
  }

  return ["failure", "cancelled", "action_required", "timed_out", "startup_failure"].includes(conclusion.toLowerCase());
}

export function bucketRuns(runs: ActionRun[]): {
  queued: ActionRun[];
  inProgress: ActionRun[];
  needsAttention: ActionRun[];
} {
  return {
    queued: runs.filter((run) => run.status === "queued"),
    inProgress: runs.filter((run) => run.status === "in_progress"),
    needsAttention: runs.filter((run) => isNeedsAttention(run.conclusion))
  };
}

export function applyStreamEnvelope(snapshot: DashboardSnapshot, envelope: StreamEnvelope): DashboardSnapshot {
  const next: DashboardSnapshot = {
    board: { items: [...snapshot.board.items] },
    actions: {
      runs: [...snapshot.actions.runs],
      jobs: [...snapshot.actions.jobs]
    },
    meta: {
      ...snapshot.meta,
      generatedAt: envelope.occurredAt,
      sequence: envelope.sequence,
      source: "supervisor",
      streamConnected: true,
      stale: false
    }
  };

  if (envelope.eventType === "snapshot") {
    const payload = envelope.payload as DashboardSnapshot;
    return {
      ...payload,
      meta: {
        ...payload.meta,
        source: "supervisor",
        streamConnected: true,
        stale: false,
        sequence: envelope.sequence
      }
    };
  }

  if (envelope.eventType === "project.item.upserted") {
    const item = envelope.payload as BoardItem;
    const index = next.board.items.findIndex((candidate) => candidate.itemId === item.itemId);
    if (index >= 0) {
      next.board.items[index] = item;
    } else {
      next.board.items.push(item);
    }
  }

  if (envelope.eventType === "project.item.removed") {
    const itemId = String(envelope.payload);
    next.board.items = next.board.items.filter((item) => item.itemId !== itemId);
  }

  if (envelope.eventType === "actions.run.upserted") {
    const run = envelope.payload as ActionRun;
    const index = next.actions.runs.findIndex((candidate) => candidate.id === run.id && candidate.repo === run.repo);
    if (index >= 0) {
      next.actions.runs[index] = run;
    } else {
      next.actions.runs.push(run);
    }
  }

  if (envelope.eventType === "actions.job.upserted") {
    const job = envelope.payload as DashboardSnapshot["actions"]["jobs"][number];
    const index = next.actions.jobs.findIndex((candidate) => candidate.id === job.id);
    if (index >= 0) {
      next.actions.jobs[index] = job;
    } else {
      next.actions.jobs.push(job);
    }
  }

  return next;
}
