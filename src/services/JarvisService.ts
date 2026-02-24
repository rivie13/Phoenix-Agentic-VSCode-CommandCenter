import {
  PollinationsChannel,
  PollinationsError,
  classifyPollinationsHttpFailure,
  classifyPollinationsTransportFailure,
  parseRetryAfterSeconds
} from "./PollinationsResilience";
import { buildJarvisGeminiTtsStyleInstructions } from "../utils/jarvisPrompts";

export interface JarvisConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface JarvisServiceSettings {
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
}

export interface JarvisSpeechResult {
  audioBase64: string;
  mimeType: string;
  provider: "gemini" | "pollinations";
  mode: JarvisTtsProvider;
  usedFallback: boolean;
  geminiAttempted: boolean;
  geminiError: string | null;
}

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
const CHAT_REQUEST_TIMEOUT_MS = 75_000;
const SPEECH_REQUEST_TIMEOUT_MS = 75_000;

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeConfiguredBaseUrl(baseUrl: string, apiKey: string): string {
  const raw = baseUrl.trim().replace(/\/+$/, "");
  const hasKey = apiKey.trim().length > 0;
  if (!raw) {
    return hasKey ? "https://gen.pollinations.ai" : "https://text.pollinations.ai/openai";
  }

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "");

    // Map auth portals or legacy hosts to the OpenAI-compatible API gateway.
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

export class JarvisService {
  private readonly chatTimeoutMs = CHAT_REQUEST_TIMEOUT_MS;
  private readonly speechTimeoutMs = SPEECH_REQUEST_TIMEOUT_MS;

