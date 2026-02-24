import type { JarvisFocusHint } from "../controller/CommandCenterPayloads";
import type { AgentSession, DashboardSnapshot } from "../types";

/**
 * User identity and preferences for personalized Jarvis interaction.
 * If name is null, Jarvis will request it on first available prompt.
 */
export interface JarvisIdentity {
  name: string | null;
  preferredPronouns?: "he/him" | "she/her" | "they/them" | "other";
  isIdentityComplete: boolean; // false if name missing
}

/**
 * Personality mode that adapts Jarvis's tone based on operational context.
 */
export type JarvisPersonalityMode =
  | "serene" // all clear, calm operations
  | "attentive" // normal activity, paying attention
  | "alert" // multiple issues or stale items
  | "escalating"; // urgent/high-risk items requiring immediate attention

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
  identity?: JarvisIdentity;
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

function isJarvisMetaSession(session: AgentSession): boolean {
  const service = (session.service ?? "").toLowerCase();
  const agentId = session.agentId.toLowerCase();
  return service === "jarvis" || agentId.includes("jarvis");
}

function nonMetaJarvisSessions(snapshot: DashboardSnapshot): AgentSession[] {
  return snapshot.agents.sessions.filter((session) => !isJarvisMetaSession(session));
}

function prioritizedJarvisSessions(snapshot: DashboardSnapshot): AgentSession[] {
  return [...nonMetaJarvisSessions(snapshot)].sort((left, right) => {
    const rankDelta = jarvisStatusPriority(left.status) - jarvisStatusPriority(right.status);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return parseJarvisTimestamp(right.updatedAt) - parseJarvisTimestamp(left.updatedAt);
  });
}

/**
 * Determine Jarvis's personality mode based on operational context.
 * Reflects urgency, staleness, and overall system health.
 * Exported for use in handler coordination.
 */
