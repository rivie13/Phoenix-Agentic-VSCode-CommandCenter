import { spawn } from "node:child_process";
import type { DataService } from "../services/DataService";
import type { AgentModelCatalogPayload, AgentModelOption } from "../utils/agentModelCatalog";
import { coerceServiceModelMap, defaultAgentModelCatalog } from "../utils/agentModelCatalog";
import { parseCliInvocation } from "../utils/cliCommand";

type StatusLevel = "ok" | "warn" | "err";

const CLI_DISCOVERY_TIMEOUT_MS = 10_000;
const CODEx_APP_SERVER_INIT_REQUEST_ID = 1;
const CODEx_APP_SERVER_MODEL_LIST_REQUEST_ID = 2;

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

function quoteForWindowsCmdSegment(segment: string): string {
  return `"${segment.replaceAll("\"", "\"\"")}"`;
}

function spawnWithShellCompatibility(command: string, args: string[], stdio: "pipe" | "ignore" = "pipe") {
  if (process.platform === "win32") {
    const commandLine = [command, ...args].map(quoteForWindowsCmdSegment).join(" ");
    return spawn("cmd.exe", ["/d", "/s", "/c", commandLine], {
      windowsHide: true,
      stdio
    });
  }
  return spawn(command, args, {
    windowsHide: true,
    stdio
  });
}

function parseCopilotModelChoices(text: string): string[] {
  const normalizedText = text.replace(/\r/g, "");
  const errorMatch = normalizedText.match(/Allowed choices are\s+([^\n.]+)/i);
  if (errorMatch) {
    return errorMatch[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  const helpChoicesBlock = normalizedText.match(/--model\s+<model>[\s\S]*?\(choices:\s*([\s\S]*?)\)\s*(?:\n|$)/i);
  if (helpChoicesBlock) {
    const choices: string[] = [];
    const regex = /"([^"]+)"/g;
    let match: RegExpExecArray | null = regex.exec(helpChoicesBlock[1]);
    while (match) {
      const candidate = match[1]?.trim();
      if (candidate) {
        choices.push(candidate);
      }
      match = regex.exec(helpChoicesBlock[1]);
    }
    return choices;
  }

  return [];
}

function dedupeModelOptions(options: AgentModelOption[]): AgentModelOption[] {
  const deduped = new Map<string, AgentModelOption>();
  for (const option of options) {
    deduped.set(option.id, option);
  }
  return Array.from(deduped.values());
}

async function captureCommandOutput(command: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return await new Promise((resolve, reject) => {
    const child = spawnWithShellCompatibility(command, args);
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });
  });
}

async function discoverCopilotModelOptions(copilotCliPath: string): Promise<AgentModelOption[]> {
  const invocation = parseCliInvocation(copilotCliPath, "copilot");
  const command = invocation.command || "copilot";
  const baseArgs = invocation.baseArgs;
  const probe = await captureCommandOutput(
    command,
    [...baseArgs, "--model", "__phoenix_invalid_model__", "-p", "ping", "--allow-all-tools", "--silent"],
    CLI_DISCOVERY_TIMEOUT_MS
  );
  const combined = `${probe.stdout}\n${probe.stderr}`;
  let modelIds = parseCopilotModelChoices(combined);

  if (modelIds.length === 0) {
    const help = await captureCommandOutput(command, [...baseArgs, "--help"], CLI_DISCOVERY_TIMEOUT_MS);
    modelIds = parseCopilotModelChoices(`${help.stdout}\n${help.stderr}`);
  }

  return dedupeModelOptions(
    modelIds
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
      .map((id) => ({
        id,
        label: id,
        contextWindow: null
      }))
  );
}

function normalizeReasoningEffort(raw: unknown): "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | null {
  if (typeof raw !== "string") {
    return null;
  }
  const lowered = raw.trim().toLowerCase();
  if (["none", "minimal", "low", "medium", "high", "xhigh"].includes(lowered)) {
    return lowered as "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  }
  return null;
}

function parseCodexModelsFromResult(raw: unknown): AgentModelOption[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const parsed: AgentModelOption[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const source = entry as Record<string, unknown>;
    if (source.hidden === true) {
      continue;
    }
    const id = String(source.id ?? source.model ?? "").trim();
    if (!id) {
      continue;
    }
    const label = String(source.displayName ?? source.model ?? id).trim() || id;
    const defaultReasoningEffort = normalizeReasoningEffort(source.defaultReasoningEffort);
    const supportedReasoningEfforts = Array.isArray(source.supportedReasoningEfforts)
      ? source.supportedReasoningEfforts
          .map((candidate) => {
            if (candidate && typeof candidate === "object") {
              return normalizeReasoningEffort((candidate as Record<string, unknown>).reasoningEffort);
            }
            return normalizeReasoningEffort(candidate);
          })
          .filter((candidate): candidate is "none" | "minimal" | "low" | "medium" | "high" | "xhigh" => candidate !== null)
      : [];
    const description = typeof source.description === "string" && source.description.trim().length > 0
      ? source.description.trim()
      : null;

    parsed.push({
      id,
      label,
      contextWindow: null,
      defaultReasoningEffort,
      reasoningEfforts: supportedReasoningEfforts,
      description
    });
  }
  return dedupeModelOptions(parsed);
}

