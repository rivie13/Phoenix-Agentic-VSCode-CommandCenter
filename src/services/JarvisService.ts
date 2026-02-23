import {
  PollinationsChannel,
  PollinationsError,
  classifyPollinationsHttpFailure,
  classifyPollinationsTransportFailure,
  parseRetryAfterSeconds
} from "./PollinationsResilience";

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
}

export interface JarvisSpeechResult {
  audioBase64: string;
  mimeType: string;
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
  private readonly timeoutMs = 15_000;

  async generateReply(
    systemPrompt: string,
    userPrompt: string,
    history: JarvisConversationTurn[],
    settings: JarvisServiceSettings
  ): Promise<string> {
    const endpoint = `${this.resolvedBaseUrl(settings)}/v1/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

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

  async synthesizeSpeech(text: string, settings: JarvisServiceSettings): Promise<JarvisSpeechResult> {
    const endpoint = `${this.resolvedBaseUrl(settings)}/v1/audio/speech`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const configuredModel = asNonEmptyString(settings.speechModel) ?? "tts-1";
      try {
        return await this.fetchSpeechAudio(endpoint, configuredModel, settings.voice, text, settings.apiKey, controller.signal);
      } catch (error) {
        let normalized = this.toNormalizedError(error, endpoint, "speech");
        if (this.isTimeoutFailure(normalized)) {
          try {
            return await this.fetchSpeechAudio(endpoint, configuredModel, settings.voice, text, settings.apiKey, controller.signal);
          } catch (retryError) {
            normalized = this.toNormalizedError(retryError, endpoint, "speech");
          }
        }
        if (this.shouldRetryModel(normalized, configuredModel, "tts-1")) {
          return await this.fetchSpeechAudio(endpoint, "tts-1", settings.voice, text, settings.apiKey, controller.signal);
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
  ): Promise<JarvisSpeechResult> {
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
