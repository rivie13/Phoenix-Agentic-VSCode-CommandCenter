import * as fs from "node:fs";
import * as path from "node:path";
import type { JarvisConversationTurn } from "../services/JarvisService";
import type { AgentSession, DashboardSnapshot } from "../types";

export interface JarvisSessionMemoryTurn {
  role: "user" | "assistant";
  content: string;
  occurredAt: string;
}

export interface JarvisSessionMemorySnapshot {
  boardItems: number;
  actionRunsTotal24h: number;
  actionRunsAttention24h: number;
  agentSessions: number;
  waitingSessions: number;
  erroredSessions: number;
  pendingApprovals: number;
  highRiskApprovals: number;
  pullRequestsNeedingReview: number;
}

export interface JarvisSessionMemoryRecord {
  sessionId: string;
  workspaceName: string;
  startedAt: string;
  endedAt: string | null;
  summary: string;
  snapshot: JarvisSessionMemorySnapshot;
  turns: JarvisSessionMemoryTurn[];
}

export interface JarvisSessionMemoryStore {
  version: number;
  sessions: JarvisSessionMemoryRecord[];
}

export interface UpsertJarvisSessionMemoryInput {
  sessionId: string;
  workspaceName: string;
  startedAt: string;
  endedAt: string | null;
  summary: string;
  snapshot: JarvisSessionMemorySnapshot;
  turns: JarvisConversationTurn[];
  nowIso?: string;
}

export interface UpsertJarvisSessionMemoryOptions {
  maxSessions: number;
  maxTurnsPerSession: number;
}

export interface JarvisStartupGreetingInput {
  workspaceName: string;
  operatorName: string | null;
  snapshot: JarvisSessionMemorySnapshot;
  priorSessionSummaries: string[];
}

const JARVIS_SESSION_MEMORY_VERSION = 1;

