import * as http from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { EmbeddedJarvisPollinationsRuntime } from "./jarvisPollinations";

type AgentTransport = "cli" | "local" | "cloud" | "unknown";
type AgentStatus = "online" | "busy" | "idle" | "waiting" | "error" | "offline";
type AgentFeedLevel = "info" | "warn" | "error";
type AgentCommandRisk = "low" | "medium" | "high";
type AgentCommandState = "pending" | "approved" | "rejected" | "expired";
type QaHandoffStatus = "pending" | "approved" | "rejected" | "expired";

interface AgentSession {
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
}

interface AgentFeedEntry {
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
}

interface AgentPendingCommand {
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

interface QaProposedPullRequest {
  title: string | null;
  body: string | null;
  base: string | null;
  head: string | null;
  draft: boolean;
}

interface QaHandoff {
  handoffId: string;
  sessionId: string | null;
  agentId: string;
  transport: AgentTransport;
  repository: string | null;
  branch: string | null;
  workspace: string | null;
  title: string;
  summary: string;
  validation: string[];
  artifacts: string[];
  proposedPullRequest: QaProposedPullRequest;
  status: QaHandoffStatus;
  linkedCommandId: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

interface JarvisSpeakInput {
  sessionId?: string | null;
  agentId?: string | null;
  transport?: string | null;
  message?: string | null;
  text?: string | null;
  reason?: string | null;
  auto?: boolean;
  service?: string | null;
  mode?: string | null;
  model?: string | null;
  toolProfile?: string | null;
  mcpTools?: string[] | null;
  repository?: string | null;
  workspace?: string | null;
  occurredAt?: string | null;
  mimeType?: string | null;
  audioBase64?: string | null;
  source?: "api" | "fallback" | null;
  failureKind?: string | null;
  cooldownUntil?: string | null;
}

interface JarvisRespondInput {
  sessionId?: string | null;
  agentId?: string | null;
  transport?: string | null;
  prompt?: string | null;
  text?: string | null;
  voice?: string | null;
  reason?: string | null;
  auto?: boolean;
  service?: string | null;
  mode?: string | null;
  model?: string | null;
  toolProfile?: string | null;
  mcpTools?: string[] | null;
  repository?: string | null;
  workspace?: string | null;
  occurredAt?: string | null;
  includeAudio?: boolean | null;
}

interface DashboardSnapshot {
  board: { items: unknown[] };
  actions: { runs: unknown[]; jobs: unknown[]; pullRequests: unknown[] };
  agents: { sessions: AgentSession[]; feed: AgentFeedEntry[]; pendingCommands: AgentPendingCommand[] };
  qa: { handoffs: QaHandoff[] };
  meta: {
    generatedAt: string;
    sequence: number;
    source: "supervisor";
    streamConnected: boolean;
    stale: boolean;
  };
}

interface StreamEnvelope {
  eventId: string;
  sequence: number;
  eventType:
    | "snapshot"
    | "agents.session.upserted"
    | "agents.feed.appended"
    | "agents.command.upserted"
    | "qa.handoff.upserted"
    | "heartbeat";
  occurredAt: string;
  source: string;
  payload: unknown;
}

const host = process.env.PHOENIX_EMBEDDED_SUPERVISOR_HOST ?? "127.0.0.1";
const port = Math.max(1, Number(process.env.PHOENIX_EMBEDDED_SUPERVISOR_PORT ?? 8789));
const apiToken = (process.env.PHOENIX_EMBEDDED_SUPERVISOR_API_TOKEN ?? "").trim();
const heartbeatSeconds = Math.max(5, Number(process.env.PHOENIX_EMBEDDED_SUPERVISOR_HEARTBEAT_SECONDS ?? 15));
const jarvisApiKey = (process.env.PHOENIX_EMBEDDED_JARVIS_API_KEY ?? "").trim();
const jarvisApiBaseUrlRaw = (process.env.PHOENIX_EMBEDDED_JARVIS_API_BASE_URL ?? "").trim();
const jarvisApiBaseUrl = jarvisApiBaseUrlRaw || (jarvisApiKey ? "https://gen.pollinations.ai" : "https://text.pollinations.ai/openai");
const defaultJarvisTextModel = jarvisApiKey ? "openai-large" : "openai";
const jarvisTextModel = (process.env.PHOENIX_EMBEDDED_JARVIS_TEXT_MODEL ?? defaultJarvisTextModel).trim() || defaultJarvisTextModel;
const defaultJarvisSpeechModel = jarvisApiKey ? "openai-audio" : "tts-1";
const jarvisSpeechModel =
  (process.env.PHOENIX_EMBEDDED_JARVIS_SPEECH_MODEL ?? defaultJarvisSpeechModel).trim() || defaultJarvisSpeechModel;
const jarvisVoice = (process.env.PHOENIX_EMBEDDED_JARVIS_VOICE ?? "onyx").trim() || "onyx";
const jarvisHardCooldownSeconds = Math.min(1800, Math.max(30, Number(process.env.PHOENIX_EMBEDDED_JARVIS_HARD_COOLDOWN_SECONDS ?? 900)));
const jarvisSoftCooldownSeconds = Math.min(1800, Math.max(15, Number(process.env.PHOENIX_EMBEDDED_JARVIS_SOFT_COOLDOWN_SECONDS ?? 120)));
const MAX_AGENT_FEED = 500;
const MAX_PENDING_COMMANDS = 300;
const MAX_QA_HANDOFFS = 500;

let sequence = 0;
let snapshot: DashboardSnapshot = createEmptySnapshot();
const sseClients = new Map<string, http.ServerResponse>();
const jarvisRuntime = new EmbeddedJarvisPollinationsRuntime({
  apiBaseUrl: jarvisApiBaseUrl,
  apiKey: jarvisApiKey,
  textModel: jarvisTextModel,
  speechModel: jarvisSpeechModel,
  voice: jarvisVoice,
  hardCooldownSeconds: jarvisHardCooldownSeconds,
  softCooldownSeconds: jarvisSoftCooldownSeconds
});

function createEmptySnapshot(): DashboardSnapshot {
  return {
    board: { items: [] },
    actions: { runs: [], jobs: [], pullRequests: [] },
    agents: { sessions: [], feed: [], pendingCommands: [] },
    qa: { handoffs: [] },
    meta: {
      generatedAt: new Date().toISOString(),
      sequence,
      source: "supervisor",
      streamConnected: true,
      stale: false
    }
  };
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseIsoOrNow(value: unknown): string {
  const parsed = asString(value);
  if (!parsed) {
    return new Date().toISOString();
  }
  const ms = Date.parse(parsed);
  if (!Number.isFinite(ms)) {
    return new Date().toISOString();
  }
  return new Date(ms).toISOString();
}

function normalizeTransport(value: unknown): AgentTransport {
  const lowered = (asString(value) ?? "").toLowerCase();
  if (lowered === "cli" || lowered === "local" || lowered === "cloud") {
    return lowered;
  }
  return "unknown";
}

function normalizeStatus(value: unknown): AgentStatus {
  const lowered = (asString(value) ?? "").toLowerCase();
  if (lowered === "online" || lowered === "busy" || lowered === "idle" || lowered === "waiting" || lowered === "error" || lowered === "offline") {
    return lowered;
  }
  return "online";
}

function normalizeLevel(value: unknown): AgentFeedLevel {
  const lowered = (asString(value) ?? "").toLowerCase();
  if (lowered === "warn" || lowered === "error") {
    return lowered;
  }
  return "info";
}

function normalizeRisk(value: unknown): AgentCommandRisk {
  const lowered = (asString(value) ?? "").toLowerCase();
  if (lowered === "high" || lowered === "medium") {
    return lowered;
  }
  return "low";
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => asString(entry))
      .filter((entry): entry is string => Boolean(entry));
  }

