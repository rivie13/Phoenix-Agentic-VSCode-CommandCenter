import type { DataService } from "../services/DataService";
import type {
  JarvisFocusHint,
  JarvisSpeakPayload,
  SupervisorJarvisRespondPayload
} from "./CommandCenterPayloads";
import { defaultWorkspacePath } from "./agentRuntimeHandlers";
import type { DashboardSnapshot } from "../types";

type StatusLevel = "ok" | "warn" | "err";

interface RequestJarvisRespondInput {
  prompt: string;
  reason: string;
  auto: boolean;
  focusHint: JarvisFocusHint | null;
  rememberPrompt: string | null;
  warnOnFailure: boolean;
}

export interface JarvisSupervisorHandlersDeps {
  getDataSettings: () => ReturnType<DataService["getSettings"]>;
  getRuntimeSettings: () => ReturnType<DataService["getSettings"]>;
  getSnapshot: () => DashboardSnapshot | null;
  configuredSupervisorConnection: () => { baseUrl: string; authToken: string };
  isLocalSupervisorBaseUrl: (baseUrl: string) => boolean;
  ensureWorkspaceSupervisorStarted: () => Promise<void>;
  waitForSupervisorSnapshotReady: (baseUrl: string, authToken: string, timeoutMs: number) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  postStatus: (message: string, level: StatusLevel) => Promise<void>;
  logInfo: (message: string) => void;
  logWarn: (message: string) => void;
  emitJarvisPayload: (payload: JarvisSpeakPayload, forwardToSupervisor: boolean) => Promise<void>;
  clearPollinationsCooldown: (channel: "chat" | "speech") => void;
  rememberJarvisTurn: (role: "user" | "assistant", content: string, maxTurns: number) => void;
}

interface JarvisRespondContextPayload {
  operatorSummary: string | null;
  focusHint: string | null;
  pendingApprovals: string[];
  notableEvents: string[];
}

function asTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clip(value: string | null | undefined, maxLength: number): string {
  if (!value) {
    return "";
  }
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

function buildJarvisRespondContext(
  snapshot: DashboardSnapshot | null,
  prompt: string,
  reason: string,
  auto: boolean,
  focusHint: JarvisFocusHint | null
): JarvisRespondContextPayload | null {
  if (!snapshot) {
    return {
      operatorSummary: auto
        ? `Automatic callout request (${reason}).`
        : `Manual operator prompt: ${clip(prompt, 200)}`,
      focusHint: focusHint ? `${focusHint.kind}:${focusHint.id} ${focusHint.label}` : null,
      pendingApprovals: [],
      notableEvents: []
    };
  }

  const pendingApprovals = snapshot.agents.pendingCommands
    .filter((command) => command.status === "pending")
    .sort((left, right) => asTimestamp(right.updatedAt) - asTimestamp(left.updatedAt))
    .slice(0, 6)
    .map((command) => {
      const reasonText = clip(command.reason, 100);
      return `${command.agentId} [${command.risk}] ${clip(command.command, 80)}${reasonText ? ` (${reasonText})` : ""}`;
    });

  const notableEvents = [...snapshot.agents.feed]
    .sort((left, right) => asTimestamp(right.occurredAt) - asTimestamp(left.occurredAt))
    .slice(0, 10)
    .map((entry) => `[${entry.level}] ${entry.agentId}: ${clip(entry.message, 140)}`);

  const context: JarvisRespondContextPayload = {
    operatorSummary: auto
      ? `Automatic callout request (${reason}).`
      : `Manual operator prompt: ${clip(prompt, 200)}`,
    focusHint: focusHint ? `${focusHint.kind}:${focusHint.id} ${focusHint.label}` : null,
    pendingApprovals,
    notableEvents
  };

  if (!context.operatorSummary && !context.focusHint && context.pendingApprovals.length === 0 && context.notableEvents.length === 0) {
    return null;
  }

  return context;
}

function shouldRetryJarvisRespondHttp(status: number): boolean {
  return status === 404 || status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function requestJarvisRespondFromSupervisor(
  deps: JarvisSupervisorHandlersDeps,
  input: RequestJarvisRespondInput
): Promise<boolean> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return false;
  }

  const settings = deps.getDataSettings();
  const supervisor = deps.configuredSupervisorConnection();
  const baseUrl = supervisor.baseUrl;
  if (!baseUrl) {
    return false;
  }
  const retryableStartup = settings.workspaceSupervisorAutoStart && deps.isLocalSupervisorBaseUrl(baseUrl);
  if (retryableStartup) {
    await deps.ensureWorkspaceSupervisorStarted();
    await deps.waitForSupervisorSnapshotReady(baseUrl, supervisor.authToken, Math.min(10_000, settings.workspaceSupervisorStartTimeoutMs));
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (supervisor.authToken) {
    headers.Authorization = `Bearer ${supervisor.authToken}`;
  }

  const maxAttempts = retryableStartup ? 2 : 1;
  const context = buildJarvisRespondContext(deps.getSnapshot(), prompt, input.reason, input.auto, input.focusHint);
  const requestBody = {
    sessionId: "jarvis-voice",
    agentId: "Jarvis",
    transport: "local",
    prompt,
    reason: input.reason,
    auto: input.auto,
    includeAudio: true,
    service: "jarvis",
    mode: "voice",
    model: settings.jarvisTextModel,
    context,
    workspace: defaultWorkspacePath(),
    occurredAt: new Date().toISOString()
  };

  deps.logInfo(
    `Posting /jarvis/respond (reason=${input.reason}, auto=${input.auto}, promptChars=${prompt.length}, context=${context ? "yes" : "no"}, attempts=${maxAttempts}).`
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${baseUrl}/jarvis/respond`, {
        method: "POST",
        signal: controller.signal,
        headers,
        body: JSON.stringify(requestBody)
      });
      if (!response.ok) {
        const detail = await response.text();
        deps.logWarn(
          `Workspace supervisor /jarvis/respond attempt ${attempt}/${maxAttempts} failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`
        );
        if (attempt < maxAttempts && shouldRetryJarvisRespondHttp(response.status)) {
          await deps.sleep(650);
          continue;
        }
        if (input.warnOnFailure) {
          await deps.postStatus(`Workspace supervisor /jarvis/respond failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`, "warn");
        }
        return false;
      }

      const raw = (await response.json()) as SupervisorJarvisRespondPayload;
      if (raw.accepted === false) {
        deps.logWarn(`Workspace supervisor /jarvis/respond attempt ${attempt}/${maxAttempts} was rejected.`);
        if (input.warnOnFailure) {
          await deps.postStatus("Workspace supervisor /jarvis/respond was rejected.", "warn");
        }
        return false;
      }

      const text = typeof raw.text === "string" ? raw.text.trim() : "";
      if (!text) {
        deps.logWarn(`Workspace supervisor /jarvis/respond attempt ${attempt}/${maxAttempts} returned no text.`);
        if (input.warnOnFailure) {
          await deps.postStatus("Workspace supervisor /jarvis/respond returned no text.", "warn");
        }
        return false;
      }

      const payload: JarvisSpeakPayload = {
        text,
        reason: input.reason,
        auto: input.auto,
        focusHint: input.focusHint,
        mimeType: typeof raw.mimeType === "string" ? raw.mimeType : null,
        audioBase64: typeof raw.audioBase64 === "string" ? raw.audioBase64 : null
      };
      deps.logInfo(
        `Workspace supervisor /jarvis/respond success (attempt=${attempt}, source=${String(raw.source ?? "unknown")}, textChars=${text.length}, audio=${Boolean(payload.audioBase64)}, failureKind=${String(raw.failureKind ?? "none")}).`
      );
      await deps.emitJarvisPayload(payload, false);
      deps.clearPollinationsCooldown("chat");
      if (payload.audioBase64) {
        deps.clearPollinationsCooldown("speech");
      }
      if (input.rememberPrompt) {
        deps.rememberJarvisTurn("user", input.rememberPrompt, settings.jarvisConversationHistoryTurns);
        deps.rememberJarvisTurn("assistant", text, settings.jarvisConversationHistoryTurns);
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.logWarn(`Workspace supervisor /jarvis/respond attempt ${attempt}/${maxAttempts} unavailable: ${message}`);
      if (attempt < maxAttempts) {
        if (retryableStartup) {
          await deps.ensureWorkspaceSupervisorStarted();
        }
        await deps.sleep(650);
        continue;
      }
      if (input.warnOnFailure) {
        await deps.postStatus(`Workspace supervisor /jarvis/respond unavailable: ${message}`, "warn");
      }
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  return false;
}

export async function forwardJarvisSpeakToSupervisor(
  deps: JarvisSupervisorHandlersDeps,
  payload: JarvisSpeakPayload
): Promise<void> {
  const runtimeSettings = deps.getRuntimeSettings();
  const supervisor = deps.configuredSupervisorConnection();
  const baseUrl = supervisor.baseUrl;
  if (!baseUrl) {
    return;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (supervisor.authToken) {
    headers.Authorization = `Bearer ${supervisor.authToken}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${baseUrl}/jarvis/speak`, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        sessionId: "jarvis-voice",
        agentId: "Jarvis",
        transport: "local",
        message: payload.text,
        reason: payload.reason,
        auto: payload.auto,
        service: "jarvis",
        mode: "voice",
        model: runtimeSettings.jarvisTextModel,
        workspace: defaultWorkspacePath(),
        occurredAt: new Date().toISOString(),
        mimeType: payload.mimeType,
        audioBase64: payload.audioBase64
      })
    });
    if (!response.ok) {
      deps.logWarn(`Workspace supervisor /jarvis/speak failed (HTTP ${response.status}).`);
    } else {
      deps.logInfo(`Forwarded Jarvis speak event (reason=${payload.reason}, auto=${payload.auto}, audio=${Boolean(payload.audioBase64)}).`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logWarn(`Workspace supervisor /jarvis/speak unavailable: ${message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}