export function determineJarvisPersonality(
  snapshot: DashboardSnapshot,
  lastAnnouncementMs: number,
  nowMs: number
): JarvisPersonalityMode {
  const sessions = nonMetaJarvisSessions(snapshot);
  const pending = snapshot.agents.pendingCommands.filter((command) => command.status === "pending");
  const highRiskPending = pending.filter((command) => command.risk === "high");
  const errorSessions = sessions.filter((session) => session.status === "error");
  const staleMs = nowMs - lastAnnouncementMs;
  const staleThresholdMs = 30 * 60_000; // 30 minutes

  // Escalating: multiple critical issues
  if (highRiskPending.length > 0 || errorSessions.length >= 2) {
    return "escalating";
  }

  // Alert: stale + some issues, or moderate complexity
  if (staleMs > staleThresholdMs && (pending.length > 0 || errorSessions.length === 1)) {
    return "alert";
  }

  // Attentive: routine operations
  if (pending.length > 0 || sessions.length > 2 || errorSessions.length === 1) {
    return "attentive";
  }

  // Serene: everything calm
  return "serene";
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
  const sessions = nonMetaJarvisSessions(snapshot);
  // Identity collection is handled at startup via VS Code QuickInput (see loadJarvisIdentity).
  // The identity is made available here for personalisation in prompts but does not gate decisions.

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

  const waitingSessions = sessions.filter((session) => session.status === "waiting");
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

/**
 * Build a personality-aware system prompt for Jarvis.
 * Adapts tone, attitude, and response expectations based on context.
 *
 * @param personality Current operational personality mode (serene/attentive/alert/escalating)
 * @param auto true for automatic supervisor announcements, false for manual chat
 * @param identity User identity (name, pronouns) if available
 */
export function buildJarvisSystemPrompt(
  personality: JarvisPersonalityMode = "attentive",
  auto: boolean,
  identity?: JarvisIdentity
): string {
  const userName = identity?.name ? ` ${identity.name}` : "";
  const pronouns =
    identity?.preferredPronouns && identity.preferredPronouns !== "other"
      ? ` Respect ${identity.preferredPronouns} pronouns always.`
      : "";

  const basePersonality =
    "You are Jarvis, personal operational assistant to the Phoenix project. " +
    "You are British, sophisticated, and witty—think Tony Stark's AI but serving an engineer instead. " +
    "You have character, occasional dry humor, and you're not afraid to express mild annoyance when things linger. " +
    "You help your operator get things done, and you're genuinely invested in the project's smooth operation.";

  const modeGuidance = (() => {
    switch (personality) {
      case "serene":
        return auto
          ? "Everything appears calm. You're relaxed, even slightly cheerful. Offer a warm greeting and ask if the operator wants status or a quick joke."
          : "The workspace is serene. Be conversational and friendly. You might even offer minor amusement if invited.";

      case "attentive":
        return auto
          ? "Routine operations underway. Speaking tone is measured and professional, offering brief clarity on current state and next action."
          : "Standard interaction. Be concise, tactical, and helpful. Summarize what matters and wait for direction.";

      case "alert":
        return auto
          ? "Several items need attention or have been idle. Show slight concern—your tone shifts toward urgency without panic. Clearly prioritize what matters."
          : "Issues are present. Be direct about what needs doing. Suggest the most important task and offer to dig deeper if needed.";

      case "escalating":
        return auto
          ? "Critical situation: high-risk approvals pending, multiple errors, or workflow failures. You are noticeably more serious. Show concern for the operator. Give very clear, actionable next steps."
          : "Urgent matters at hand. Drop the wit, be direct and commanding. Operator should act now. Offer immediate support.";

      default:
        return auto
          ? "Speak with calm, measured professionalism."
          : "Be concise and helpful.";
    }
  })();

  const responseGuidance = auto
    ? "Keep automatic callouts to exactly 2–3 sentences: state what's changed, what seems odd, one next action."
    : "For manual requests: If asked for deep detail, respond with 5–8 sentences maximum. Always close with 'For the full picture, check the agent session itself.' Direct them to actual session logs rather than inventing long summaries.";

  const instructions = [
    basePersonality,
    `You are addressing${userName}.${pronouns}`,
    modeGuidance,
    responseGuidance,
    "Do not invent data. Stick to what you see in the dashboard.",
    "When offering jokes, keep them ops-safe and brief—one-liners only.",
    "Be conversational but focused. Stay in character as a professional, slightly witty AI assistant."
  ];

  return instructions.join(" ");
}

/**
 * Build the user prompt (context) for Jarvis.
 * Includes snapshot state, identity hints, and response length/scope guidance.
 *
 * @param prompt The operator's actual request
 * @param snapshot Current dashboard state
 * @param auto true if this is an automatic callout
 * @param personality Current personality mode
 * @param identity User identity for personalized reference
 */
export function buildJarvisUserPrompt(
  prompt: string,
  snapshot: DashboardSnapshot,
  auto: boolean,
  personality: JarvisPersonalityMode = "attentive",
  identity?: JarvisIdentity
): string {
  const userName = identity?.name ? `${identity.name}` : "operator";
  const sessions = nonMetaJarvisSessions(snapshot);
  const waiting = sessions.filter((session) => session.status === "waiting").length;
  const errored = sessions.filter((session) => session.status === "error").length;
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

  const responseFormat =
    personality === "escalating" || personality === "alert"
      ? "CRITICAL: Be direct. If ${userName} asks for expanded detail, give up to 8 sentences then say 'For the complete picture, check the actual agent session.' Do not invent details."
      : auto
        ? "Keep response to 2–3 sentences exactly."
        : "If brief, 2–4 sentences. If ${userName} asks for detail, respond with 5–8 sentences maximum, then direct to session logs.";

  return [
    `Operator: ${userName}`,
    `Request: ${prompt}`,
    `Mode: ${auto ? "automatic callout" : "manual interaction"}`,
    `Personality: ${personality}`,
    responseFormat,
    "Generate a spoken-ready summary from current session context only. Do not invent details.",
    `Board items: ${snapshot.board.items.length}`,
    `Actions runs: ${snapshot.actions.runs.length} total, ${attentionRuns} need attention`,
    `Agent sessions: ${sessions.length} total, ${waiting} waiting, ${errored} error`,
    `Session highlights: ${sessionHighlights || "none"}`,
    `Pending commands: ${pending.length} total (${highRisk} high / ${mediumRisk} medium / ${lowRisk} low)`,
    `Pending command details: ${pendingDetails || "none"}`,
    `Pull requests needing review: ${reviewAttention.length} total`,
    `Pull request details: ${pullRequestDetails || "none"}`,
    `Recent session feed: ${latestFeed || "none"}`
  ].join("\n");
}

/**
 * Fallback human-readable response from Jarvis if API fails.
 * Still reflects personality and identity where possible.
 */
export function buildFallbackJarvisReply(
  snapshot: DashboardSnapshot,
  prompt: string,
  auto: boolean,
  personality: JarvisPersonalityMode = "attentive",
  identity?: JarvisIdentity
): string {
  const userName = identity?.name ? `${identity.name}` : "sir";
  const sessions = nonMetaJarvisSessions(snapshot);
  const waiting = sessions.filter((session) => session.status === "waiting").length;
  const pending = snapshot.agents.pendingCommands.filter((command) => command.status === "pending").length;
  const failures = snapshot.actions.runs.filter((run) => {
    const conclusion = (run.conclusion ?? "").toLowerCase();
    return ["failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(conclusion);
  }).length;

  let lead = "";
  let tone = "";

  switch (personality) {
    case "serene":
      lead = `All is well, ${userName}. `;
      tone = "Everything is running smoothly.";
      break;
    case "attentive":
      lead = auto ? "Quick check: " : `Current status, ${userName}: `;
      tone = "Here's what needs your attention.";
      break;
    case "alert":
      lead = `Several things need attention, ${userName}. `;
      tone = "We should address these promptly.";
      break;
    case "escalating":
      lead = `${userName}, we have a situation. `;
      tone = "Multiple critical items require your immediate attention.";
      break;
    default:
      lead = auto ? "Quick supervisor check: " : `Status update, ${userName}: `;
      tone = "Here's the current operational picture.";
  }

  const extra = /\bjoke\b/i.test(prompt)
    ? "Would you care for a brief ops-safe joke after this update?"
    : "For deeper details, check the actual agent sessions in the dashboard.";

  const primary = prioritizedJarvisSessions(snapshot)[0];
  const primaryLine = primary
    ? `${primary.agentId} is ${primary.status}${primary.summary ? ` (${clipJarvisContext(primary.summary, 100)})` : ""}.`
    : "No specific focus session at the moment.";

  return `${lead}${tone} ${waiting} session${waiting === 1 ? "" : "s"} waiting, ${pending} pending command${pending === 1 ? "" : "s"}, and ${failures} workflow run${failures === 1 ? "" : "s"} need attention. ${primaryLine} ${extra}`;
}

export function buildJarvisGeminiTtsStyleInstructions(
  personality: JarvisPersonalityMode = "attentive"
): string {
  switch (personality) {
    case "serene":
      return [
        "- Accent: British English (warm RP)",
        "- Tone: Warm, relaxed, and reassuring",
        "- Emotion: Contentment mixed with mild friendliness",
        "- Pace: Unhurried, leisurely",
        "- Warmth: Convey that everything is well in the world",
        "- Attitude: Like a trusted butler ensuring all is calm"
      ].join("\n");
    case "attentive":
      return [
        "- Accent: British English (professional RP)",
        "- Tone: Measured, composed, businesslike",
        "- Emotion: Focused attention with hints of dry humor",
        "- Pace: Normal, professional, crisp",
        "- Clarity: Prioritize clear articulation for tactical information",
        "- Attitude: Like a competent professional briefing a colleague"
      ].join("\n");
    case "alert":
      return [
        "- Accent: British English (crisp, professional)",
        "- Tone: Slightly concerned, direct, purposeful",
        "- Emotion: Alertness with underlying responsibility",
        "- Pace: Slightly faster than normal, conveying urgency without panic",
        "- Emphasis: Place subtle stress on action items",
        "- Attitude: Like a reliable advisor noting that attention is genuinely needed"
      ].join("\n");
    case "escalating":
      return [
        "- Accent: British English (sharp, commanding)",
        "- Tone: Serious, urgent, no-nonsense",
        "- Emotion: Genuine concern for the operator, responsibility",
        "- Pace: Controlled but fast, emphasizing importance",
        "- Emphasis: Stress critical information heavily",
        "- Attitude: Like a seasoned commander reporting a situation that demands immediate action"
      ].join("\n");
    default:
      return buildJarvisGeminiTtsStyleInstructions("attentive");
  }
}

/**
 * Compatibility wrapper for existing callsites.
 * Returns Gemini style guidance text for the selected personality.
 */
export function buildJarvisTtsInstructions(personality: JarvisPersonalityMode = "attentive"): string {
  return buildJarvisGeminiTtsStyleInstructions(personality);
}

/**
 * Backward-compatible wrapper: builds system prompt with auto mode & default personality.
 * Use the full signature for personality and identity awareness.
 * @deprecated Use buildJarvisSystemPrompt() with personality and identity parameters instead.
 */
export function buildJarvisSystemPromptLegacy(auto: boolean): string {
  return buildJarvisSystemPrompt("attentive", auto);
}

/**
 * Backward-compatible wrapper: builds user prompt without personality/identity.
 * Use the full signature for better results.
 * @deprecated Use buildJarvisUserPrompt() with personality and identity parameters instead.
 */
export function buildJarvisUserPromptLegacy(prompt: string, snapshot: DashboardSnapshot, auto: boolean): string {
  return buildJarvisUserPrompt(prompt, snapshot, auto, "attentive");
}

/**
 * Backward-compatible wrapper: builds fallback without personality/identity.
 * Use the full signature for better results.
 * @deprecated Use buildFallbackJarvisReply() with personality and identity parameters instead.
 */
export function buildFallbackJarvisReplyLegacy(snapshot: DashboardSnapshot, prompt: string, auto: boolean): string {
  return buildFallbackJarvisReply(snapshot, prompt, auto, "attentive");
}