  const single = asString(value);
  return single ? [single] : [];
}

function toProposedPullRequest(value: unknown): QaProposedPullRequest {
  if (!value || typeof value !== "object") {
    return {
      title: null,
      body: null,
      base: null,
      head: null,
      draft: false
    };
  }
  const raw = value as Record<string, unknown>;
  return {
    title: asString(raw.title) ?? null,
    body: asString(raw.body) ?? null,
    base: asString(raw.base) ?? null,
    head: asString(raw.head) ?? null,
    draft: Boolean(raw.draft)
  };
}

function makeQaFeedMessage(action: "queued" | "approved" | "rejected", handoff: QaHandoff, note: string | null): string {
  if (action === "queued") {
    return `QA queued: ${handoff.title} (${handoff.handoffId})`;
  }
  const suffix = note ? ` (${note})` : "";
  return `QA ${action}: ${handoff.title} (${handoff.handoffId})${suffix}`;
}

function incrementSequence(): number {
  sequence += 1;
  snapshot.meta.sequence = sequence;
  return sequence;
}

function makeEnvelope(eventType: StreamEnvelope["eventType"], payload: unknown, source = "embedded-supervisor"): StreamEnvelope {
  const current = incrementSequence();
  return {
    eventId: `${Date.now()}-${current}`,
    sequence: current,
    eventType,
    occurredAt: new Date().toISOString(),
    source,
    payload
  };
}

function publish(envelope: StreamEnvelope): void {
  const serialized = JSON.stringify(envelope);
  for (const res of sseClients.values()) {
    res.write(`id: ${envelope.eventId}\n`);
    res.write(`event: ${envelope.eventType}\n`);
    res.write(`data: ${serialized}\n\n`);
  }
}

function broadcastSnapshot(source = "embedded-supervisor"): void {
  snapshot.meta.generatedAt = new Date().toISOString();
  snapshot.meta.source = "supervisor";
  snapshot.meta.streamConnected = true;
  publish(makeEnvelope("snapshot", snapshot, source));
}

function requireAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!apiToken) {
    return true;
  }
  const header = req.headers.authorization ?? "";
  if (header === `Bearer ${apiToken}`) {
    return true;
  }
  writeJson(res, 401, { ok: false, error: "Unauthorized" });
  return false;
}

function writeJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const data = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(data);
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

function parseAgentSession(body: unknown): { ok: true; session: AgentSession; feedEntry?: AgentFeedEntry } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON payload." };
  }
  const raw = body as Record<string, unknown>;
  const sessionId = asString(raw.sessionId);
  const agentId = asString(raw.agentId);
  if (!sessionId || !agentId) {
    return { ok: false, error: "sessionId and agentId are required." };
  }

  const now = new Date().toISOString();
  const session: AgentSession = {
    sessionId,
    agentId,
    transport: normalizeTransport(raw.transport),
    status: normalizeStatus(raw.status),
    summary: asString(raw.summary) ?? null,
    service: asString(raw.service) ?? null,
    mode: asString(raw.mode) ?? null,
    model: asString(raw.model) ?? null,
    toolProfile: asString(raw.toolProfile) ?? null,
    mcpTools: asStringArray(raw.mcpTools),
    workspace: asString(raw.workspace) ?? null,
    repository: asString(raw.repository) ?? null,
    branch: asString(raw.branch) ?? null,
    startedAt: parseIsoOrNow(raw.startedAt ?? now),
    lastHeartbeat: parseIsoOrNow(raw.lastHeartbeat ?? now),
    updatedAt: parseIsoOrNow(raw.updatedAt ?? raw.lastHeartbeat ?? now)
  };

  const feedMessage = asString(raw.feedMessage);
  if (!feedMessage) {
    return { ok: true, session };
  }

  const feedEntry: AgentFeedEntry = {
    entryId: `${session.sessionId}:${Date.now()}`,
    sessionId: session.sessionId,
    agentId: session.agentId,
    transport: session.transport,
    level: normalizeLevel(raw.feedLevel),
    message: feedMessage,
    service: session.service ?? null,
    mode: session.mode ?? null,
    model: session.model ?? null,
    toolProfile: session.toolProfile ?? null,
    mcpTools: [...(session.mcpTools ?? [])],
    repository: session.repository,
    workspace: session.workspace,
    occurredAt: session.updatedAt
  };
  return { ok: true, session, feedEntry };
}

