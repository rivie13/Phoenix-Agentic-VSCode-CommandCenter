import type { JarvisFocusHint } from "../controller/CommandCenterPayloads";
import type { AgentSession, DashboardSnapshot } from "../types";

export interface JarvisAutoDecision {
  reason: string;
  prompt: string;
  focusHint: JarvisFocusHint | null;
}

export interface PickJarvisAutoDecisionInput {
  nowMs: number;
  lastAnnouncementMs: number;
  jarvisOfferJokes: boolean;
  randomValue: number;
}

function jarvisStatusPriority(status: AgentSession["status"]): number {
  if (status === "error") {
    return 0;
  }
  if (status === "waiting") {
    return 1;
  }
  if (status === "busy") {
    return 2;
  }
  if (status === "online") {
    return 3;
  }
  if (status === "idle") {
    return 4;
  }
  if (status === "offline") {
    return 5;
  }
  return 6;
}

function parseJarvisTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clipJarvisContext(value: string | null | undefined, maxLength: number): string {
  if (!value) {
    return "";
  }
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

function prioritizedJarvisSessions(snapshot: DashboardSnapshot): AgentSession[] {
  return [...snapshot.agents.sessions].sort((left, right) => {
    const rankDelta = jarvisStatusPriority(left.status) - jarvisStatusPriority(right.status);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return parseJarvisTimestamp(right.updatedAt) - parseJarvisTimestamp(left.updatedAt);
  });
}

export function focusFromSessionId(
  snapshot: DashboardSnapshot,
  sessionId: string | null,
  fallbackLabel: string
): JarvisFocusHint | null {
  if (!sessionId) {
    return null;
  }
  const session = snapshot.agents.sessions.find((candidate) => candidate.sessionId === sessionId);
  if (!session) {
    return null;
  }
  return {
    kind: "session",
    id: session.sessionId,
    label: session.summary ? `${session.agentId}: ${session.summary}` : fallbackLabel
  };
}

export function pickAutoJarvisDecision(
  snapshot: DashboardSnapshot,
  input: PickJarvisAutoDecisionInput
): JarvisAutoDecision | null {
  const pending = snapshot.agents.pendingCommands.filter((command) => command.status === "pending");
  const highRiskPending = pending.filter((command) => command.risk === "high");
  if (highRiskPending.length > 0) {
    const command = highRiskPending[0];
    return {
      reason: "high-risk-pending",
      prompt: `High-risk approvals are waiting (${highRiskPending.length} pending). Give a concise escalation with one clear next step.`,
      focusHint: focusFromSessionId(snapshot, command.sessionId, `Pending command from ${command.agentId}`)
    };
  }

  const waitingSessions = snapshot.agents.sessions.filter((session) => session.status === "waiting");
  if (waitingSessions.length >= 3) {
    const session = waitingSessions[0];
    return {
      reason: "agent-waiting-queue",
      prompt: `There are ${waitingSessions.length} waiting agent sessions. Give a short prioritization suggestion and ask if dispatch order should be adjusted.`,
      focusHint: {
        kind: "session",
        id: session.sessionId,
        label: `Waiting session ${session.agentId}`
      }
    };
  }

  const warningFeed = snapshot.agents.feed
    .filter((entry) => entry.level !== "info")
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, 6);

  if (warningFeed.length >= 4) {
    const entry = warningFeed[0];
    return {
      reason: "feed-weirdness",
      prompt: `Recent agent feed looks unusual (${warningFeed.length} warn/error events). Give a calm investigation recommendation.`,
      focusHint: focusFromSessionId(snapshot, entry.sessionId, `Investigate feed warning from ${entry.agentId}`)
    };
  }

  const actionNeedsAttention = snapshot.actions.runs.filter((run) => {
    const conclusion = (run.conclusion ?? "").toLowerCase();
    return ["failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(conclusion);
  });

  if (actionNeedsAttention.length >= 2) {
    const run = actionNeedsAttention[0];
    return {
      reason: "actions-needs-attention",
      prompt: `Workflow failures require attention (${actionNeedsAttention.length} runs). Give a concise action plan and ask if you should summarize failing jobs.`,
      focusHint: {
        kind: "run",
        id: String(run.id),
        label: `Workflow run ${run.repo}#${run.id}`
      }
    };
  }

  const quietWindowMs = 20 * 60_000;
  if (input.nowMs - input.lastAnnouncementMs >= quietWindowMs && input.randomValue < 0.12) {
    const offerJokeLine = input.jarvisOfferJokes
      ? "Ask whether the operator wants a short joke."
      : "Skip any joke offers.";
    return {
      reason: "all-clear-checkin",
      prompt: `Things appear stable. Give a friendly status check-in with one recommendation. ${offerJokeLine}`,
      focusHint: null
    };
  }

  return null;
}

export function buildJarvisSystemPrompt(auto: boolean): string {
  if (auto) {
    return [
      "You are Jarvis, the Phoenix Ops workspace voice supervisor.",
      "Speak with calm, witty professionalism.",
      "Use exactly 2 to 3 sentences.",
      "Focus on concrete operational status, what seems unusual, and a clear next action.",
      "If things are calm, you may ask once whether the operator wants a short joke.",
      "Do not invent data."
    ].join(" ");
  }

  return [
    "You are Jarvis, the Phoenix Ops command center assistant.",
    "Be concise, tactical, and slightly witty.",
    "Prefer 2 to 4 sentences unless the operator asked for deep detail.",
    "When asked for status, summarize active sessions, waiting agents, pending approvals, and workflow attention items.",
    "Do not invent data."
  ].join(" ");
}

export function buildJarvisUserPrompt(prompt: string, snapshot: DashboardSnapshot, auto: boolean): string {
  const waiting = snapshot.agents.sessions.filter((session) => session.status === "waiting").length;
  const errored = snapshot.agents.sessions.filter((session) => session.status === "error").length;
  const pending = snapshot.agents.pendingCommands.filter((command) => command.status === "pending");
  const highRisk = pending.filter((command) => command.risk === "high").length;
  const mediumRisk = pending.filter((command) => command.risk === "medium").length;
  const lowRisk = pending.filter((command) => command.risk === "low").length;
  const reviewAttention = snapshot.actions.pullRequests.filter(
    (pr) => pr.reviewState === "review_required" || pr.reviewState === "changes_requested"
  );
  const attentionRuns = snapshot.actions.runs.filter((run) => {
    const conclusion = (run.conclusion ?? "").toLowerCase();
    return ["failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(conclusion);
  }).length;
  const sessionHighlights = prioritizedJarvisSessions(snapshot)
    .slice(0, 8)
    .map(
      (session) =>
        `${session.agentId} [${session.status}/${session.transport}] repo=${clipJarvisContext(session.repository ?? session.workspace, 40)} ` +
        `branch=${clipJarvisContext(session.branch, 24)} summary=${clipJarvisContext(session.summary, 120)}`
    )
    .join(" | ");
  const pendingDetails = pending
    .slice(0, 6)
    .map((command) => {
      const reason = clipJarvisContext(command.reason, 120);
      return `${command.agentId} [${command.risk}] command=${clipJarvisContext(command.command, 80)}${reason ? ` reason=${reason}` : ""}`;
    })
    .join(" | ");
  const pullRequestDetails = reviewAttention
    .slice(0, 5)
    .map((pr) => `${pr.repo}#${pr.number} [${pr.reviewState}] ${clipJarvisContext(pr.title, 96)}`)
    .join(" | ");
  const latestFeed = [...snapshot.agents.feed]
    .sort((a, b) => parseJarvisTimestamp(b.occurredAt) - parseJarvisTimestamp(a.occurredAt))
    .slice(0, 10)
    .map((entry) => `[${entry.level}] ${entry.agentId}: ${clipJarvisContext(entry.message, 140)}`)
    .join(" | ");

  return [
    `Operator request: ${prompt}`,
    `Mode: ${auto ? "automatic callout" : "manual interaction"}`,
    "Generate a spoken-ready summary from current session context only. Do not invent details.",
    `Board items: ${snapshot.board.items.length}`,
    `Actions runs: ${snapshot.actions.runs.length} total, ${attentionRuns} need attention`,
    `Agent sessions: ${snapshot.agents.sessions.length} total, ${waiting} waiting, ${errored} error`,
    `Session highlights: ${sessionHighlights || "none"}`,
    `Pending commands: ${pending.length} total (${highRisk} high / ${mediumRisk} medium / ${lowRisk} low)`,
    `Pending command details: ${pendingDetails || "none"}`,
    `Pull requests needing review: ${reviewAttention.length} total`,
    `Pull request details: ${pullRequestDetails || "none"}`,
    `Recent session feed: ${latestFeed || "none"}`
  ].join("\n");
}

export function buildFallbackJarvisReply(snapshot: DashboardSnapshot, prompt: string, auto: boolean): string {
  const waiting = snapshot.agents.sessions.filter((session) => session.status === "waiting").length;
  const pending = snapshot.agents.pendingCommands.filter((command) => command.status === "pending").length;
  const failures = snapshot.actions.runs.filter((run) => {
    const conclusion = (run.conclusion ?? "").toLowerCase();
    return ["failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(conclusion);
  }).length;
  const lead = auto
    ? "Quick supervisor check: "
    : "Current workspace status: ";
  const extra = /\bjoke\b/i.test(prompt)
    ? "Would you like a very short ops-safe joke after this update?"
    : "I can provide deeper session-by-session details if you want.";
  const primary = prioritizedJarvisSessions(snapshot)[0];
  const primaryLine = primary
    ? `${primary.agentId} is ${primary.status}${primary.summary ? ` (${clipJarvisContext(primary.summary, 100)})` : ""}.`
    : "No specific agent session is currently highlighted.";

  return `${lead}${waiting} session${waiting === 1 ? "" : "s"} waiting, ${pending} pending command${pending === 1 ? "" : "s"}, and ${failures} workflow run${failures === 1 ? "" : "s"} need attention. ${primaryLine} ${extra}`;
}
