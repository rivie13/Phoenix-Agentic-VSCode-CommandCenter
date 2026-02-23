import type { RefreshReason } from "../services/DataService";
import type { EmbeddedSupervisorManager } from "../services/EmbeddedSupervisorManager";

type StatusLevel = "ok" | "warn" | "err";

interface EmbeddedSupervisorSettings {
  embeddedSupervisorEnabled: boolean;
  workspaceSupervisorAutoStart: boolean;
  embeddedSupervisorApiToken: string;
  embeddedSupervisorHost: string;
  embeddedSupervisorPort: number;
  jarvisApiBaseUrl: string;
  jarvisApiKey: string;
  jarvisTextModel: string;
  jarvisSpeechModel: string;
  jarvisVoice: string;
  jarvisPollinationsHardCooldownSeconds: number;
  jarvisPollinationsSoftCooldownSeconds: number;
}

export interface EmbeddedSupervisorHandlersDeps {
  getSettings: () => EmbeddedSupervisorSettings;
  embeddedSupervisorManager: Pick<EmbeddedSupervisorManager, "ensureStarted">;
  getEmbeddedSupervisorBaseUrl: () => string | null;
  setEmbeddedSupervisorBaseUrl: (value: string | null) => void;
  getEmbeddedSupervisorToken: () => string;
  setEmbeddedSupervisorToken: (value: string) => void;
  postStatus: (message: string, level: StatusLevel) => Promise<void>;
  nextSequence: () => number;
  fetchLocalSnapshot: (sequence: number, streamConnected: boolean, forceRefresh: boolean, reason: RefreshReason) => Promise<unknown>;
}

export async function ensureEmbeddedSupervisorStarted(deps: EmbeddedSupervisorHandlersDeps): Promise<void> {
  const settings = deps.getSettings();
  if (!settings.embeddedSupervisorEnabled || settings.workspaceSupervisorAutoStart) {
    deps.setEmbeddedSupervisorBaseUrl(null);
    return;
  }

  deps.setEmbeddedSupervisorToken(settings.embeddedSupervisorApiToken);
  try {
    const baseUrl = await deps.embeddedSupervisorManager.ensureStarted({
      host: settings.embeddedSupervisorHost,
      port: settings.embeddedSupervisorPort,
      apiToken: settings.embeddedSupervisorApiToken,
      jarvisApiBaseUrl: settings.jarvisApiBaseUrl,
      jarvisApiKey: settings.jarvisApiKey,
      jarvisTextModel: settings.jarvisTextModel,
      jarvisSpeechModel: settings.jarvisSpeechModel,
      jarvisVoice: settings.jarvisVoice,
      jarvisHardCooldownSeconds: settings.jarvisPollinationsHardCooldownSeconds,
      jarvisSoftCooldownSeconds: settings.jarvisPollinationsSoftCooldownSeconds
    });
    deps.setEmbeddedSupervisorBaseUrl(baseUrl);
    await deps.postStatus(`Embedded supervisor online at ${baseUrl}`, "ok");
  } catch (error) {
    deps.setEmbeddedSupervisorBaseUrl(null);
    const message = error instanceof Error ? error.message : String(error);
    await deps.postStatus(`Embedded supervisor unavailable: ${message}`, "warn");
  }
}

export async function postEmbeddedSupervisorJson(
  deps: EmbeddedSupervisorHandlersDeps,
  pathname: string,
  payload: unknown
): Promise<void> {
  const baseUrl = deps.getEmbeddedSupervisorBaseUrl();
  if (!baseUrl) {
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    const token = deps.getEmbeddedSupervisorToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${pathname}`, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}${text ? `: ${text}` : ""}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function syncEmbeddedSupervisorNow(
  deps: EmbeddedSupervisorHandlersDeps,
  reason: RefreshReason
): Promise<boolean> {
  const settings = deps.getSettings();
  const baseUrl = deps.getEmbeddedSupervisorBaseUrl();
  if (!baseUrl || !settings.embeddedSupervisorEnabled || settings.workspaceSupervisorAutoStart) {
    return false;
  }

  try {
    const sequence = deps.nextSequence();
    const localSnapshot = await deps.fetchLocalSnapshot(sequence, true, false, reason);
    await postEmbeddedSupervisorJson(deps, "/snapshot/update", localSnapshot);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.postStatus(`Embedded supervisor sync failed: ${message}`, "warn");
    return false;
  }
}
