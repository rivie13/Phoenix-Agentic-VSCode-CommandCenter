import type { DataService, RefreshReason } from "../services/DataService";
import type { JarvisConversationTurn } from "../services/JarvisService";
import type {
  PollinationsCooldownSnapshot,
  PollinationsFailureKind
} from "../services/PollinationsResilience";
import type { DashboardSnapshot } from "../types";
import {
  buildFallbackJarvisReply,
  buildJarvisSystemPrompt,
  buildJarvisUserPrompt,
  pickAutoJarvisDecision,
  determineJarvisPersonality,
  type JarvisIdentity,
  type JarvisPersonalityMode
} from "../utils/jarvisPrompts";
import type { JarvisFocusHint } from "./CommandCenterPayloads";

type JarvisServiceSettings = {
  apiBaseUrl: string;
  apiKey: string;
  textModel: string;
  speechModel: string;
  voice: string;
};

type JarvisDelegatedApprovalResult = { text: string; reason: string; focusHint: JarvisFocusHint | null };

interface RequestJarvisRespondInput {
  prompt: string;
  reason: string;
  auto: boolean;
  focusHint: JarvisFocusHint | null;
  rememberPrompt: string | null;
  warnOnFailure: boolean;
}

export interface JarvisInteractionHandlersDeps {
  getSnapshot: () => DashboardSnapshot | null;
  isDisposed: () => boolean;
  getRuntimeSettings: () => ReturnType<DataService["getSettings"]>;
  isJarvisManualMode: () => boolean;
  getJarvisLastAnnouncementMs: () => number;
  canAnnounceJarvis: (reason: string, settings: ReturnType<DataService["getSettings"]>) => boolean;
  requestJarvisRespondFromSupervisor: (input: RequestJarvisRespondInput) => Promise<boolean>;
  getJarvisServiceSettings: (settings: ReturnType<DataService["getSettings"]>) => JarvisServiceSettings;
  getJarvisConversation: () => JarvisConversationTurn[];
  generateJarvisReply: (
    systemPrompt: string,
    userPrompt: string,
    conversation: JarvisConversationTurn[],
    settings: JarvisServiceSettings
  ) => Promise<string>;
  getPollinationsCooldownSnapshot: (channel: "chat" | "speech") => PollinationsCooldownSnapshot;
  pollinationsCooldownNotice: (
    channel: "chat" | "speech",
    failureKind: PollinationsFailureKind | null,
    untilMs: number
  ) => string;
  clearPollinationsCooldown: (channel: "chat" | "speech") => void;
  notePollinationsFailure: (
    channel: "chat" | "speech",
    error: unknown,
    settings: ReturnType<DataService["getSettings"]>
  ) => string;
  rememberJarvisTurn: (role: "user" | "assistant", content: string, historyTurns: number) => void;
  emitJarvisSpeech: (input: { text: string; reason: string; auto: boolean; focusHint: JarvisFocusHint | null; personality?: JarvisPersonalityMode }) => Promise<void>;
  refreshNow: (reason: RefreshReason) => Promise<void>;
  tryJarvisDelegatedApproval: (prompt: string, snapshot: DashboardSnapshot) => Promise<JarvisDelegatedApprovalResult | null>;
  showWarningMessage: (message: string) => void;
  getJarvisIdentity: () => JarvisIdentity | null;
}