function parseAgentFeed(body: unknown): { ok: true; entry: AgentFeedEntry } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON payload." };
  }
  const raw = body as Record<string, unknown>;
  const agentId = asString(raw.agentId);
  const message = asString(raw.message);
  if (!agentId || !message) {
    return { ok: false, error: "agentId and message are required." };
  }

  return {
    ok: true,
    entry: {
      entryId: asString(raw.entryId) ?? `${agentId}:${Date.now()}`,
      sessionId: asString(raw.sessionId) ?? null,
      agentId,
      transport: normalizeTransport(raw.transport),
      level: normalizeLevel(raw.level),
      message,
      service: asString(raw.service) ?? null,
      mode: asString(raw.mode) ?? null,
      model: asString(raw.model) ?? null,
      toolProfile: asString(raw.toolProfile) ?? null,
      mcpTools: asStringArray(raw.mcpTools),
      repository: asString(raw.repository) ?? null,
      workspace: asString(raw.workspace) ?? null,
      occurredAt: parseIsoOrNow(raw.occurredAt)
    }
  };
}

function parseAgentMessage(body: unknown): { ok: true; feedEntry: AgentFeedEntry; pendingCommand?: AgentPendingCommand } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON payload." };
  }
  const raw = body as Record<string, unknown>;
  const message = asString(raw.message);
  if (!message) {
    return { ok: false, error: "message is required." };
  }

  const sessionId = asString(raw.sessionId) ?? null;
  const session = sessionId ? snapshot.agents.sessions.find((candidate) => candidate.sessionId === sessionId) ?? null : null;
  const agentId = asString(raw.agentId) ?? session?.agentId ?? "User";
  const transport = normalizeTransport(raw.transport ?? session?.transport ?? "unknown");
  const now = new Date().toISOString();

  const feedEntry: AgentFeedEntry = {
    entryId: `${agentId}:${Date.now()}`,
    sessionId,
    agentId,
    transport,
    level: "info",
    message,
    service: asString(raw.service) ?? session?.service ?? null,
    mode: asString(raw.mode) ?? session?.mode ?? null,
    model: asString(raw.model) ?? session?.model ?? null,
    toolProfile: asString(raw.toolProfile) ?? session?.toolProfile ?? null,
    mcpTools: asStringArray(raw.mcpTools),
    repository: asString(raw.repository) ?? session?.repository ?? null,
    workspace: asString(raw.workspace) ?? session?.workspace ?? null,
    occurredAt: now
  };

  const requiresApproval = Boolean(raw.requiresApproval) || Boolean(asString(raw.pendingCommand));
  if (!requiresApproval) {
    return { ok: true, feedEntry };
  }

  const commandText = asString(raw.pendingCommand);
  if (!commandText) {
    return { ok: false, error: "pendingCommand is required when requiresApproval=true." };
  }

  const pendingCommand: AgentPendingCommand = {
    commandId: `${agentId}:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`,
    sessionId,
    agentId,
    transport,
    command: commandText,
    reason: asString(raw.pendingReason) ?? "Awaiting operator approval.",
    risk: normalizeRisk(raw.pendingRisk),
    status: "pending",
    createdAt: now,
    updatedAt: now
  };

  feedEntry.level = pendingCommand.risk === "high" ? "warn" : "info";
  feedEntry.message = `${message} (approval required: ${pendingCommand.command})`;
  return { ok: true, feedEntry, pendingCommand };
}