function zeroSnapshot(): JarvisSessionMemorySnapshot {
  return {
    boardItems: 0,
    actionRunsTotal24h: 0,
    actionRunsAttention24h: 0,
    agentSessions: 0,
    waitingSessions: 0,
    erroredSessions: 0,
    pendingApprovals: 0,
    highRiskApprovals: 0,
    pullRequestsNeedingReview: 0
  };
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function coerceIsoTimestamp(value: unknown, fallbackIso: string): string {
  const maybe = asNonEmptyString(value);
  if (!maybe) {
    return fallbackIso;
  }
  const parsed = Date.parse(maybe);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallbackIso;
}

function asFinitePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  if (value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function clip(text: string, maxLength: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) {
    return clean;
  }
  return `${clean.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

function isJarvisMetaSession(session: AgentSession): boolean {
  const service = (session.service ?? "").toLowerCase();
  const agentId = session.agentId.toLowerCase();
  return service === "jarvis" || agentId.includes("jarvis");
}

function summaryFromTurns(turns: JarvisConversationTurn[]): string {
  const userTurns = turns.filter((turn) => turn.role === "user");
  const assistantTurns = turns.filter((turn) => turn.role === "assistant");
  const lastUser = userTurns.length > 0 ? clip(userTurns[userTurns.length - 1].content, 96) : "";
  const lastAssistant = assistantTurns.length > 0 ? clip(assistantTurns[assistantTurns.length - 1].content, 96) : "";

  if (lastUser && lastAssistant) {
    return `Last request: "${lastUser}". Jarvis response: "${lastAssistant}".`;
  }
  if (lastAssistant) {
    return `Last Jarvis response: "${lastAssistant}".`;
  }
  if (lastUser) {
    return `Last request from operator: "${lastUser}".`;
  }
  return "No direct Jarvis conversation turns were recorded.";
}

export function createJarvisSessionId(nowMs = Date.now()): string {
  const compact = new Date(nowMs).toISOString().replace(/[-:.TZ]/g, "");
  return `vscode-${compact}`;
}

export function buildJarvisSessionSnapshot(snapshot: DashboardSnapshot | null): JarvisSessionMemorySnapshot {
  if (!snapshot) {
    return zeroSnapshot();
  }

  const nonMetaSessions = snapshot.agents.sessions.filter((session) => !isJarvisMetaSession(session));

  const actionRunsAttention24h = snapshot.actions.runs.filter((run) => {
    const conclusion = (run.conclusion ?? "").toLowerCase();
    return ["failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(conclusion);
  }).length;

  const waitingSessions = nonMetaSessions.filter((session) => session.status === "waiting").length;
  const erroredSessions = nonMetaSessions.filter((session) => session.status === "error").length;
  const pendingApprovals = snapshot.agents.pendingCommands.filter((command) => command.status === "pending");
  const highRiskApprovals = pendingApprovals.filter((command) => command.risk === "high").length;
  const pullRequestsNeedingReview = snapshot.actions.pullRequests.filter(
    (pr) => pr.reviewState === "review_required" || pr.reviewState === "changes_requested"
  ).length;

  return {
    boardItems: snapshot.board.items.length,
    actionRunsTotal24h: snapshot.actions.runs.length,
    actionRunsAttention24h,
    agentSessions: nonMetaSessions.length,
    waitingSessions,
    erroredSessions,
    pendingApprovals: pendingApprovals.length,
    highRiskApprovals,
    pullRequestsNeedingReview
  };
}

export function buildJarvisSessionSummary(input: {
  workspaceName: string;
  snapshot: JarvisSessionMemorySnapshot;
  turns: JarvisConversationTurn[];
}): string {
  const conversation = summaryFromTurns(input.turns);
  const metrics =
    `Workspace ${input.workspaceName}: ${input.snapshot.agentSessions} sessions ` +
    `(${input.snapshot.waitingSessions} waiting, ${input.snapshot.erroredSessions} error), ` +
    `${input.snapshot.pendingApprovals} pending approvals (${input.snapshot.highRiskApprovals} high risk), ` +
    `${input.snapshot.actionRunsAttention24h} workflow runs needing attention (24h).`;
  return `${conversation} ${metrics}`;
}

export function buildJarvisStartupGreeting(input: JarvisStartupGreetingInput): string {
  const nameClause = input.operatorName ? `, ${input.operatorName}` : "";
  const sentenceOne = `Good day${nameClause}. Jarvis online for ${input.workspaceName}.`;
  const sentenceTwo =
    `Current extension snapshot: ${input.snapshot.agentSessions} sessions ` +
    `(${input.snapshot.waitingSessions} waiting, ${input.snapshot.erroredSessions} error), ` +
    `${input.snapshot.pendingApprovals} pending approvals (${input.snapshot.highRiskApprovals} high risk), and ` +
    `${input.snapshot.actionRunsAttention24h} workflow runs needing attention in the last 24 hours.`;

  if (input.priorSessionSummaries.length === 0) {
    return `${sentenceOne} ${sentenceTwo} This VS Code session starts with a clean Jarvis memory.`;
  }

  const carryOver = input.priorSessionSummaries.map((entry) => clip(entry, 120)).join(" | ");
  return `${sentenceOne} ${sentenceTwo} Recent session carryover: ${carryOver}.`;
}

export function createJarvisSessionMemoryStore(): JarvisSessionMemoryStore {
  return {
    version: JARVIS_SESSION_MEMORY_VERSION,
    sessions: []
  };
}

function sanitizeSnapshot(value: unknown): JarvisSessionMemorySnapshot {
  if (!isRecord(value)) {
    return zeroSnapshot();
  }
  return {
    boardItems: asFinitePositiveInteger(value.boardItems, 0),
    actionRunsTotal24h: asFinitePositiveInteger(value.actionRunsTotal24h, 0),
    actionRunsAttention24h: asFinitePositiveInteger(value.actionRunsAttention24h, 0),
    agentSessions: asFinitePositiveInteger(value.agentSessions, 0),
    waitingSessions: asFinitePositiveInteger(value.waitingSessions, 0),
    erroredSessions: asFinitePositiveInteger(value.erroredSessions, 0),
    pendingApprovals: asFinitePositiveInteger(value.pendingApprovals, 0),
    highRiskApprovals: asFinitePositiveInteger(value.highRiskApprovals, 0),
    pullRequestsNeedingReview: asFinitePositiveInteger(value.pullRequestsNeedingReview, 0)
  };
}

function sanitizeTurn(value: unknown): JarvisSessionMemoryTurn | null {
  if (!isRecord(value)) {
    return null;
  }
  const role = value.role === "assistant" ? "assistant" : value.role === "user" ? "user" : null;
  const content = asNonEmptyString(value.content);
  if (!role || !content) {
    return null;
  }
  const occurredAt = coerceIsoTimestamp(value.occurredAt, new Date(0).toISOString());
  return { role, content, occurredAt };
}

function sanitizeRecord(value: unknown): JarvisSessionMemoryRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const sessionId = asNonEmptyString(value.sessionId);
  const workspaceName = asNonEmptyString(value.workspaceName);
  const summary = asNonEmptyString(value.summary);
  if (!sessionId || !workspaceName || !summary) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const startedAt = coerceIsoTimestamp(value.startedAt, nowIso);
  const endedAtRaw = value.endedAt;
  const endedAt = endedAtRaw === null ? null : coerceIsoTimestamp(endedAtRaw, startedAt);
  const turnsRaw = Array.isArray(value.turns) ? value.turns : [];
  const turns = turnsRaw
    .map((entry) => sanitizeTurn(entry))
    .filter((entry): entry is JarvisSessionMemoryTurn => Boolean(entry));

  return {
    sessionId,
    workspaceName,
    startedAt,
    endedAt,
    summary,
    snapshot: sanitizeSnapshot(value.snapshot),
    turns
  };
}

export function loadJarvisSessionMemory(filePath: string): JarvisSessionMemoryStore {
  try {
    if (!fs.existsSync(filePath)) {
      return createJarvisSessionMemoryStore();
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return createJarvisSessionMemoryStore();
    }
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.map((entry) => sanitizeRecord(entry)).filter((entry): entry is JarvisSessionMemoryRecord => Boolean(entry))
      : [];

    return {
      version: asFinitePositiveInteger(parsed.version, JARVIS_SESSION_MEMORY_VERSION),
      sessions: sessions.sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
    };
  } catch {
    return createJarvisSessionMemoryStore();
  }
}

export function persistJarvisSessionMemory(filePath: string, store: JarvisSessionMemoryStore): boolean {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

export function upsertJarvisSessionMemory(
  store: JarvisSessionMemoryStore,
  input: UpsertJarvisSessionMemoryInput,
  options: UpsertJarvisSessionMemoryOptions
): JarvisSessionMemoryStore {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const safeMaxSessions = Math.max(3, options.maxSessions);
  const safeMaxTurns = Math.max(4, options.maxTurnsPerSession);

  const turns: JarvisSessionMemoryTurn[] = input.turns
    .map((turn) => ({
      role: turn.role,
      content: turn.content.trim(),
      occurredAt: nowIso
    }))
    .filter((turn) => turn.content.length > 0)
    .slice(-safeMaxTurns);

  const nextRecord: JarvisSessionMemoryRecord = {
    sessionId: input.sessionId,
    workspaceName: input.workspaceName,
    startedAt: coerceIsoTimestamp(input.startedAt, nowIso),
    endedAt: input.endedAt ? coerceIsoTimestamp(input.endedAt, nowIso) : null,
    summary: clip(input.summary, 320),
    snapshot: input.snapshot,
    turns
  };

  const otherSessions = store.sessions.filter((entry) => entry.sessionId !== input.sessionId);
  const sessions = [...otherSessions, nextRecord]
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
    .slice(-safeMaxSessions);

  return {
    version: JARVIS_SESSION_MEMORY_VERSION,
    sessions
  };
}

export function listRecentJarvisSessionSummaries(
  store: JarvisSessionMemoryStore,
  currentSessionId: string,
  maxCount: number
): string[] {
  const safeMax = Math.max(0, maxCount);
  if (safeMax === 0) {
    return [];
  }

  return store.sessions
    .filter((session) => session.sessionId !== currentSessionId)
    .sort((left, right) => {
      const leftTime = Date.parse(left.endedAt ?? left.startedAt) || 0;
      const rightTime = Date.parse(right.endedAt ?? right.startedAt) || 0;
      return rightTime - leftTime;
    })
    .slice(0, safeMax)
    .map((session) => `${session.workspaceName}: ${clip(session.summary, 160)}`);
}
