export type PollinationsFailureKind =
  | "auth"
  | "quota"
  | "rate_limit"
  | "timeout"
  | "network"
  | "server"
  | "invalid_request"
  | "unknown";

export type PollinationsChannel = "chat" | "speech";

const HARD_FAILURE_KINDS = new Set<PollinationsFailureKind>(["auth", "quota", "rate_limit", "invalid_request"]);
const DEFAULT_MAX_COOLDOWN_SECONDS = 1800;

export class PollinationsError extends Error {
  readonly kind: PollinationsFailureKind;
  readonly channel: PollinationsChannel;
  readonly endpoint: string;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;
  readonly details: string | null;

  constructor(input: {
    message: string;
    kind: PollinationsFailureKind;
    channel: PollinationsChannel;
    endpoint: string;
    status?: number | null;
    retryAfterSeconds?: number | null;
    details?: string | null;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "PollinationsError";
    this.kind = input.kind;
    this.channel = input.channel;
    this.endpoint = input.endpoint;
    this.status = typeof input.status === "number" ? input.status : null;
    this.retryAfterSeconds = typeof input.retryAfterSeconds === "number" ? input.retryAfterSeconds : null;
    this.details = typeof input.details === "string" && input.details.trim().length > 0 ? input.details.trim() : null;
  }
}

export function isPollinationsError(value: unknown): value is PollinationsError {
  return value instanceof PollinationsError;
}

export function parseRetryAfterSeconds(value: string | null | undefined, nowMs = Date.now()): number | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.ceil(numeric);
  }

  const parsedDateMs = Date.parse(trimmed);
  if (!Number.isFinite(parsedDateMs)) {
    return null;
  }
  const deltaSeconds = Math.ceil((parsedDateMs - nowMs) / 1000);
  return deltaSeconds > 0 ? deltaSeconds : null;
}

export function classifyPollinationsHttpFailure(status: number, details: string | null): PollinationsFailureKind {
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 429) {
    const lowered = (details ?? "").toLowerCase();
    if (
      lowered.includes("quota") ||
      lowered.includes("out of credits") ||
      lowered.includes("insufficient credit") ||
      lowered.includes("balance")
    ) {
      return "quota";
    }
    return "rate_limit";
  }
  if (status >= 500) {
    return "server";
  }
  if (status === 400 || status === 404 || status === 405 || status === 409 || status === 413 || status === 415 || status === 422) {
    return "invalid_request";
  }
  return "unknown";
}

export function classifyPollinationsTransportFailure(error: unknown): PollinationsFailureKind {
  if (error && typeof error === "object") {
    const named = error as { name?: unknown; message?: unknown };
    if (typeof named.name === "string" && named.name === "AbortError") {
      return "timeout";
    }

    const message = typeof named.message === "string" ? named.message.toLowerCase() : "";
    if (message.includes("timeout") || message.includes("timed out") || message.includes("aborted")) {
      return "timeout";
    }
    if (
      message.includes("fetch failed") ||
      message.includes("failed to fetch") ||
      message.includes("network") ||
      message.includes("econnrefused") ||
      message.includes("enotfound")
    ) {
      return "network";
    }
  }
  return "unknown";
}

export function normalizePollinationsFailure(
  error: unknown,
  fallback: { endpoint: string; channel: PollinationsChannel; messagePrefix: string }
): PollinationsError {
  if (isPollinationsError(error)) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const kind = classifyPollinationsTransportFailure(error);
  return new PollinationsError({
    message: `${fallback.messagePrefix}: ${message}`,
    kind,
    channel: fallback.channel,
    endpoint: fallback.endpoint,
    details: message,
    cause: error
  });
}

export function computePollinationsCooldownSeconds(input: {
  kind: PollinationsFailureKind;
  retryAfterSeconds?: number | null;
  hardCooldownSeconds: number;
  softCooldownSeconds: number;
  maxCooldownSeconds?: number;
}): number {
  const maxCooldownSeconds = Math.max(1, input.maxCooldownSeconds ?? DEFAULT_MAX_COOLDOWN_SECONDS);
  if (typeof input.retryAfterSeconds === "number" && Number.isFinite(input.retryAfterSeconds) && input.retryAfterSeconds > 0) {
    return Math.min(Math.ceil(input.retryAfterSeconds), maxCooldownSeconds);
  }
  const baselineSeconds = HARD_FAILURE_KINDS.has(input.kind)
    ? Math.max(1, Math.ceil(input.hardCooldownSeconds))
    : Math.max(1, Math.ceil(input.softCooldownSeconds));
  return Math.min(baselineSeconds, maxCooldownSeconds);
}

interface CooldownState {
  untilMs: number;
  failureKind: PollinationsFailureKind | null;
  warnedUntilMs: number;
}

export interface PollinationsCooldownSnapshot {
  degraded: boolean;
  failureKind: PollinationsFailureKind | null;
  untilMs: number | null;
}

export class PollinationsCooldownTracker {
  private readonly state: Record<PollinationsChannel, CooldownState> = {
    chat: { untilMs: 0, failureKind: null, warnedUntilMs: 0 },
    speech: { untilMs: 0, failureKind: null, warnedUntilMs: 0 }
  };

  noteFailure(
    channel: PollinationsChannel,
    failure: PollinationsError,
    cooldownSettings: { hardCooldownSeconds: number; softCooldownSeconds: number },
    nowMs = Date.now()
  ): { untilMs: number; cooldownSeconds: number } {
    this.prune(nowMs);
    const cooldownSeconds = computePollinationsCooldownSeconds({
      kind: failure.kind,
      retryAfterSeconds: failure.retryAfterSeconds,
      hardCooldownSeconds: cooldownSettings.hardCooldownSeconds,
      softCooldownSeconds: cooldownSettings.softCooldownSeconds
    });
    const untilMs = Math.max(this.state[channel].untilMs, nowMs + cooldownSeconds * 1000);
    this.state[channel].untilMs = untilMs;
    this.state[channel].failureKind = failure.kind;
    return { untilMs, cooldownSeconds };
  }

  clear(channel: PollinationsChannel): void {
    this.state[channel].untilMs = 0;
    this.state[channel].failureKind = null;
    this.state[channel].warnedUntilMs = 0;
  }

  isActive(channel: PollinationsChannel, nowMs = Date.now()): boolean {
    this.prune(nowMs);
    return this.state[channel].untilMs > nowMs;
  }

  snapshot(channel: PollinationsChannel, nowMs = Date.now()): PollinationsCooldownSnapshot {
    this.prune(nowMs);
    const current = this.state[channel];
    return {
      degraded: current.untilMs > nowMs,
      failureKind: current.failureKind,
      untilMs: current.untilMs > nowMs ? current.untilMs : null
    };
  }

  shouldWarn(channel: PollinationsChannel, untilMs: number, nowMs = Date.now()): boolean {
    this.prune(nowMs);
    const warnedUntilMs = this.state[channel].warnedUntilMs;
    return warnedUntilMs <= nowMs || untilMs > warnedUntilMs;
  }

  markWarned(channel: PollinationsChannel, untilMs: number): void {
    this.state[channel].warnedUntilMs = untilMs;
  }

  private prune(nowMs: number): void {
    for (const channel of ["chat", "speech"] as const) {
      if (this.state[channel].untilMs <= nowMs) {
        this.state[channel].untilMs = 0;
        this.state[channel].failureKind = null;
        if (this.state[channel].warnedUntilMs <= nowMs) {
          this.state[channel].warnedUntilMs = 0;
        }
      }
    }
  }
}