function parseAgentDispatch(body: unknown): { ok: true; session: AgentSession; feedEntry: AgentFeedEntry } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON payload." };
  }
  const raw = body as Record<string, unknown>;
  const agentId = asString(raw.agentId);
  if (!agentId) {
    return { ok: false, error: "agentId is required." };
  }

  const now = new Date().toISOString();
  const sessionId = asString(raw.sessionId) ?? `${agentId.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
  const transport = normalizeTransport(raw.transport);
  const session: AgentSession = {
    sessionId,
    agentId,
    transport,
    status: "waiting",
    summary: asString(raw.summary) ?? "Dispatch queued.",
    service: asString(raw.service) ?? null,
    mode: asString(raw.mode) ?? null,
    model: asString(raw.model) ?? null,
    toolProfile: asString(raw.toolProfile) ?? null,
    mcpTools: asStringArray(raw.mcpTools),
    workspace: asString(raw.workspace) ?? null,
    repository: asString(raw.repository) ?? null,
    branch: asString(raw.branch) ?? null,
    startedAt: now,
    lastHeartbeat: now,
    updatedAt: now
  };

  const feedEntry: AgentFeedEntry = {
    entryId: `${sessionId}:${Date.now()}`,
    sessionId,
    agentId,
    transport,
    level: "info",
    message: `Dispatch requested: ${session.summary}`,
    service: session.service ?? null,
    mode: session.mode ?? null,
    model: session.model ?? null,
    toolProfile: session.toolProfile ?? null,
    mcpTools: [...(session.mcpTools ?? [])],
    repository: session.repository,
    workspace: session.workspace,
    occurredAt: now
  };

  return { ok: true, session, feedEntry };
}

function parseAgentCommandDecision(body: unknown): { ok: true; command: AgentPendingCommand; feedEntry: AgentFeedEntry } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON payload." };
  }
  const raw = body as Record<string, unknown>;
  const commandId = asString(raw.commandId);
  if (!commandId) {
    return { ok: false, error: "commandId is required." };
  }

  const existing = snapshot.agents.pendingCommands.find((candidate) => candidate.commandId === commandId);
  if (!existing) {
    return { ok: false, error: `No pending command found for ${commandId}.` };
  }

  const now = new Date().toISOString();
  const approved = Boolean(raw.approve);
  const note = asString(raw.note);

  const command: AgentPendingCommand = {
    ...existing,
    status: approved ? "approved" : "rejected",
    updatedAt: now
  };
  const feedEntry: AgentFeedEntry = {
    entryId: `${existing.agentId}:${Date.now()}`,
    sessionId: existing.sessionId,
    agentId: existing.agentId,
    transport: existing.transport,
    level: approved ? "info" : "warn",
    message: `Command ${approved ? "approved" : "rejected"}: ${existing.command}${note ? ` (${note})` : ""}`,
    repository: null,
    workspace: null,
    occurredAt: now
  };
  return { ok: true, command, feedEntry };
}

function parseQaHandoff(
  body: unknown
): { ok: true; handoff: QaHandoff; pendingCommand: AgentPendingCommand; feedEntry: AgentFeedEntry } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON payload." };
  }

  const raw = body as Record<string, unknown>;
  const agentId = asString(raw.agentId);
  const title = asString(raw.title);
  const summary = asString(raw.summary);
  if (!agentId || !title || !summary) {
    return { ok: false, error: "agentId, title, and summary are required." };
  }

  const now = new Date().toISOString();
  const handoffId = asString(raw.handoffId) ?? `qa-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const existing = snapshot.qa.handoffs.find((candidate) => candidate.handoffId === handoffId);
  const linkedCommandId = existing?.linkedCommandId ?? `qa:${handoffId}`;

  const handoff: QaHandoff = {
    handoffId,
    sessionId: asString(raw.sessionId) ?? existing?.sessionId ?? null,
    agentId,
    transport: normalizeTransport(raw.transport ?? existing?.transport ?? "unknown"),
    repository: asString(raw.repository) ?? existing?.repository ?? null,
    branch: asString(raw.branch) ?? existing?.branch ?? null,
    workspace: asString(raw.workspace) ?? existing?.workspace ?? null,
    title,
    summary,
    validation: asStringArray(raw.validation),
    artifacts: asStringArray(raw.artifacts),
    proposedPullRequest: raw.proposedPullRequest ? toProposedPullRequest(raw.proposedPullRequest) : existing?.proposedPullRequest ?? toProposedPullRequest(null),
    status: "pending",
    linkedCommandId,
    decisionNote: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  const pendingCommand: AgentPendingCommand = {
    commandId: linkedCommandId,
    sessionId: handoff.sessionId,
    agentId: handoff.agentId,
    transport: handoff.transport,
    command: `qa.approve ${handoff.handoffId}`,
    reason: `QA required before PR: ${handoff.summary}`,
    risk: "medium",
    status: "pending",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  const feedEntry: AgentFeedEntry = {
    entryId: `${handoff.agentId}:${Date.now()}`,
    sessionId: handoff.sessionId,
    agentId: handoff.agentId,
    transport: handoff.transport,
    level: "info",
    message: makeQaFeedMessage("queued", handoff, null),
    repository: handoff.repository,
    workspace: handoff.workspace,
    occurredAt: now
  };

  return { ok: true, handoff, pendingCommand, feedEntry };
}

function parseQaDecision(
  body: unknown
): { ok: true; handoff: QaHandoff; pendingCommand: AgentPendingCommand; feedEntry: AgentFeedEntry } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON payload." };
  }

  const raw = body as Record<string, unknown>;
  const handoffId = asString(raw.handoffId);
  if (!handoffId) {
    return { ok: false, error: "handoffId is required." };
  }

  const existing = snapshot.qa.handoffs.find((candidate) => candidate.handoffId === handoffId);
  if (!existing) {
    return { ok: false, error: `No QA handoff found for ${handoffId}.` };
  }

  const now = new Date().toISOString();
  const approved = Boolean(raw.approve);
  const status: QaHandoffStatus = approved ? "approved" : "rejected";
  const note = asString(raw.note) ?? null;

  const handoff: QaHandoff = {
    ...existing,
    status,
    decisionNote: note,
    updatedAt: now
  };

  const existingCommand = existing.linkedCommandId
    ? snapshot.agents.pendingCommands.find((candidate) => candidate.commandId === existing.linkedCommandId) ?? null
    : null;

  const pendingCommand: AgentPendingCommand = existingCommand
    ? {
        ...existingCommand,
        status: approved ? "approved" : "rejected",
        updatedAt: now
      }
    : {
        commandId: existing.linkedCommandId ?? `qa:${existing.handoffId}`,
        sessionId: existing.sessionId,
        agentId: existing.agentId,
        transport: existing.transport,
        command: `qa.approve ${existing.handoffId}`,
        reason: `QA required before PR: ${existing.summary}`,
        risk: "medium",
        status: approved ? "approved" : "rejected",
        createdAt: existing.createdAt,
        updatedAt: now
      };

  const feedEntry: AgentFeedEntry = {
    entryId: `${existing.agentId}:${Date.now()}`,
    sessionId: existing.sessionId,
    agentId: existing.agentId,
    transport: existing.transport,
    level: approved ? "info" : "warn",
    message: makeQaFeedMessage(approved ? "approved" : "rejected", handoff, note),
    repository: existing.repository,
    workspace: existing.workspace,
    occurredAt: now
  };

  return { ok: true, handoff, pendingCommand, feedEntry };
}

function parseQaDecisionFromLinkedCommand(
  command: AgentPendingCommand,
  body: unknown
): { ok: true; handoff: QaHandoff; feedEntry: AgentFeedEntry } | { ok: false } {
  const existing = snapshot.qa.handoffs.find((handoff) => handoff.linkedCommandId === command.commandId);
  if (!existing || command.status === "pending") {
    return { ok: false };
  }

  const noteValue =
    body && typeof body === "object" ? asString((body as Record<string, unknown>).note) ?? null : null;
  const now = new Date().toISOString();
  const status: QaHandoffStatus = command.status === "approved" ? "approved" : "rejected";

  const handoff: QaHandoff = {
    ...existing,
    status,
    decisionNote: noteValue,
    updatedAt: now
  };

  const feedEntry: AgentFeedEntry = {
    entryId: `${existing.agentId}:${Date.now()}`,
    sessionId: existing.sessionId,
    agentId: existing.agentId,
    transport: existing.transport,
    level: status === "approved" ? "info" : "warn",
    message: makeQaFeedMessage(status === "approved" ? "approved" : "rejected", handoff, noteValue),
    repository: existing.repository,
    workspace: existing.workspace,
    occurredAt: now
  };

  return { ok: true, handoff, feedEntry };
}