  async generateReply(
    systemPrompt: string,
    userPrompt: string,
    history: JarvisConversationTurn[],
    settings: JarvisServiceSettings
  ): Promise<string> {
    const endpoint = `${this.resolvedBaseUrl(settings)}/v1/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.chatTimeoutMs);

    try {
      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt }
      ];

      for (const turn of history.slice(-10)) {
        messages.push({ role: turn.role, content: turn.content });
      }
      messages.push({ role: "user", content: userPrompt });

      const configuredModel = asNonEmptyString(settings.textModel) ?? "openai";
      try {
        return await this.fetchChatReply(endpoint, configuredModel, messages, settings.apiKey, controller.signal);
      } catch (error) {
        let normalized = this.toNormalizedError(error, endpoint, "chat");

        if (this.isRetryableChatFailure(normalized)) {
          try {
            return await this.fetchChatReply(endpoint, configuredModel, messages, settings.apiKey, controller.signal);
          } catch (retryError) {
            normalized = this.toNormalizedError(retryError, endpoint, "chat");
          }
        }
        if (this.shouldRetryModel(normalized, configuredModel, "openai")) {
          return await this.fetchChatReply(endpoint, "openai", messages, settings.apiKey, controller.signal);
        }
        throw normalized;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async synthesizeSpeech(text: string, settings: JarvisServiceSettings, ttsInstructions?: string): Promise<JarvisSpeechResult> {
    const provider = this.resolveTtsProvider(settings.ttsProvider);
    const styleInstructions = asNonEmptyString(ttsInstructions) ?? buildJarvisGeminiTtsStyleInstructions("attentive");
    const geminiApiKey = asNonEmptyString(settings.geminiApiKey);
    const geminiModel = asNonEmptyString(settings.geminiModel) ?? DEFAULT_GEMINI_TTS_MODEL;
    const geminiVoice = asNonEmptyString(settings.geminiVoice) ?? DEFAULT_GEMINI_TTS_VOICE;
    const ttsDebug = Boolean(settings.ttsDebug);
    let geminiAttempted = false;
    let geminiError: string | null = null;

    if (provider !== "pollinations") {
      if (!geminiApiKey) {
        if (provider === "gemini") {
          throw new Error(
            "Gemini TTS is selected but no Gemini API key is configured. Set phoenixOps.jarvisGeminiApiKey."
          );
        }
      } else {
        geminiAttempted = true;
        try {
          const fetchGemini = async (): Promise<{ audioBase64: string; mimeType: string }> => {
            return await this.fetchGeminiSpeechAudio({
              apiKey: geminiApiKey,
              model: geminiModel,
              voice: geminiVoice,
              text,
              styleInstructions,
              debug: ttsDebug
            });
          };

          let geminiResult: { audioBase64: string; mimeType: string };
          try {
            geminiResult = await fetchGemini();
          } catch (error) {
            if (!this.looksLikeAbortTimeout(error)) {
              throw error;
            }
            geminiResult = await fetchGemini();
          }

          return {
            ...geminiResult,
            provider: "gemini",
            mode: provider,
            usedFallback: false,
            geminiAttempted,
            geminiError: null
          };
        } catch (error) {
          geminiError = this.describeError(error);
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

    const endpoint = `${this.resolvedBaseUrl(settings)}/v1/audio/speech`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.speechTimeoutMs);

    try {
      const configuredModel = asNonEmptyString(settings.speechModel) ?? "tts-1";
      try {
        const pollinationsResult = await this.fetchSpeechAudio(endpoint, configuredModel, settings.voice, text, settings.apiKey, controller.signal);
        return {
          ...pollinationsResult,
          provider: "pollinations",
          mode: provider,
          usedFallback: geminiAttempted,
          geminiAttempted,
          geminiError
        };
      } catch (error) {
        let normalized = this.toNormalizedError(error, endpoint, "speech");
        if (this.isTimeoutFailure(normalized)) {
          try {
            const retryResult = await this.fetchSpeechAudio(endpoint, configuredModel, settings.voice, text, settings.apiKey, controller.signal);
            return {
              ...retryResult,
              provider: "pollinations",
              mode: provider,
              usedFallback: geminiAttempted,
              geminiAttempted,
              geminiError
            };
          } catch (retryError) {
            normalized = this.toNormalizedError(retryError, endpoint, "speech");
          }
        }
        if (this.shouldRetryModel(normalized, configuredModel, "tts-1")) {
          const modelRetryResult = await this.fetchSpeechAudio(endpoint, "tts-1", settings.voice, text, settings.apiKey, controller.signal);
          return {
            ...modelRetryResult,
            provider: "pollinations",
            mode: provider,
            usedFallback: geminiAttempted,
            geminiAttempted,
            geminiError
          };
        }
        throw normalized;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private resolvedBaseUrl(settings: JarvisServiceSettings): string {
    return normalizeConfiguredBaseUrl(settings.apiBaseUrl, settings.apiKey);
  }

  private async fetchChatReply(
    endpoint: string,
    model: string,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    apiKey: string,
    signal: AbortSignal
  ): Promise<string> {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        signal,
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.6,
          max_tokens: 280
        })
      });
    } catch (error) {
      throw this.toTransportError(error, endpoint, "chat");
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
    voice: string,
    text: string,
    apiKey: string,
    signal: AbortSignal
  ): Promise<{ audioBase64: string; mimeType: string }> {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        signal,
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify({
          model,
          voice,
          input: text,
          response_format: "mp3"
        })
      });
    } catch (error) {
      throw this.toTransportError(error, endpoint, "speech");
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
          message: "Pollinations speech response was JSON but missing audio data.",
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
    const timeout = setTimeout(() => controller.abort(), this.speechTimeoutMs);
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

  private looksLikeAbortTimeout(error: unknown): boolean {
    const message = this.describeError(error).toLowerCase();
    return (
      message.includes("aborted") ||
      message.includes("aborterror") ||
      message.includes("timed out") ||
      message.includes("timeout")
    );
  }

  private buildHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (apiKey.trim().length > 0) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }

    return headers;
  }

  private async toHttpError(response: Response, endpoint: string, channel: PollinationsChannel): Promise<PollinationsError> {
    let details: string | null = null;
    try {
      details = (await response.text()).trim() || null;
    } catch {
      details = null;
    }

    const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("retry-after"));
    const kind = classifyPollinationsHttpFailure(response.status, details);
    const detailSuffix = details ? `: ${details}` : "";
    return new PollinationsError({
      message: `Pollinations ${channel} failed (HTTP ${response.status})${detailSuffix}`,
      kind,
      channel,
      endpoint,
      status: response.status,
      retryAfterSeconds,
      details
    });
  }

  private toNormalizedError(error: unknown, endpoint: string, channel: PollinationsChannel): PollinationsError {
    if (error instanceof PollinationsError) {
      return error;
    }
    return this.toTransportError(error, endpoint, channel);
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

  private toTransportError(error: unknown, endpoint: string, channel: PollinationsChannel): PollinationsError {
    if (error instanceof PollinationsError) {
      return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const kind = classifyPollinationsTransportFailure(error);
    return new PollinationsError({
      message: `Pollinations ${channel} request failed: ${message}`,
      kind,
      channel,
      endpoint,
      details: message,
      cause: error
    });
  }
}
