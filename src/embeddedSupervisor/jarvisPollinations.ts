import {
  PollinationsCooldownTracker,
  PollinationsError,
  PollinationsFailureKind,
  classifyPollinationsHttpFailure,
  normalizePollinationsFailure,
  parseRetryAfterSeconds
} from "../services/PollinationsResilience";
import { buildJarvisGeminiTtsStyleInstructions, buildJarvisSystemPrompt } from "../utils/jarvisPrompts";

interface PollinationsChatResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

interface PollinationsSpeechResponse {
  audio?: unknown;
  data?: unknown;
  mimeType?: unknown;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: unknown[];
    };
  }>;
}

interface GeminiInlineAudioPart {
  data: string;
  mimeType: string | null;
}

interface WavConversionOptions {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

type JarvisTtsProvider = "gemini-with-fallback" | "gemini" | "pollinations";

const DEFAULT_GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";
const DEFAULT_GEMINI_TTS_VOICE = "Charon";

export interface EmbeddedJarvisSnapshot {
  board: { items: unknown[] };
  actions: { runs: unknown[] };
  agents: {
    sessions: Array<{
      agentId?: string | null;
      status?: string | null;
      transport?: string | null;
      summary?: string | null;
      repository?: string | null;
      workspace?: string | null;
      branch?: string | null;
      updatedAt?: string | null;
    }>;
    pendingCommands: Array<{
      status?: string | null;
      agentId?: string | null;
      risk?: string | null;
      command?: string | null;
      reason?: string | null;
    }>;
    feed: Array<{ level?: string | null; agentId?: string | null; message?: string | null; occurredAt?: string | null }>;
  };
  qa?: {
    handoffs?: Array<{
      agentId?: string | null;
      status?: string | null;
      title?: string | null;
      summary?: string | null;
    }>;
  };
}

export interface EmbeddedJarvisPollinationsConfig {
  apiBaseUrl: string;
  apiKey: string;
  textModel: string;
  speechModel: string;
  voice: string;
  ttsProvider?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  geminiVoice?: string;
  ttsDebug?: boolean;
  hardCooldownSeconds: number;
  softCooldownSeconds: number;
}

export interface EmbeddedJarvisRespondResult {
  text: string;
  source: "api" | "fallback";
  mimeType: string | null;
  audioBase64: string | null;
  failureKind: PollinationsFailureKind | null;
  chat: {
    degraded: boolean;
    failureKind: PollinationsFailureKind | null;
    cooldownUntil: string | null;
  };
  speech: {
    degraded: boolean;
    failureKind: PollinationsFailureKind | null;
    cooldownUntil: string | null;
  };
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeBaseUrl(baseUrl: string, apiKey: string): string {
  const raw = baseUrl.trim().replace(/\/+$/, "");
  const hasKey = apiKey.trim().length > 0;
  if (!raw) {
    return hasKey ? "https://gen.pollinations.ai" : "https://text.pollinations.ai/openai";
  }

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "");

    // Route auth/legacy hosts to the OpenAI-compatible API origin.
    if (host === "enter.pollinations.ai" || host === "auth.pollinations.ai" || host === "credipollinations.ai") {
      return "https://gen.pollinations.ai";
    }
    if (host === "text.pollinations.ai" && hasKey && (path === "" || path === "/openai")) {
      return "https://gen.pollinations.ai";
    }

    return `${parsed.protocol}//${parsed.host}${path}`;
  } catch {
    return raw;
  }
}

function normalizeAudioBase64(value: string): string {
  const trimmed = value.trim();
  const prefixed = trimmed.match(/^data:audio\/[^;]+;base64,(.+)$/i);
  return prefixed ? prefixed[1].trim() : trimmed;
}

function normalizedRunConclusion(run: unknown): string {
  if (!run || typeof run !== "object") {
    return "";
  }
  const maybe = (run as { conclusion?: unknown }).conclusion;
  return typeof maybe === "string" ? maybe.toLowerCase() : "";
}

const SUMMARY_SESSION_LIMIT = 8;
const SUMMARY_PENDING_LIMIT = 6;
const SUMMARY_QA_LIMIT = 6;
const SUMMARY_FEED_LIMIT = 10;