async function discoverCodexModelOptions(codexCliPath: string): Promise<AgentModelOption[]> {
  const invocation = parseCliInvocation(codexCliPath, "codex");
  const command = invocation.command || "codex";
  const baseArgs = invocation.baseArgs;
  return await new Promise((resolve, reject) => {
    const child = spawnWithShellCompatibility(command, [...baseArgs, "app-server", "--listen", "stdio://"]);
    let settled = false;
    let stdoutBuffer = "";

    const settleSuccess = (result: AgentModelOption[]) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      resolve(result);
    };

    const settleFailure = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const timer = setTimeout(() => {
      settleFailure(new Error(`codex model/list timed out after ${CLI_DISCOVERY_TIMEOUT_MS}ms`));
    }, CLI_DISCOVERY_TIMEOUT_MS);

    const sendJson = (payload: unknown): void => {
      try {
        child.stdin?.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        settleFailure(error);
      }
    };

    child.once("error", (error) => {
      settleFailure(error);
    });

    child.once("close", (exitCode) => {
      if (!settled) {
        settleFailure(new Error(`codex app-server exited before responding (code=${exitCode ?? "unknown"})`));
      }
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line.length === 0) {
          newlineIndex = stdoutBuffer.indexOf("\n");
          continue;
        }

        try {
          const message = JSON.parse(line) as Record<string, unknown>;
          const messageId = typeof message.id === "number" ? message.id : Number.NaN;
          if (messageId === CODEx_APP_SERVER_INIT_REQUEST_ID) {
            sendJson({
              jsonrpc: "2.0",
              id: CODEx_APP_SERVER_MODEL_LIST_REQUEST_ID,
              method: "model/list",
              params: {
                includeHidden: false,
                limit: 200
              }
            });
          }
          if (messageId === CODEx_APP_SERVER_MODEL_LIST_REQUEST_ID) {
            const result = parseCodexModelsFromResult((message.result as Record<string, unknown> | undefined)?.data);
            settleSuccess(result);
            return;
          }
        } catch {
          // Ignore non-JSON or irrelevant lines emitted by the app server.
        }

        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });

    sendJson({
      jsonrpc: "2.0",
      id: CODEx_APP_SERVER_INIT_REQUEST_ID,
      method: "initialize",
      params: {
        clientInfo: {
          name: "phoenix-command-center",
          version: "0.1.0"
        }
      }
    });
  });
}

function enrichCopilotReasoningFromCodex(codex: AgentModelOption[], copilot: AgentModelOption[]): AgentModelOption[] {
  const codexById = new Map<string, AgentModelOption>();
  for (const option of codex) {
    codexById.set(option.id, option);
  }
  return copilot.map((option) => {
    if ((option.reasoningEfforts?.length ?? 0) > 0) {
      return option;
    }
    const codexEquivalent = codexById.get(option.id);
    if (!codexEquivalent) {
      return option;
    }
    return {
      ...option,
      reasoningEfforts: codexEquivalent.reasoningEfforts,
      defaultReasoningEffort: codexEquivalent.defaultReasoningEffort
    };
  });
}

async function discoverCliCatalog(
  settings: ReturnType<DataService["getSettings"]>
): Promise<Partial<Record<"codex" | "copilot", AgentModelOption[]>>> {
  const [codexResult, copilotResult] = await Promise.allSettled([
    discoverCodexModelOptions(settings.codexCliPath),
    discoverCopilotModelOptions(settings.copilotCliPath)
  ]);

  const discovered: Partial<Record<"codex" | "copilot", AgentModelOption[]>> = {};
  if (codexResult.status === "fulfilled" && codexResult.value.length > 0) {
    discovered.codex = codexResult.value;
  }
  if (copilotResult.status === "fulfilled" && copilotResult.value.length > 0) {
    const codexModels = discovered.codex ?? [];
    discovered.copilot = enrichCopilotReasoningFromCodex(codexModels, copilotResult.value);
  }
  return discovered;
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
  let basePayload: AgentModelCatalogPayload = fallback;

  if (!modelCatalogUrl) {
    basePayload = fallback;
  } else {
    try {
      const serviceMap = await fetchAgentModelCatalogFromHub(modelCatalogUrl, settings.agentModelCatalogAuthToken);
      const codex = (serviceMap.codex && serviceMap.codex.length > 0) ? serviceMap.codex : fallback.services.codex;
      const copilot = (serviceMap.copilot && serviceMap.copilot.length > 0) ? serviceMap.copilot : fallback.services.copilot;
      const source: AgentModelCatalogPayload["source"] =
        (serviceMap.codex && serviceMap.codex.length > 0) || (serviceMap.copilot && serviceMap.copilot.length > 0)
          ? "hub"
          : "hub-fallback";
      basePayload = {
        source,
        services: { codex, copilot }
      };
    } catch (error) {
      if (now > deps.getWarnedUntilMs()) {
        deps.setWarnedUntilMs(now + 300_000);
        const message = error instanceof Error ? error.message : String(error);
        void deps.postStatus(`Model hub unavailable; using local model settings (${message})`, "warn");
      }
      basePayload = {
        source: "hub-fallback",
        services: fallback.services
      };
    }
  }

  try {
    const discovered = await discoverCliCatalog(settings);
    const codex = (discovered.codex && discovered.codex.length > 0) ? discovered.codex : basePayload.services.codex;
    const copilot = (discovered.copilot && discovered.copilot.length > 0) ? discovered.copilot : basePayload.services.copilot;
    const payload: AgentModelCatalogPayload = {
      source: basePayload.source,
      services: { codex, copilot }
    };
    deps.setCachedCatalog(payload, now + 30_000);
    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (now > deps.getWarnedUntilMs()) {
      deps.setWarnedUntilMs(now + 300_000);
      void deps.postStatus(`CLI model discovery unavailable; falling back to configured catalog (${message})`, "warn");
    }
    deps.setCachedCatalog(basePayload, now + 30_000);
    return basePayload;
  }
}
