import { afterEach, describe, expect, it, vi } from "vitest";
import { JarvisService } from "../src/services/JarvisService";
import { PollinationsError } from "../src/services/PollinationsResilience";

const settings = {
  apiBaseUrl: "https://text.pollinations.ai/openai",
  apiKey: "test-key",
  textModel: "openai-large",
  speechModel: "openai-audio",
  voice: "onyx",
};

describe("JarvisService pollinations resilience", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("throws structured auth failures for chat", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
    const service = new JarvisService();
    await expect(service.generateReply("system", "user", [], settings)).rejects.toMatchObject({
      name: "PollinationsError",
      kind: "auth",
      status: 401,
      channel: "chat"
    } satisfies Partial<PollinationsError>);
  });

  it("captures retry-after on 429 responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("quota exceeded", {
          status: 429,
          headers: { "retry-after": "120" }
        })
      )
    );
    const service = new JarvisService();
    await expect(service.generateReply("system", "user", [], settings)).rejects.toMatchObject({
      name: "PollinationsError",
      kind: "quota",
      retryAfterSeconds: 120,
      status: 429
    } satisfies Partial<PollinationsError>);
  });

  it("classifies server failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("internal error", { status: 503 })));
    const service = new JarvisService();
    await expect(service.generateReply("system", "user", [], settings)).rejects.toMatchObject({
      name: "PollinationsError",
      kind: "server",
      status: 503
    } satisfies Partial<PollinationsError>);
  });

  it("classifies timeout transport failures", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));
    const service = new JarvisService();
    await expect(service.generateReply("system", "user", [], settings)).rejects.toMatchObject({
      name: "PollinationsError",
      kind: "timeout",
      channel: "chat"
    } satisfies Partial<PollinationsError>);
  });

  it("classifies network transport failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const service = new JarvisService();
    await expect(service.synthesizeSpeech("hello", settings)).rejects.toMatchObject({
      name: "PollinationsError",
      kind: "network",
      channel: "speech"
    } satisfies Partial<PollinationsError>);
  });

  it("normalizes legacy key-based base URLs to gen.pollinations.ai", async () => {
    const calls: Array<{ url: unknown; body: Record<string, unknown> | null }> = [];
    const fetchMock = vi.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
      let body: Record<string, unknown> | null = null;
      if (typeof init?.body === "string") {
        body = JSON.parse(init.body) as Record<string, unknown>;
      }
      calls.push({ url: input, body });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Ready." } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = new JarvisService();

    const response = await service.generateReply("system", "user", [], settings);
    expect(response).toBe("Ready.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0]?.url).toBe("https://gen.pollinations.ai/v1/chat/completions");
  });

  it("uses Gemini TTS first when configured", async () => {
    const calls: Array<{ url: unknown; body: Record<string, unknown> | null }> = [];
    const fetchMock = vi.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
      let body: Record<string, unknown> | null = null;
      if (typeof init?.body === "string") {
        body = JSON.parse(init.body) as Record<string, unknown>;
      }
      calls.push({ url: input, body });
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      data: "QUJD",
                      mimeType: "audio/wav"
                    }
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = new JarvisService();

    const speech = await service.synthesizeSpeech("hello", {
      ...settings,
      ttsProvider: "gemini",
      geminiApiKey: "gemini-key",
      geminiModel: "gemini-2.5-flash-preview-tts",
      geminiVoice: "Charon"
    });

    expect(speech.audioBase64).toBe("QUJD");
    expect(speech.mimeType).toBe("audio/wav");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent"
    );
  });

  it("retries Gemini TTS once on abort timeout", async () => {
    const abortError = new DOMException("This operation was aborted", "AbortError");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        data: "QUJD",
                        mimeType: "audio/wav"
                      }
                    }
                  ]
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);
    const service = new JarvisService();

    const speech = await service.synthesizeSpeech("hello", {
      ...settings,
      ttsProvider: "gemini",
      geminiApiKey: "gemini-key",
      geminiModel: "gemini-2.5-flash-preview-tts",
      geminiVoice: "Charon"
    });

    expect(speech.provider).toBe("gemini");
    expect(speech.audioBase64).toBe("QUJD");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to Pollinations TTS when Gemini fails in gemini-with-fallback mode", async () => {
    const calls: Array<{ url: unknown; body: Record<string, unknown> | null }> = [];
    const fetchMock = vi.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
      let body: Record<string, unknown> | null = null;
      if (typeof init?.body === "string") {
        body = JSON.parse(init.body) as Record<string, unknown>;
      }
      calls.push({ url: input, body });

      if (calls.length === 1) {
        return new Response("quota exceeded", { status: 429 });
      }
      return new Response(Buffer.from("audio-bytes"), {
        status: 200,
        headers: { "content-type": "audio/mpeg" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = new JarvisService();

    const speech = await service.synthesizeSpeech("hello", {
      ...settings,
      ttsProvider: "gemini-with-fallback",
      geminiApiKey: "gemini-key",
      geminiModel: "gemini-2.5-flash-preview-tts",
      geminiVoice: "Charon"
    });

    expect(speech.audioBase64).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls[0]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent"
    );
    expect(calls[1]?.url).toBe("https://gen.pollinations.ai/v1/audio/speech");
  });

  it("throws when Gemini-only mode is selected without API key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const service = new JarvisService();

    await expect(
      service.synthesizeSpeech("hello", {
        ...settings,
        ttsProvider: "gemini",
        geminiApiKey: ""
      })
    ).rejects.toThrow(/gemini api key/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries speech with tts-1 when configured model is invalid", async () => {
    const calls: Array<{ url: unknown; body: Record<string, unknown> | null }> = [];
    const fetchMock = vi.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
      let body: Record<string, unknown> | null = null;
      if (typeof init?.body === "string") {
        body = JSON.parse(init.body) as Record<string, unknown>;
      }
      calls.push({ url: input, body });

      if (calls.length === 1) {
        return new Response(
          JSON.stringify({
            error: "Model not found: openai-audio"
          }),
          { status: 404, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(Buffer.from("audio-bytes"), {
        status: 200,
        headers: { "content-type": "audio/mpeg" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = new JarvisService();

    const speech = await service.synthesizeSpeech("hello", settings);
    expect(speech.audioBase64).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls[0]?.body?.model).toBe("openai-audio");
    expect(calls[1]?.body?.model).toBe("tts-1");
  });

  it("normalizes data-uri JSON audio payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          audio: "data:audio/mpeg;base64,QUJD",
          mimeType: "audio/mpeg"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new JarvisService();

    const speech = await service.synthesizeSpeech("hello", settings);
    expect(speech.audioBase64).toBe("QUJD");
  });
});