export async function tickJarvisAuto(deps: JarvisInteractionHandlersDeps): Promise<void> {
  const snapshot = deps.getSnapshot();
  if (!snapshot || deps.isDisposed()) {
    return;
  }

  const settings = deps.getRuntimeSettings();
  if (!settings.jarvisEnabled || !settings.jarvisAutoAnnouncements || deps.isJarvisManualMode()) {
    return;
  }

  const identity = deps.getJarvisIdentity();
  const decision = pickAutoJarvisDecision(snapshot, {
    nowMs: Date.now(),
    lastAnnouncementMs: deps.getJarvisLastAnnouncementMs(),
    jarvisOfferJokes: settings.jarvisOfferJokes,
    randomValue: Math.random(),
    identity: identity ?? undefined
  });
  if (!decision || !deps.canAnnounceJarvis(decision.reason, settings)) {
    return;
  }

  const fromSupervisor = await deps.requestJarvisRespondFromSupervisor({
    prompt: decision.prompt,
    reason: decision.reason,
    auto: true,
    focusHint: decision.focusHint,
    rememberPrompt: decision.prompt,
    warnOnFailure: false
  });
  if (fromSupervisor) {
    return;
  }

  const personality = determineJarvisPersonality(snapshot, deps.getJarvisLastAnnouncementMs(), Date.now());
  const systemPrompt = buildJarvisSystemPrompt(personality, true, identity ?? undefined);
  const userPrompt = buildJarvisUserPrompt(decision.prompt, snapshot, true, personality, identity ?? undefined);
  const serviceSettings = deps.getJarvisServiceSettings(settings);
  let text: string;

  const chatCooldown = deps.getPollinationsCooldownSnapshot("chat");
  if (chatCooldown.degraded && chatCooldown.untilMs) {
    text = buildFallbackJarvisReply(
      snapshot,
      `Automatic status check (${decision.reason}). ${deps.pollinationsCooldownNotice("chat", chatCooldown.failureKind, chatCooldown.untilMs)}`,
      true,
      personality,
      identity ?? undefined
    );
  } else {
    try {
      text = await deps.generateJarvisReply(systemPrompt, userPrompt, deps.getJarvisConversation(), serviceSettings);
      deps.clearPollinationsCooldown("chat");
      deps.rememberJarvisTurn("user", decision.prompt, settings.jarvisConversationHistoryTurns);
      deps.rememberJarvisTurn("assistant", text, settings.jarvisConversationHistoryTurns);
    } catch (error) {
      const message = deps.notePollinationsFailure("chat", error, settings);
      text = buildFallbackJarvisReply(
        snapshot,
        `Automatic status check (${decision.reason}). ${message}`,
        true,
        personality,
        identity ?? undefined
      );
    }
  }

  await deps.emitJarvisSpeech({
    text,
    reason: decision.reason,
    auto: true,
    focusHint: decision.focusHint,
    personality
  });
}

export async function activateJarvis(deps: JarvisInteractionHandlersDeps, prompt: string): Promise<void> {
  const settings = deps.getRuntimeSettings();
  if (!settings.jarvisEnabled) {
    deps.showWarningMessage("Jarvis is disabled. Enable phoenixOps.jarvisEnabled to use voice assistant features.");
    return;
  }

  if (!deps.getSnapshot()) {
    await deps.refreshNow("manual");
  }
  const snapshot = deps.getSnapshot();
  if (!snapshot) {
    deps.showWarningMessage("Jarvis could not access a current snapshot yet.");
    return;
  }

  const delegated = await deps.tryJarvisDelegatedApproval(prompt, snapshot);
  if (delegated) {
    await deps.emitJarvisSpeech({
      text: delegated.text,
      reason: delegated.reason,
      auto: false,
      focusHint: delegated.focusHint
    });
    return;
  }

  const normalizedPrompt =
    prompt && prompt.length > 0 ? prompt : "Give me a concise cross-session status report and highest-priority next actions.";
  const fromSupervisor = await deps.requestJarvisRespondFromSupervisor({
    prompt: normalizedPrompt,
    reason: "manual-request",
    auto: false,
    focusHint: null,
    rememberPrompt: normalizedPrompt,
    warnOnFailure: true
  });
  if (fromSupervisor) {
    return;
  }

  const identity = deps.getJarvisIdentity();
  const personality = determineJarvisPersonality(snapshot, deps.getJarvisLastAnnouncementMs(), Date.now());
  const serviceSettings = deps.getJarvisServiceSettings(settings);
  const systemPrompt = buildJarvisSystemPrompt(personality, false, identity ?? undefined);
  const userPrompt = buildJarvisUserPrompt(normalizedPrompt, snapshot, false, personality, identity ?? undefined);
  let reply: string;

  const chatCooldown = deps.getPollinationsCooldownSnapshot("chat");
  if (chatCooldown.degraded && chatCooldown.untilMs) {
    reply = buildFallbackJarvisReply(
      snapshot,
      `${normalizedPrompt}. ${deps.pollinationsCooldownNotice("chat", chatCooldown.failureKind, chatCooldown.untilMs)}`,
      false,
      personality,
      identity ?? undefined
    );
  } else {
    try {
      reply = await deps.generateJarvisReply(systemPrompt, userPrompt, deps.getJarvisConversation(), serviceSettings);
      deps.clearPollinationsCooldown("chat");
    } catch (error) {
      const message = deps.notePollinationsFailure("chat", error, settings);
      reply = buildFallbackJarvisReply(snapshot, `${normalizedPrompt}. ${message}`, false, personality, identity ?? undefined);
    }
  }

  deps.rememberJarvisTurn("user", normalizedPrompt, settings.jarvisConversationHistoryTurns);
  deps.rememberJarvisTurn("assistant", reply, settings.jarvisConversationHistoryTurns);
  await deps.emitJarvisSpeech({
    text: reply,
    reason: "manual-request",
    auto: false,
    focusHint: null,
    personality
  });
}
