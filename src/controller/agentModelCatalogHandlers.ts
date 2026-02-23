import type { DataService } from "../services/DataService";
import type { AgentModelCatalogPayload, AgentModelOption } from "../utils/agentModelCatalog";
import { coerceServiceModelMap, defaultAgentModelCatalog } from "../utils/agentModelCatalog";

type StatusLevel = "ok" | "warn" | "err";

export interface AgentModelCatalogHandlersDeps {
  getCachedCatalog: () => AgentModelCatalogPayload | null;
  getCachedCatalogExpiresAtMs: () => number;
  setCachedCatalog: (payload: AgentModelCatalogPayload | null, expiresAtMs: number) => void;
  getWarnedUntilMs: () => number;
  setWarnedUntilMs: (untilMs: number) => void;
  postStatus: (message: string, level: StatusLevel) => Promise<void>;
}

export function invalidateAgentModelCatalogCache(deps: AgentModelCatalogHandlersDeps): void {
  deps.setCachedCatalog(null, 0);
}

export async function fetchAgentModelCatalogFromHub(
  modelCatalogUrl: string,
  authToken: string
): Promise<Partial<Record<"codex" | "copilot", AgentModelOption[]>>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json"
    };
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    const response = await fetch(modelCatalogUrl, {
      method: "GET",
      signal: controller.signal,
      headers
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const json = await response.json();
    return coerceServiceModelMap(json);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function resolveAgentModelCatalog(
  deps: AgentModelCatalogHandlersDeps,
  settings: ReturnType<DataService["getSettings"]>
): Promise<AgentModelCatalogPayload> {
  const now = Date.now();
  const cached = deps.getCachedCatalog();
  if (cached && now < deps.getCachedCatalogExpiresAtMs()) {
    return cached;
  }

  const fallback = defaultAgentModelCatalog(settings);
  const modelCatalogUrl = settings.agentModelCatalogUrl.trim();
  if (!modelCatalogUrl) {
    deps.setCachedCatalog(fallback, now + 30_000);
    return fallback;
  }

  try {
    const serviceMap = await fetchAgentModelCatalogFromHub(modelCatalogUrl, settings.agentModelCatalogAuthToken);
    const codex = (serviceMap.codex && serviceMap.codex.length > 0) ? serviceMap.codex : fallback.services.codex;
    const copilot = (serviceMap.copilot && serviceMap.copilot.length > 0) ? serviceMap.copilot : fallback.services.copilot;
    const source: AgentModelCatalogPayload["source"] =
      (serviceMap.codex && serviceMap.codex.length > 0) || (serviceMap.copilot && serviceMap.copilot.length > 0)
        ? "hub"
        : "hub-fallback";
    const payload: AgentModelCatalogPayload = {
      source,
      services: { codex, copilot }
    };
    deps.setCachedCatalog(payload, now + 30_000);
    return payload;
  } catch (error) {
    if (now > deps.getWarnedUntilMs()) {
      deps.setWarnedUntilMs(now + 300_000);
      const message = error instanceof Error ? error.message : String(error);
      void deps.postStatus(`Model hub unavailable; using local model settings (${message})`, "warn");
    }
    const payload: AgentModelCatalogPayload = {
      source: "hub-fallback",
      services: fallback.services
    };
    deps.setCachedCatalog(payload, now + 30_000);
    return payload;
  }
}