function pickPersonalityFromEmbeddedSnapshot(
  snapshot: EmbeddedJarvisSnapshot
): "serene" | "attentive" | "alert" | "escalating" {
  const pending = snapshot.agents.pendingCommands.filter((c) => c.status === "pending");
  const highRisk = pending.filter((c) => c.risk === "high");
  const errors = snapshot.agents.sessions.filter((s) => s.status === "error");
  if (highRisk.length > 0 || errors.length >= 2) return "escalating";
  if (pending.length > 0 || snapshot.agents.sessions.length > 2 || errors.length === 1) return "attentive";
  return "serene";
}

export class EmbeddedJarvisPollinationsRuntime {
  private readonly cooldown = new PollinationsCooldownTracker();

  constructor(private readonly config: EmbeddedJarvisPollinationsConfig) {}

  private resolvedBaseUrl(): string {
    return normalizeBaseUrl(this.config.apiBaseUrl, this.config.apiKey);
  }

  private endpoint(pathname: string): string {
    return `${this.resolvedBaseUrl()}${pathname}`;
  }

  async respond(input: {
    prompt: string;
    auto: boolean;
    reason: string | null;
    includeAudio: boolean;
    voiceOverride?: string | null;
    snapshot: EmbeddedJarvisSnapshot;
  }): Promise<EmbeddedJarvisRespondResult> {
    const prompt = input.prompt.trim() || "Give a concise workspace voice summary with one next action.";
    let text = "";
    let source: "api" | "fallback" = "api";
    let chatFailureKind: PollinationsFailureKind | null = null;

    const personality = pickPersonalityFromEmbeddedSnapshot(input.snapshot);
    const chatState = this.cooldown.snapshot("chat");
    if (chatState.degraded && chatState.untilMs) {
      source = "fallback";
      chatFailureKind = chatState.failureKind;
      text = this.buildFallbackText(
        input.snapshot,
        prompt,
        input.auto,
        this.cooldownNotice("chat", chatState.failureKind, chatState.untilMs)
      );
    } else {
      try {
        text = await this.generateSummaryText(prompt, input.snapshot, input.auto, personality);
        this.cooldown.clear("chat");
      } catch (error) {
        const normalized = normalizePollinationsFailure(error, {
          endpoint: this.endpoint("/v1/chat/completions"),
          channel: "chat",
          messagePrefix: "Pollinations chat request failed"
        });
        this.cooldown.noteFailure("chat", normalized, {
          hardCooldownSeconds: this.config.hardCooldownSeconds,
          softCooldownSeconds: this.config.softCooldownSeconds
        });
        source = "fallback";
        chatFailureKind = normalized.kind;
        text = this.buildFallbackText(input.snapshot, prompt, input.auto, normalized.message);
      }
    }

    let audioBase64: string | null = null;
    let mimeType: string | null = null;
    let speechFailureKind: PollinationsFailureKind | null = null;
    if (input.includeAudio) {
      const speechState = this.cooldown.snapshot("speech");
      if (!speechState.degraded || !speechState.untilMs) {
        try {
          const speech = await this.synthesizeSpeech(text, input.voiceOverride ?? null, personality);
          audioBase64 = speech.audioBase64;
          mimeType = speech.mimeType;
          this.cooldown.clear("speech");
        } catch (error) {
          const normalized = normalizePollinationsFailure(error, {
            endpoint: this.endpoint("/v1/audio/speech"),
            channel: "speech",
            messagePrefix: "Pollinations speech request failed"
          });
          this.cooldown.noteFailure("speech", normalized, {
            hardCooldownSeconds: this.config.hardCooldownSeconds,
            softCooldownSeconds: this.config.softCooldownSeconds
          });
          speechFailureKind = normalized.kind;
        }
      } else {
        speechFailureKind = speechState.failureKind;
      }
    }

    const chat = this.cooldown.snapshot("chat");
    const speech = this.cooldown.snapshot("speech");
    return {
      text,
      source,
      mimeType,
      audioBase64,
      failureKind: chatFailureKind ?? speechFailureKind,
      chat: {
        degraded: chat.degraded,
        failureKind: chat.failureKind,
        cooldownUntil: chat.untilMs ? new Date(chat.untilMs).toISOString() : null
      },
      speech: {
        degraded: speech.degraded,
        failureKind: speech.failureKind,
        cooldownUntil: speech.untilMs ? new Date(speech.untilMs).toISOString() : null
      }
    };
  }