function parseJarvisRespond(
  body: unknown
):
  | {
      ok: true;
      prompt: string;
      reason: string | null;
      auto: boolean;
      includeAudio: boolean;
      voiceOverride: string | null;
      sessionId: string;
      agentId: string;
      transport: AgentTransport;
      service: string;
      mode: string;
      model: string | null;
      toolProfile: string | null;
      mcpTools: string[];
      repository: string | null;
      workspace: string | null;
      occurredAt: string;
    }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON payload." };
  }
  const raw = body as JarvisRespondInput;
  const now = parseIsoOrNow(raw.occurredAt);
  const sessionId = asString(raw.sessionId) ?? "jarvis-voice";
  const existing = snapshot.agents.sessions.find((session) => session.sessionId === sessionId) ?? null;
  const agentId = asString(raw.agentId) ?? existing?.agentId ?? "Jarvis";
  const transportRaw = normalizeTransport(raw.transport ?? existing?.transport ?? "local");
  const transport = transportRaw === "unknown" ? "local" : transportRaw;
  const prompt = asString(raw.prompt) ?? asString(raw.text) ?? "Give a concise workspace voice summary with one next action.";
  const includeAudio = typeof raw.includeAudio === "boolean" ? raw.includeAudio : true;
  const voiceOverride = asString(raw.voice);
  return {
    ok: true,
    prompt,
    reason: asString(raw.reason),
    auto: Boolean(raw.auto),
    includeAudio,
    voiceOverride,
    sessionId,
    agentId,
    transport,
    service: asString(raw.service) ?? existing?.service ?? "jarvis",
    mode: asString(raw.mode) ?? existing?.mode ?? "voice",
    model: asString(raw.model) ?? existing?.model ?? jarvisTextModel,
    toolProfile: asString(raw.toolProfile) ?? existing?.toolProfile ?? null,
    mcpTools: asStringArray(raw.mcpTools),
    repository: asString(raw.repository) ?? existing?.repository ?? null,
    workspace: asString(raw.workspace) ?? existing?.workspace ?? null,
    occurredAt: now
  };
}

function parseJarvisSpeak(
  body: unknown
):
  | { ok: true; session: AgentSession; feedEntry: AgentFeedEntry; audioProvided: boolean }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON payload." };
  }

  const raw = body as JarvisSpeakInput;
  const text = asString(raw.message) ?? asString(raw.text);
  if (!text) {
    return { ok: false, error: "message (or text) is required." };
  }

  const now = parseIsoOrNow(raw.occurredAt);
  const sessionId = asString(raw.sessionId) ?? "jarvis-voice";
  const agentId = asString(raw.agentId) ?? "Jarvis";
  const existing = snapshot.agents.sessions.find((session) => session.sessionId === sessionId) ?? null;

  const maybeTransport = normalizeTransport(raw.transport ?? existing?.transport ?? "local");
  const transport = maybeTransport === "unknown" ? "local" : maybeTransport;
  const service = asString(raw.service) ?? existing?.service ?? "jarvis";
  const mode = asString(raw.mode) ?? existing?.mode ?? "voice";
  const model = asString(raw.model) ?? existing?.model ?? null;
  const toolProfile = asString(raw.toolProfile) ?? existing?.toolProfile ?? null;
  const incomingTools = asStringArray(raw.mcpTools);
  const mcpTools = incomingTools.length > 0 ? incomingTools : [...(existing?.mcpTools ?? [])];
  const reason = asString(raw.reason);
  const auto = Boolean(raw.auto);
  const source = asString(raw.source);
  const failureKind = asString(raw.failureKind);
  const cooldownUntil = asString(raw.cooldownUntil);

  const session: AgentSession = {
    sessionId,
    agentId,
    transport,
    status: "online",
    summary: "Jarvis voice supervisor",
    service,
    mode,
    model,
    toolProfile,
    mcpTools,
    workspace: asString(raw.workspace) ?? existing?.workspace ?? null,
    repository: asString(raw.repository) ?? existing?.repository ?? null,
    branch: existing?.branch ?? null,
    startedAt: existing?.startedAt ?? now,
    lastHeartbeat: now,
    updatedAt: now
  };

  const autoPrefix = auto ? "[auto] " : "";
  const sourcePrefix = source === "fallback" ? "[fallback] " : "";
  const reasonPrefix = reason ? `[${reason}] ` : "";
  const failurePrefix = failureKind ? `[${failureKind}] ` : "";
  const cooldownPrefix = cooldownUntil ? `[cooldown-until:${cooldownUntil}] ` : "";
  const feedEntry: AgentFeedEntry = {
    entryId: `${agentId}:${Date.now()}`,
    sessionId,
    agentId,
    transport,
    level: "info",
    message: `${autoPrefix}${sourcePrefix}${reasonPrefix}${failurePrefix}${cooldownPrefix}${text}`.trim(),
    service,
    mode,
    model,
    toolProfile,
    mcpTools,
    repository: session.repository,
    workspace: session.workspace,
    occurredAt: now
  };

  return {
    ok: true,
    session,
    feedEntry,
    audioProvided: Boolean(asString(raw.audioBase64))
  };
}

function limitFeed(feed: AgentFeedEntry[]): AgentFeedEntry[] {
  if (feed.length <= MAX_AGENT_FEED) {
    return feed;
  }
  return feed.slice(feed.length - MAX_AGENT_FEED);
}

function limitPendingCommands(commands: AgentPendingCommand[]): AgentPendingCommand[] {
  const sorted = [...commands].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  if (sorted.length <= MAX_PENDING_COMMANDS) {
    return sorted;
  }
  return sorted.slice(0, MAX_PENDING_COMMANDS);
}

function limitQaHandoffs(handoffs: QaHandoff[]): QaHandoff[] {
  const sorted = [...handoffs].sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  if (sorted.length <= MAX_QA_HANDOFFS) {
    return sorted;
  }
  return sorted.slice(0, MAX_QA_HANDOFFS);
}

