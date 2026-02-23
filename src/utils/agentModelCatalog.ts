export interface AgentModelOption {
  id: string;
  label: string;
  contextWindow: number | null;
}

export interface AgentModelCatalogPayload {
  source: "settings" | "hub" | "hub-fallback";
  services: {
    codex: AgentModelOption[];
    copilot: AgentModelOption[];
  };
}

export function prettyModelLabelFromId(id: string): string {
  const acronyms = new Map<string, string>([
    ["gpt", "GPT"],
    ["api", "API"],
    ["cli", "CLI"],
    ["openai", "OpenAI"],
    ["codex", "Codex"],
    ["copilot", "Copilot"]
  ]);
  return id
    .split(/[-_\s]+/)
    .filter((token) => token.length > 0)
    .map((token) => {
      const lowered = token.toLowerCase();
      const known = acronyms.get(lowered);
      if (known) {
        return known;
      }
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(" ");
}

export function normalizeAgentModelOption(raw: unknown): AgentModelOption | null {
  if (typeof raw === "string") {
    const id = raw.trim();
    if (!id) {
      return null;
    }
    return {
      id,
      label: prettyModelLabelFromId(id),
      contextWindow: null
    };
  }

  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const id = String(source.id ?? source.model ?? source.name ?? "").trim();
  if (!id) {
    return null;
  }
  const labelRaw = String(source.label ?? source.name ?? id).trim();
  const contextCandidate = source.contextWindow ?? source.context_window ?? source.context ?? source.contextTokens ?? source.ctx;
  const contextWindow =
    typeof contextCandidate === "number" && Number.isFinite(contextCandidate) && contextCandidate > 0
      ? Math.round(contextCandidate)
      : null;

  return {
    id,
    label: labelRaw || prettyModelLabelFromId(id),
    contextWindow
  };
}

export function normalizeAgentModelList(raw: unknown): AgentModelOption[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const deduped = new Map<string, AgentModelOption>();
  for (const entry of raw) {
    const normalized = normalizeAgentModelOption(entry);
    if (!normalized) {
      continue;
    }
    deduped.set(normalized.id, normalized);
  }
  return Array.from(deduped.values());
}

export function coerceServiceModelMap(raw: unknown): Partial<Record<"codex" | "copilot", AgentModelOption[]>> {
  const result: Partial<Record<"codex" | "copilot", AgentModelOption[]>> = {};
  if (!raw) {
    return result;
  }

  if (Array.isArray(raw)) {
    const grouped: Record<"codex" | "copilot", AgentModelOption[]> = {
      codex: [],
      copilot: []
    };
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const source = entry as Record<string, unknown>;
      const service = String(source.service ?? "").trim().toLowerCase();
      if (service !== "codex" && service !== "copilot") {
        continue;
      }
      const withService = normalizeAgentModelOption(source);
      if (withService) {
        grouped[service].push(withService);
      }
    }
    if (grouped.codex.length > 0) {
      result.codex = normalizeAgentModelList(grouped.codex);
    }
    if (grouped.copilot.length > 0) {
      result.copilot = normalizeAgentModelList(grouped.copilot);
    }
    return result;
  }

  if (typeof raw !== "object") {
    return result;
  }

  const source = raw as Record<string, unknown>;
  const services = source.services && typeof source.services === "object"
    ? (source.services as Record<string, unknown>)
    : source;
  const codexModels = normalizeAgentModelList(services.codex);
  const copilotModels = normalizeAgentModelList(services.copilot);
  if (codexModels.length > 0) {
    result.codex = codexModels;
  }
  if (copilotModels.length > 0) {
    result.copilot = copilotModels;
  }
  return result;
}

export function defaultAgentModelCatalog(
  settings: { codexModelOptions: unknown; copilotModelOptions: unknown }
): AgentModelCatalogPayload {
  return {
    source: "settings",
    services: {
      codex: normalizeAgentModelList(settings.codexModelOptions),
      copilot: normalizeAgentModelList(settings.copilotModelOptions)
    }
  };
}