  private async generateSummaryText(prompt: string, snapshot: EmbeddedJarvisSnapshot, auto: boolean, personality: "serene" | "attentive" | "alert" | "escalating"): Promise<string> {
    const endpoint = this.endpoint("/v1/chat/completions");
    const configuredModel = asNonEmptyString(this.config.textModel) ?? "openai";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      try {
        return await this.fetchSummaryText(endpoint, configuredModel, prompt, snapshot, auto, personality, controller.signal);
      } catch (error) {
        let normalized = normalizePollinationsFailure(error, {
          endpoint,
          channel: "chat",
          messagePrefix: "Pollinations chat request failed"
        });
        if (this.isRetryableChatFailure(normalized)) {
          try {
            return await this.fetchSummaryText(endpoint, configuredModel, prompt, snapshot, auto, personality, controller.signal);
          } catch (retryError) {
            normalized = normalizePollinationsFailure(retryError, {
              endpoint,
              channel: "chat",
              messagePrefix: "Pollinations chat request failed"
            });
          }
        }
        if (this.shouldRetryModel(normalized, configuredModel, "openai")) {
          return await this.fetchSummaryText(endpoint, "openai", prompt, snapshot, auto, personality, controller.signal);
        }
        throw normalized;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async synthesizeSpeech(
    text: string,
    voiceOverride: string | null,
    personality: "serene" | "attentive" | "alert" | "escalating"
  ): Promise<{ audioBase64: string; mimeType: string }> {
    const provider = this.resolveTtsProvider(this.config.ttsProvider);
    const geminiApiKey = asNonEmptyString(this.config.geminiApiKey);
    const geminiModel = asNonEmptyString(this.config.geminiModel) ?? DEFAULT_GEMINI_TTS_MODEL;
    const geminiVoice = asNonEmptyString(voiceOverride) ?? asNonEmptyString(this.config.geminiVoice) ?? DEFAULT_GEMINI_TTS_VOICE;
    const styleInstructions = buildJarvisGeminiTtsStyleInstructions(personality);
    const ttsDebug = Boolean(this.config.ttsDebug);

    if (provider !== "pollinations") {
      if (!geminiApiKey) {
        if (provider === "gemini") {
          throw new Error(
            "Gemini TTS is selected but no Gemini API key is configured. Set phoenixOps.jarvisGeminiApiKey."
          );
        }
      } else {
        try {
          return await this.fetchGeminiSpeechAudio({
            apiKey: geminiApiKey,
            model: geminiModel,
            voice: geminiVoice,
            text,
            styleInstructions,
            debug: ttsDebug
          });
        } catch (error) {
          if (provider === "gemini") {
            throw error;
          }
          if (ttsDebug) {
            // eslint-disable-next-line no-console
            console.warn(`[jarvis-tts] Gemini synthesis failed; using Pollinations fallback: ${this.describeError(error)}`);
          }
        }
      }
    }

    const endpoint = this.endpoint("/v1/audio/speech");
    const configuredModel = asNonEmptyString(this.config.speechModel) ?? "tts-1";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      try {
        return await this.fetchSpeechAudio(endpoint, configuredModel, text, voiceOverride, controller.signal);
      } catch (error) {
        let normalized = normalizePollinationsFailure(error, {
          endpoint,
          channel: "speech",
          messagePrefix: "Pollinations speech request failed"
        });
        if (this.isTimeoutFailure(normalized)) {
          try {
            return await this.fetchSpeechAudio(endpoint, configuredModel, text, voiceOverride, controller.signal);
          } catch (retryError) {
            normalized = normalizePollinationsFailure(retryError, {
              endpoint,
              channel: "speech",
              messagePrefix: "Pollinations speech request failed"
            });
          }
        }
        if (this.shouldRetryModel(normalized, configuredModel, "tts-1")) {
          return await this.fetchSpeechAudio(endpoint, "tts-1", text, voiceOverride, controller.signal);
        }
        throw normalized;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchSummaryText(
    endpoint: string,
    model: string,
    prompt: string,
    snapshot: EmbeddedJarvisSnapshot,
    auto: boolean,
    personality: "serene" | "attentive" | "alert" | "escalating",
    signal: AbortSignal
  ): Promise<string> {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        signal,
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: buildJarvisSystemPrompt(personality, auto)
            },
            {
              role: "user",
              content: this.summaryPrompt(prompt, snapshot, auto)
            }
          ],
          temperature: 0.5,
          max_tokens: 220
        })
      });
    } catch (error) {
      throw normalizePollinationsFailure(error, {
        endpoint,
        channel: "chat",
        messagePrefix: "Pollinations chat request failed"
      });
    }

    if (!response.ok) {
      throw await this.toHttpError(response, endpoint, "chat");
    }

    const payload = (await response.json()) as PollinationsChatResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim().length > 0) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const assembled = content
        .map((entry) => (entry && typeof entry === "object" ? asNonEmptyString((entry as { text?: unknown }).text) : null))
        .filter((entry): entry is string => Boolean(entry))
        .join(" ")
        .trim();
      if (assembled.length > 0) {
        return assembled;
      }
    }

    throw new PollinationsError({
      message: "Pollinations chat response did not include assistant text.",
      kind: "unknown",
      channel: "chat",
      endpoint
    });
  }

  private async fetchSpeechAudio(
    endpoint: string,
    model: string,
    text: string,
    voiceOverride: string | null,
    signal: AbortSignal
  ): Promise<{ audioBase64: string; mimeType: string }> {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        signal,
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model,
          voice: asNonEmptyString(voiceOverride) ?? this.config.voice,
          input: text,
          response_format: "mp3"
        })
      });
    } catch (error) {
      throw normalizePollinationsFailure(error, {
        endpoint,
        channel: "speech",
        messagePrefix: "Pollinations speech request failed"
      });
    }

    if (!response.ok) {
      throw await this.toHttpError(response, endpoint, "speech");
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as PollinationsSpeechResponse;
      const audioBase64 = asNonEmptyString(payload.audio) ?? asNonEmptyString(payload.data);
      if (!audioBase64) {
        throw new PollinationsError({
          message: "Pollinations speech JSON response missing audio payload.",
          kind: "unknown",
          channel: "speech",
          endpoint
        });
      }
      return {
        audioBase64: normalizeAudioBase64(audioBase64),
        mimeType: asNonEmptyString(payload.mimeType) ?? "audio/mpeg"
      };
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      audioBase64: bytes.toString("base64"),
      mimeType: contentType && contentType.includes("audio/") ? contentType : "audio/mpeg"
    };
  }

  private resolveTtsProvider(rawProvider: string | undefined): JarvisTtsProvider {
    const normalized = (rawProvider ?? "").trim().toLowerCase();
    if (normalized === "gemini" || normalized === "pollinations" || normalized === "gemini-with-fallback") {
      return normalized;
    }
    return "gemini-with-fallback";
  }

  private async fetchGeminiSpeechAudio(input: {
    apiKey: string;
    model: string;
    voice: string;
    text: string;
    styleInstructions: string;
    debug: boolean;
  }): Promise<{ audioBase64: string; mimeType: string }> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": input.apiKey
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: this.buildGeminiSpeechPrompt(input.text, input.styleInstructions)
                  }
                ]
              }
            ],
            generationConfig: {
              temperature: 1,
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: input.voice
                  }
                }
              }
            }
          })
        });
      } catch (error) {
        throw new Error(`Gemini speech request failed: ${this.describeError(error)}`);
      }

      if (!response.ok) {
        let details: string | null = null;
        try {
          details = (await response.text()).trim() || null;
        } catch {
          details = null;
        }
        throw new Error(`Gemini speech failed (HTTP ${response.status})${details ? `: ${details}` : ""}`);
      }

      const payload = (await response.json()) as GeminiGenerateContentResponse;
      const extracted = this.extractGeminiInlineAudio(payload);
      if (!extracted) {
        throw new Error("Gemini speech response did not include inline audio.");
      }
      const normalized = this.normalizeGeminiAudio(extracted);
      if (input.debug) {
        // eslint-disable-next-line no-console
        console.log(
          `[jarvis-tts] Gemini synthesis ok (model=${input.model}, voice=${input.voice}, mimeType=${normalized.mimeType}).`
        );
      }
      return normalized;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildGeminiSpeechPrompt(text: string, styleInstructions: string): string {
    return [
      "You are Jarvis, a British AI assistant with a sophisticated accent and personality.",
      "Your task is to synthesize the following text-to-speech using these delivery guidelines:",
      "",
      "STYLE INSTRUCTIONS FOR TTS:",
      styleInstructions,
      "",
      "Synthesize the text below with those exact speaking qualities.",
      text
    ].join("\n");
  }

  private extractGeminiInlineAudio(payload: GeminiGenerateContentResponse): GeminiInlineAudioPart | null {
    const bytes: Buffer[] = [];
    let mimeType: string | null = null;
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    for (const candidate of candidates) {
      const parts = candidate?.content?.parts;
      if (!Array.isArray(parts)) {
        continue;
      }
      for (const part of parts) {
        const inline = this.toGeminiInlineAudio(part);
        if (!inline) {
          continue;
        }
        try {
          bytes.push(Buffer.from(inline.data, "base64"));
          if (!mimeType && inline.mimeType) {
            mimeType = inline.mimeType;
          }
        } catch {
          // Skip malformed chunks and continue scanning.
        }
      }
      if (bytes.length > 0) {
        break;
      }
    }

    if (bytes.length === 0) {
      return null;
    }

    return {
      data: Buffer.concat(bytes).toString("base64"),
      mimeType
    };
  }

  private toGeminiInlineAudio(part: unknown): GeminiInlineAudioPart | null {
    if (!part || typeof part !== "object") {
      return null;
    }
    const rawPart = part as Record<string, unknown>;
    const inlineRaw = rawPart.inlineData ?? rawPart.inline_data;
    if (!inlineRaw || typeof inlineRaw !== "object") {
      return null;
    }
    const rawInline = inlineRaw as Record<string, unknown>;
    const data = asNonEmptyString(rawInline.data);
    if (!data) {
      return null;
    }
    return {
      data: normalizeAudioBase64(data),
      mimeType: asNonEmptyString(rawInline.mimeType) ?? asNonEmptyString(rawInline.mime_type)
    };
  }

  private normalizeGeminiAudio(inline: GeminiInlineAudioPart): { audioBase64: string; mimeType: string } {
    const normalizedMime = (inline.mimeType ?? "").toLowerCase();
    const pcm = this.parsePcmMimeType(normalizedMime);
    if (!pcm) {
      return {
        audioBase64: normalizeAudioBase64(inline.data),
        mimeType: inline.mimeType ?? "audio/wav"
      };
    }

    const rawBytes = Buffer.from(inline.data, "base64");
    const wavHeader = this.createWavHeader(rawBytes.length, pcm);
    return {
      audioBase64: Buffer.concat([wavHeader, rawBytes]).toString("base64"),
      mimeType: "audio/wav"
    };
  }

  private parsePcmMimeType(mimeType: string): WavConversionOptions | null {
    if (!mimeType) {
      return null;
    }
    const [fileType, ...params] = mimeType.split(";").map((entry) => entry.trim());
    const [category, format] = fileType.split("/");
    if (category !== "audio" || !format || !format.toLowerCase().startsWith("l")) {
      return null;
    }

    const bits = Number.parseInt(format.slice(1), 10);
    const options: WavConversionOptions = {
      numChannels: 1,
      sampleRate: 24_000,
      bitsPerSample: Number.isFinite(bits) && bits > 0 ? bits : 16
    };

    for (const param of params) {
      const [rawKey = "", rawValue = ""] = param.split("=").map((entry) => entry.trim().toLowerCase());
      const numeric = Number.parseInt(rawValue, 10);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        continue;
      }
      if (rawKey === "rate" || rawKey === "samplerate") {
        options.sampleRate = numeric;
      }
      if (rawKey === "channels" || rawKey === "channel") {
        options.numChannels = numeric;
      }
    }

    return options;
  }

  private createWavHeader(dataLength: number, options: WavConversionOptions): Buffer {
    const byteRate = options.sampleRate * options.numChannels * options.bitsPerSample / 8;
    const blockAlign = options.numChannels * options.bitsPerSample / 8;
    const buffer = Buffer.alloc(44);

    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(options.numChannels, 22);
    buffer.writeUInt32LE(options.sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(options.bitsPerSample, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataLength, 40);
    return buffer;
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  private async toHttpError(
    response: Response,
    endpoint: string,
    channel: "chat" | "speech"
  ): Promise<PollinationsError> {
    let details: string | null = null;
    try {
      details = (await response.text()).trim() || null;
    } catch {
      details = null;
    }

    return new PollinationsError({
      message: `Pollinations ${channel} failed (HTTP ${response.status})${details ? `: ${details}` : ""}`,
      kind: classifyPollinationsHttpFailure(response.status, details),
      channel,
      endpoint,
      status: response.status,
      retryAfterSeconds: parseRetryAfterSeconds(response.headers.get("retry-after")),
      details
    });
  }

  private shouldRetryModel(error: PollinationsError, configuredModel: string, fallbackModel: string): boolean {
    if ((configuredModel || "").trim().toLowerCase() === fallbackModel.toLowerCase()) {
      return false;
    }
    if (error.kind !== "invalid_request") {
      return false;
    }
    const details = `${error.message}\n${error.details ?? ""}`.toLowerCase();
    return (
      details.includes("model not found") ||
      details.includes("unknown model") ||
      details.includes("invalid model") ||
      details.includes("unsupported model")
    );
  }

  private isTimeoutFailure(error: PollinationsError): boolean {
    return error.kind === "timeout";
  }

  private isRetryableChatFailure(error: PollinationsError): boolean {
    if (this.isTimeoutFailure(error)) {
      return true;
    }
    if (error.kind !== "unknown") {
      return false;
    }
    const details = `${error.message}\n${error.details ?? ""}`.toLowerCase();
    return details.includes("did not include assistant text");
  }

  private cooldownNotice(channel: "chat" | "speech", kind: PollinationsFailureKind | null, untilMs: number): string {
    return `Pollinations ${channel} cooldown is active (${kind ?? "unknown"}) until ${new Date(untilMs).toISOString()}.`;
  }

  private summaryPrompt(prompt: string, snapshot: EmbeddedJarvisSnapshot, auto: boolean): string {
    const waiting = snapshot.agents.sessions.filter((session) => (session.status ?? "").toLowerCase() === "waiting").length;
    const errored = snapshot.agents.sessions.filter((session) => (session.status ?? "").toLowerCase() === "error").length;
    const pendingCommands = snapshot.agents.pendingCommands.filter((command) => (command.status ?? "").toLowerCase() === "pending");
    const highRisk = pendingCommands.filter((command) => (command.risk ?? "").toLowerCase() === "high").length;
    const mediumRisk = pendingCommands.filter((command) => (command.risk ?? "").toLowerCase() === "medium").length;
    const lowRisk = pendingCommands.filter((command) => (command.risk ?? "").toLowerCase() === "low").length;
    const pendingQa = (snapshot.qa?.handoffs ?? []).filter((handoff) => (handoff.status ?? "").toLowerCase() === "pending");
    const failures = snapshot.actions.runs.filter((run) => {
      const conclusion = normalizedRunConclusion(run);
      return ["failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(conclusion);
    }).length;
    const sessionHighlights = this.prioritizedSessions(snapshot)
      .slice(0, SUMMARY_SESSION_LIMIT)
      .map(
        (session) =>
          `${session.agentId ?? "agent"} [${(session.status ?? "unknown").toLowerCase()}/${session.transport ?? "unknown"}] ` +
          `repo=${this.clip(session.repository ?? session.workspace, 40)} branch=${this.clip(session.branch, 24)} ` +
          `summary=${this.clip(session.summary, 120)}`
      )
      .join(" | ");
    const pendingDetails = pendingCommands
      .slice(0, SUMMARY_PENDING_LIMIT)
      .map((command) => {
        const reason = this.clip(command.reason, 120);
        return `${command.agentId ?? "agent"} [${command.risk ?? "unknown"}] command=${this.clip(command.command, 80)}${reason ? ` reason=${reason}` : ""}`;
      })
      .join(" | ");
    const qaDetails = pendingQa
      .slice(0, SUMMARY_QA_LIMIT)
      .map(
        (handoff) =>
          `${handoff.agentId ?? "agent"} title=${this.clip(handoff.title, 72)} summary=${this.clip(handoff.summary, 100)}`
      )
      .join(" | ");
    const latestFeed = [...snapshot.agents.feed]
      .sort((a, b) => this.asTimestamp(b.occurredAt) - this.asTimestamp(a.occurredAt))
      .slice(0, SUMMARY_FEED_LIMIT)
      .map((entry) => `[${entry.level ?? "info"}] ${entry.agentId ?? "agent"}: ${this.clip(entry.message, 140)}`)
      .join(" | ");

    return [
      `Operator request: ${prompt}`,
      `Mode: ${auto ? "automatic callout" : "manual interaction"}`,
      "Generate a spoken-ready summary from current session context only. Do not invent details.",
      `Board items: ${snapshot.board.items.length}`,
      `Actions runs: ${snapshot.actions.runs.length} total, ${failures} need attention`,
      `Agent sessions: ${snapshot.agents.sessions.length} total, ${waiting} waiting, ${errored} error`,
      `Session highlights: ${sessionHighlights || "none"}`,
      `Pending commands: ${pendingCommands.length} total (${highRisk} high / ${mediumRisk} medium / ${lowRisk} low)`,
      `Pending command details: ${pendingDetails || "none"}`,
      `QA handoffs pending: ${pendingQa.length} total`,
      `QA handoff details: ${qaDetails || "none"}`,
      `Recent session feed: ${latestFeed || "none"}`
    ].join("\n");
  }

  private buildFallbackText(snapshot: EmbeddedJarvisSnapshot, prompt: string, auto: boolean, failureMessage: string): string {
    const waiting = snapshot.agents.sessions.filter((session) => (session.status ?? "").toLowerCase() === "waiting").length;
    const pending = snapshot.agents.pendingCommands.filter((command) => (command.status ?? "").toLowerCase() === "pending").length;
    const failures = snapshot.actions.runs.filter((run) => {
      const conclusion = normalizedRunConclusion(run);
      return ["failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(conclusion);
    }).length;
    const lead = auto ? "Quick supervisor check: " : "Current workspace status: ";
    const extra = /\bjoke\b/i.test(prompt)
      ? "Would you like a short ops-safe joke after this update?"
      : "I can provide deeper session-by-session details if you want.";
    const primary = this.prioritizedSessions(snapshot)[0];
    const primaryLine = primary
      ? `${primary.agentId ?? "Agent"} is ${(primary.status ?? "unknown").toLowerCase()}${primary.summary ? ` (${this.clip(primary.summary, 100)})` : ""}.`
      : "No specific agent session is currently highlighted.";
    return `${lead}${waiting} waiting session${waiting === 1 ? "" : "s"}, ${pending} pending command${pending === 1 ? "" : "s"}, and ${failures} workflow run${failures === 1 ? "" : "s"} need attention. ${primaryLine} ${failureMessage} ${extra}`.trim();
  }

  private prioritizedSessions(snapshot: EmbeddedJarvisSnapshot): EmbeddedJarvisSnapshot["agents"]["sessions"] {
    return [...snapshot.agents.sessions].sort((left, right) => {
      const rankDelta = this.statusPriority(left.status) - this.statusPriority(right.status);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      return this.asTimestamp(right.updatedAt) - this.asTimestamp(left.updatedAt);
    });
  }

  private statusPriority(status: string | null | undefined): number {
    const lowered = (status ?? "").toLowerCase();
    if (lowered === "error") {
      return 0;
    }
    if (lowered === "waiting") {
      return 1;
    }
    if (lowered === "busy") {
      return 2;
    }
    if (lowered === "online") {
      return 3;
    }
    if (lowered === "idle") {
      return 4;
    }
    if (lowered === "offline") {
      return 5;
    }
    return 6;
  }

  private asTimestamp(value: string | null | undefined): number {
    if (!value) {
      return 0;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private clip(value: string | null | undefined, maxLength: number): string {
    if (!value) {
      return "";
    }
    const compact = value.replace(/\s+/g, " ").trim();
    if (compact.length <= maxLength) {
      return compact;
    }
    return `${compact.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
  }
}