function upsertSession(session: AgentSession): void {
  const sessions = [...snapshot.agents.sessions];
  const index = sessions.findIndex((candidate) => candidate.sessionId === session.sessionId);
  if (index >= 0) {
    sessions[index] = session;
  } else {
    sessions.push(session);
  }
  snapshot.agents.sessions = sessions;
}

function appendFeed(entry: AgentFeedEntry): void {
  snapshot.agents.feed = limitFeed([...snapshot.agents.feed, entry]);
}

function upsertPending(command: AgentPendingCommand): void {
  const pending = [...snapshot.agents.pendingCommands];
  const index = pending.findIndex((candidate) => candidate.commandId === command.commandId);
  if (index >= 0) {
    pending[index] = command;
  } else {
    pending.push(command);
  }
  snapshot.agents.pendingCommands = limitPendingCommands(pending);
}

function upsertHandoff(handoff: QaHandoff): void {
  const handoffs = [...snapshot.qa.handoffs];
  const index = handoffs.findIndex((candidate) => candidate.handoffId === handoff.handoffId);
  if (index >= 0) {
    handoffs[index] = handoff;
  } else {
    handoffs.push(handoff);
  }
  snapshot.qa.handoffs = limitQaHandoffs(handoffs);
}

function normalizeSnapshotInput(input: unknown): DashboardSnapshot {
  if (!input || typeof input !== "object") {
    return createEmptySnapshot();
  }
  const raw = input as Record<string, unknown>;
  const board = raw.board && typeof raw.board === "object" ? (raw.board as { items?: unknown[] }).items : [];
  const actions = raw.actions && typeof raw.actions === "object" ? (raw.actions as { runs?: unknown[]; jobs?: unknown[]; pullRequests?: unknown[] }) : {};
  const incomingAgents = raw.agents && typeof raw.agents === "object"
    ? (raw.agents as { sessions?: AgentSession[]; feed?: AgentFeedEntry[]; pendingCommands?: AgentPendingCommand[] })
    : {};
  const incomingQa = raw.qa && typeof raw.qa === "object"
    ? (raw.qa as { handoffs?: QaHandoff[] })
    : {};

  const normalized: DashboardSnapshot = {
    board: { items: Array.isArray(board) ? board : [] },
    actions: {
      runs: Array.isArray(actions.runs) ? actions.runs : [],
      jobs: Array.isArray(actions.jobs) ? actions.jobs : [],
      pullRequests: Array.isArray(actions.pullRequests) ? actions.pullRequests : []
    },
    agents: {
      sessions: Array.isArray(incomingAgents.sessions) ? incomingAgents.sessions : snapshot.agents.sessions,
      feed: limitFeed(Array.isArray(incomingAgents.feed) ? incomingAgents.feed : snapshot.agents.feed),
      pendingCommands: limitPendingCommands(Array.isArray(incomingAgents.pendingCommands) ? incomingAgents.pendingCommands : snapshot.agents.pendingCommands)
    },
    qa: {
      handoffs: limitQaHandoffs(Array.isArray(incomingQa.handoffs) ? incomingQa.handoffs : snapshot.qa.handoffs)
    },
    meta: {
      generatedAt: new Date().toISOString(),
      sequence,
      source: "supervisor",
      streamConnected: true,
      stale: Boolean(raw.meta && typeof raw.meta === "object" && (raw.meta as { stale?: unknown }).stale)
    }
  };
  return normalized;
}

async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!req.url) {
    writeJson(res, 404, { ok: false, error: "Not found" });
    return;
  }

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
    res.end();
    return;
  }

  const requestUrl = new URL(req.url, `http://${host}:${port}`);
  const pathname = requestUrl.pathname;
  const method = (req.method ?? "GET").toUpperCase();

  if (method === "GET" && pathname === "/healthz") {
    writeJson(res, 200, {
      ok: true,
      service: "phoenix-embedded-supervisor",
      now: new Date().toISOString(),
      sequence: snapshot.meta.sequence,
      sseClients: sseClients.size,
      jarvis: {
        apiBaseUrl: jarvisApiBaseUrl,
        apiKeyConfigured: Boolean(jarvisApiKey),
        textModel: jarvisTextModel,
        speechModel: jarvisSpeechModel,
        voice: jarvisVoice
      },
      dataCounts: {
        agentSessions: snapshot.agents.sessions.length,
        agentFeedEntries: snapshot.agents.feed.length,
        pendingCommands: snapshot.agents.pendingCommands.length,
        qaHandoffs: snapshot.qa.handoffs.length
      }
    });
    return;
  }

  if (!requireAuth(req, res)) {
    return;
  }

  if (method === "GET" && pathname === "/snapshot") {
    writeJson(res, 200, snapshot);
    return;
  }

  if (method === "GET" && pathname === "/events") {
    const id = randomUUID();
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders?.();
    res.write("retry: 5000\n\n");

    sseClients.set(id, res);
    req.on("close", () => {
      sseClients.delete(id);
    });

    const envelope = makeEnvelope("snapshot", snapshot);
    const serialized = JSON.stringify(envelope);
    res.write(`id: ${envelope.eventId}\n`);
    res.write(`event: ${envelope.eventType}\n`);
    res.write(`data: ${serialized}\n\n`);
    return;
  }

  if (method === "POST" && pathname === "/reconcile") {
    writeJson(res, 202, { accepted: true, queued: true });
    return;
  }

  if (method === "POST" && pathname === "/snapshot/update") {
    const body = await readJson(req);
    snapshot = normalizeSnapshotInput(body);
    broadcastSnapshot("embedded-sync");
    writeJson(res, 202, { accepted: true, sequence: snapshot.meta.sequence });
    return;
  }

  if (method === "POST" && pathname === "/agents/session") {
    const parsed = parseAgentSession(await readJson(req));
    if (!parsed.ok) {
      writeJson(res, 400, { accepted: false, error: parsed.error });
      return;
    }
    upsertSession(parsed.session);
    publish(makeEnvelope("agents.session.upserted", parsed.session, "embedded:agents:session"));
    if (parsed.feedEntry) {
      appendFeed(parsed.feedEntry);
      publish(makeEnvelope("agents.feed.appended", parsed.feedEntry, "embedded:agents:session"));
    }
    broadcastSnapshot("embedded:agents:session");
    writeJson(res, 202, { accepted: true, sessionId: parsed.session.sessionId });
    return;
  }

  if (method === "POST" && pathname === "/agents/feed") {
    const parsed = parseAgentFeed(await readJson(req));
    if (!parsed.ok) {
      writeJson(res, 400, { accepted: false, error: parsed.error });
      return;
    }
    appendFeed(parsed.entry);
    publish(makeEnvelope("agents.feed.appended", parsed.entry, "embedded:agents:feed"));
    broadcastSnapshot("embedded:agents:feed");
    writeJson(res, 202, { accepted: true, entryId: parsed.entry.entryId });
    return;
  }

  if (method === "POST" && pathname === "/agents/message") {
    const parsed = parseAgentMessage(await readJson(req));
    if (!parsed.ok) {
      writeJson(res, 400, { accepted: false, error: parsed.error });
      return;
    }
    appendFeed(parsed.feedEntry);
    publish(makeEnvelope("agents.feed.appended", parsed.feedEntry, "embedded:agents:message"));
    if (parsed.pendingCommand) {
      upsertPending(parsed.pendingCommand);
      publish(makeEnvelope("agents.command.upserted", parsed.pendingCommand, "embedded:agents:message"));
    }
    broadcastSnapshot("embedded:agents:message");
    writeJson(res, 202, { accepted: true, entryId: parsed.feedEntry.entryId, pendingCommandId: parsed.pendingCommand?.commandId ?? null });
    return;
  }

  if (method === "POST" && pathname === "/agents/dispatch") {
    const parsed = parseAgentDispatch(await readJson(req));
    if (!parsed.ok) {
      writeJson(res, 400, { accepted: false, error: parsed.error });
      return;
    }
    upsertSession(parsed.session);
    appendFeed(parsed.feedEntry);
    publish(makeEnvelope("agents.session.upserted", parsed.session, "embedded:agents:dispatch"));
    publish(makeEnvelope("agents.feed.appended", parsed.feedEntry, "embedded:agents:dispatch"));
    broadcastSnapshot("embedded:agents:dispatch");
    writeJson(res, 202, { accepted: true, sessionId: parsed.session.sessionId });
    return;
  }

  if (method === "POST" && pathname === "/agents/command/decision") {
    const body = await readJson(req);
    const parsed = parseAgentCommandDecision(body);
    if (!parsed.ok) {
      writeJson(res, 400, { accepted: false, error: parsed.error });
      return;
    }
    upsertPending(parsed.command);
    appendFeed(parsed.feedEntry);
    publish(makeEnvelope("agents.command.upserted", parsed.command, "embedded:agents:decision"));
    publish(makeEnvelope("agents.feed.appended", parsed.feedEntry, "embedded:agents:decision"));

    const qaLinked = parseQaDecisionFromLinkedCommand(parsed.command, body);
    if (qaLinked.ok) {
      upsertHandoff(qaLinked.handoff);
      appendFeed(qaLinked.feedEntry);
      publish(makeEnvelope("qa.handoff.upserted", qaLinked.handoff, "embedded:qa:decision"));
      publish(makeEnvelope("agents.feed.appended", qaLinked.feedEntry, "embedded:qa:decision"));
    }

    broadcastSnapshot("embedded:agents:decision");
    writeJson(res, 202, { accepted: true, commandId: parsed.command.commandId, status: parsed.command.status });
    return;
  }

  if (method === "POST" && (pathname === "/jarvis/speak" || pathname === "/agents/jarvis/speak")) {
    const parsed = parseJarvisSpeak(await readJson(req));
    if (!parsed.ok) {
      writeJson(res, 400, { accepted: false, error: parsed.error });
      return;
    }
    upsertSession(parsed.session);
    appendFeed(parsed.feedEntry);
    publish(makeEnvelope("agents.session.upserted", parsed.session, "embedded:jarvis:speak"));
    publish(makeEnvelope("agents.feed.appended", parsed.feedEntry, "embedded:jarvis:speak"));
    broadcastSnapshot("embedded:jarvis:speak");
    writeJson(res, 202, {
      accepted: true,
      sessionId: parsed.session.sessionId,
      entryId: parsed.feedEntry.entryId,
      audioAccepted: parsed.audioProvided
    });
    return;
  }

  if (method === "POST" && (pathname === "/jarvis/respond" || pathname === "/agents/jarvis/respond")) {
    const parsed = parseJarvisRespond(await readJson(req));
    if (!parsed.ok) {
      writeJson(res, 400, { accepted: false, error: parsed.error });
      return;
    }

    const result = await jarvisRuntime.respond({
      prompt: parsed.prompt,
      auto: parsed.auto,
      reason: parsed.reason,
      includeAudio: parsed.includeAudio,
      voiceOverride: parsed.voiceOverride,
      snapshot
    });

    const speak = parseJarvisSpeak({
      sessionId: parsed.sessionId,
      agentId: parsed.agentId,
      transport: parsed.transport,
      text: result.text,
      reason: parsed.reason,
      auto: parsed.auto,
      service: parsed.service,
      mode: parsed.mode,
      model: parsed.model,
      toolProfile: parsed.toolProfile,
      mcpTools: parsed.mcpTools,
      repository: parsed.repository,
      workspace: parsed.workspace,
      occurredAt: parsed.occurredAt,
      mimeType: result.mimeType,
      audioBase64: result.audioBase64,
      source: result.source,
      failureKind: result.failureKind,
      cooldownUntil: result.chat.cooldownUntil ?? result.speech.cooldownUntil
    } satisfies JarvisSpeakInput);
    if (!speak.ok) {
      writeJson(res, 500, { accepted: false, error: speak.error });
      return;
    }

    upsertSession(speak.session);
    appendFeed(speak.feedEntry);
    publish(makeEnvelope("agents.session.upserted", speak.session, "embedded:jarvis:respond"));
    publish(makeEnvelope("agents.feed.appended", speak.feedEntry, "embedded:jarvis:respond"));
    broadcastSnapshot("embedded:jarvis:respond");
    writeJson(res, 202, {
      accepted: true,
      sessionId: speak.session.sessionId,
      entryId: speak.feedEntry.entryId,
      source: result.source,
      text: result.text,
      audioAccepted: Boolean(result.audioBase64),
      mimeType: result.mimeType,
      audioBase64: result.audioBase64,
      failureKind: result.failureKind,
      chat: result.chat,
      speech: result.speech
    });
    return;
  }

  if (method === "GET" && pathname === "/qa/handoffs") {
    const status = asString(requestUrl.searchParams.get("status"));
    const repository = asString(requestUrl.searchParams.get("repository"));
    const handoffs = snapshot.qa.handoffs.filter((handoff) => {
      if (status && handoff.status !== status) {
        return false;
      }
      if (repository && handoff.repository !== repository) {
        return false;
      }
      return true;
    });
    writeJson(res, 200, { handoffs, total: handoffs.length });
    return;
  }

  if (method === "GET" && pathname.startsWith("/qa/handoff/")) {
    const handoffId = decodeURIComponent(pathname.slice("/qa/handoff/".length));
    const handoff = snapshot.qa.handoffs.find((candidate) => candidate.handoffId === handoffId);
    if (!handoff) {
      writeJson(res, 404, { accepted: false, error: `No QA handoff found for ${handoffId}.` });
      return;
    }
    writeJson(res, 200, { handoff });
    return;
  }

  if (method === "POST" && pathname === "/qa/handoff") {
    const parsed = parseQaHandoff(await readJson(req));
    if (!parsed.ok) {
      writeJson(res, 400, { accepted: false, error: parsed.error });
      return;
    }
    upsertHandoff(parsed.handoff);
    upsertPending(parsed.pendingCommand);
    appendFeed(parsed.feedEntry);
    publish(makeEnvelope("qa.handoff.upserted", parsed.handoff, "embedded:qa:handoff"));
    publish(makeEnvelope("agents.command.upserted", parsed.pendingCommand, "embedded:qa:handoff"));
    publish(makeEnvelope("agents.feed.appended", parsed.feedEntry, "embedded:qa:handoff"));
    broadcastSnapshot("embedded:qa:handoff");
    writeJson(res, 202, {
      accepted: true,
      handoffId: parsed.handoff.handoffId,
      linkedCommandId: parsed.pendingCommand.commandId,
      status: parsed.handoff.status
    });
    return;
  }

  if (method === "POST" && pathname === "/qa/handoff/decision") {
    const parsed = parseQaDecision(await readJson(req));
    if (!parsed.ok) {
      writeJson(res, 400, { accepted: false, error: parsed.error });
      return;
    }
    upsertHandoff(parsed.handoff);
    upsertPending(parsed.pendingCommand);
    appendFeed(parsed.feedEntry);
    publish(makeEnvelope("qa.handoff.upserted", parsed.handoff, "embedded:qa:decision"));
    publish(makeEnvelope("agents.command.upserted", parsed.pendingCommand, "embedded:qa:decision"));
    publish(makeEnvelope("agents.feed.appended", parsed.feedEntry, "embedded:qa:decision"));
    broadcastSnapshot("embedded:qa:decision");
    writeJson(res, 202, {
      accepted: true,
      handoffId: parsed.handoff.handoffId,
      status: parsed.handoff.status,
      linkedCommandStatus: parsed.pendingCommand.status
    });
    return;
  }

  if (method === "POST" && pathname === "/agents/stop") {
    const body = await readJson(req);
    if (!body || typeof body !== "object") {
      writeJson(res, 400, { accepted: false, error: "Invalid JSON payload." });
      return;
    }
    const raw = body as Record<string, unknown>;
    const sessionId = asString(raw.sessionId);
    const agentId = asString(raw.agentId);
    if (!sessionId && !agentId) {
      writeJson(res, 400, { accepted: false, error: "sessionId or agentId is required." });
      return;
    }

    const sessions = [...snapshot.agents.sessions];
    let updated = 0;
    const now = new Date().toISOString();
    for (let index = 0; index < sessions.length; index += 1) {
      const session = sessions[index];
      if ((sessionId && session.sessionId === sessionId) || (agentId && session.agentId === agentId)) {
        sessions[index] = {
          ...session,
          status: "offline",
          updatedAt: now,
          lastHeartbeat: now
        };
        updated += 1;
      }
    }
    snapshot.agents.sessions = sessions;

    if (updated > 0) {
      const feedEntry: AgentFeedEntry = {
        entryId: `${agentId ?? sessionId ?? "session"}:${Date.now()}`,
        sessionId: sessionId ?? null,
        agentId: agentId ?? "Agent",
        transport: normalizeTransport(raw.transport),
        level: "warn",
        message: "Session stop requested by operator.",
        repository: null,
        workspace: null,
        occurredAt: now
      };
      appendFeed(feedEntry);
      publish(makeEnvelope("agents.feed.appended", feedEntry, "embedded:agents:stop"));
      broadcastSnapshot("embedded:agents:stop");
    }

    writeJson(res, 202, { accepted: true, updated });
    return;
  }

  if (method === "POST" && pathname === "/webhooks/github") {
    writeJson(res, 202, { accepted: true, queued: false, embedded: true });
    return;
  }

  writeJson(res, 404, { ok: false, error: "Not found" });
}

const server = http.createServer((req, res) => {
  void route(req, res).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    writeJson(res, 500, { ok: false, error: message });
  });
});

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`Embedded supervisor listening on http://${host}:${port}`);
});

setInterval(() => {
  publish(
    makeEnvelope("heartbeat", {
      generatedAt: new Date().toISOString(),
      sequence: snapshot.meta.sequence
    })
  );
}, heartbeatSeconds * 1000);
