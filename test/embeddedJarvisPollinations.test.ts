import { afterEach, describe, expect, it, vi } from "vitest";
import { EmbeddedJarvisPollinationsRuntime, EmbeddedJarvisSnapshot } from "../src/embeddedSupervisor/jarvisPollinations";

function makeSnapshot(): EmbeddedJarvisSnapshot {
  return {
    board: { items: [] },
    actions: { runs: [] },
    agents: { sessions: [], pendingCommands: [], feed: [] },
    qa: { handoffs: [] }
  };
}

function makeRuntime(
  overrides: Partial<ConstructorParameters<typeof EmbeddedJarvisPollinationsRuntime>[0]> = {}
): EmbeddedJarvisPollinationsRuntime {
  return new EmbeddedJarvisPollinationsRuntime({
    apiBaseUrl: "https://text.pollinations.ai/openai",
    apiKey: "test-key",
    textModel: "openai-large",
    speechModel: "openai-audio",
    voice: "onyx",
    ttsProvider: "gemini-with-fallback",
    geminiApiKey: "",
    geminiModel: "gemini-2.5-flash-preview-tts",
    geminiVoice: "Charon",
    ttsDebug: false,
    hardCooldownSeconds: 900,
    softCooldownSeconds: 120,
    ...overrides
  });
}

describe("EmbeddedJarvisPollinationsRuntime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("builds text-summary prompts from session, pending, feed, and QA context", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn().mockImplementation(async (_input: unknown, init?: RequestInit) => {
      if (init?.body && typeof init.body === "string") {
        capturedBody = JSON.parse(init.body) as Record<string, unknown>;
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Summary: Session and QA status is stable." } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = makeSnapshot();
    snapshot.agents.sessions.push({
      agentId: "Codex",
      status: "waiting",
      transport: "local",
      repository: "rivie13/Phoenix-Agentic-VSCode-CommandCenter",
      branch: "feat/jarvis-context",
      summary: "Working through supervisor endpoint parity."
    });
    snapshot.agents.pendingCommands.push({
      status: "pending",
      agentId: "Codex",
      risk: "medium",
      command: "Open PR for Jarvis parity changes",
      reason: "Needs operator approval before PR."
    });
    snapshot.agents.feed.push({
      level: "info",
      agentId: "Codex",
      message: "Patched prompt context and queued tests.",
      occurredAt: new Date().toISOString()
    });
    snapshot.qa?.handoffs?.push({
      agentId: "Codex",
      status: "pending",
      title: "Jarvis parity QA",
      summary: "Validate chat->speech degraded flow."
    });

    await makeRuntime().respond({
      prompt: "Summarize current status.",
      auto: false,
      reason: "manual-request",
      includeAudio: false,
      snapshot
    });

    const payload = capturedBody as { messages?: Array<{ role: string; content: string }> } | null;
    const promptContent = payload?.messages?.find((message) => message.role === "user")?.content ?? "";
    expect(promptContent).toContain("Session highlights:");
    expect(promptContent).toContain("Pending command details:");
    expect(promptContent).toContain("QA handoff details:");
    expect(promptContent).toContain("Recent session feed:");
  });

  it("normalizes legacy base URLs and retries speech with tts-1 fallback model", async () => {
    const calls: Array<{ url: unknown; body: Record<string, unknown> | null }> = [];
    const fetchMock = vi.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
      let body: Record<string, unknown> | null = null;
      if (init?.body && typeof init.body === "string") {
        body = JSON.parse(init.body) as Record<string, unknown>;
      }
      calls.push({ url: input, body });

      if (calls.length === 1) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Supervisor summary from API." } }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (calls.length === 2) {
        return new Response(
          JSON.stringify({
            error: "Model not found: openai-audio"
          }),
          { status: 404, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(Buffer.from("audio-bytes"), { status: 200, headers: { "content-type": "audio/mpeg" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await makeRuntime().respond({
      prompt: "Summarize current status.",
      auto: false,
      reason: "manual-request",
      includeAudio: true,
      snapshot: makeSnapshot()
    });

    expect(result.source).toBe("api");
    expect(result.audioBase64).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(calls[0]?.url).toBe("https://gen.pollinations.ai/v1/chat/completions");
    expect(calls[1]?.url).toBe("https://gen.pollinations.ai/v1/audio/speech");
    expect(calls[1]?.body?.model).toBe("openai-audio");
    expect(calls[2]?.body?.model).toBe("tts-1");
  });

  it("uses voice override for speech synthesis when provided", async () => {
    const calls: Array<{ url: unknown; body: Record<string, unknown> | null }> = [];
    const fetchMock = vi.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
      let body: Record<string, unknown> | null = null;
      if (init?.body && typeof init.body === "string") {
        body = JSON.parse(init.body) as Record<string, unknown>;
      }
      calls.push({ url: input, body });

      if (calls.length === 1) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Voice override summary." } }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(Buffer.from("audio-bytes"), {
        status: 200,
        headers: { "content-type": "audio/mpeg" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await makeRuntime().respond({
      prompt: "Summarize current status.",
      auto: false,
      reason: "manual-request",
      includeAudio: true,
      voiceOverride: "onyx",
      snapshot: makeSnapshot()
    });

    expect(result.source).toBe("api");
    expect(result.audioBase64).toBeTruthy();
    expect(calls[1]?.body?.voice).toBe("onyx");
  });

  it("uses Gemini TTS first when configured", async () => {
    const calls: Array<{ url: unknown; body: Record<string, unknown> | null }> = [];
    const fetchMock = vi.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
      let body: Record<string, unknown> | null = null;
      if (init?.body && typeof init.body === "string") {
        body = JSON.parse(init.body) as Record<string, unknown>;
      }
      calls.push({ url: input, body });

      if (calls.length === 1) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Gemini-first summary." } }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

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

    const result = await makeRuntime({
      ttsProvider: "gemini",
      geminiApiKey: "gemini-key"
    }).respond({
      prompt: "Summarize current status.",
      auto: false,
      reason: "manual-request",
      includeAudio: true,
      snapshot: makeSnapshot()
    });

    expect(result.source).toBe("api");
    expect(result.audioBase64).toBe("QUJD");
    expect(result.mimeType).toBe("audio/wav");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls[0]?.url).toBe("https://gen.pollinations.ai/v1/chat/completions");
    expect(calls[1]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent"
    );
  });

  it("falls back to Pollinations speech when Gemini fails in gemini-with-fallback mode", async () => {
    const calls: Array<{ url: unknown; body: Record<string, unknown> | null }> = [];
    const fetchMock = vi.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
      let body: Record<string, unknown> | null = null;
      if (init?.body && typeof init.body === "string") {
        body = JSON.parse(init.body) as Record<string, unknown>;
      }
      calls.push({ url: input, body });

      if (calls.length === 1) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Fallback summary." } }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (calls.length === 2) {
        return new Response("quota exceeded", { status: 429 });
      }

      return new Response(Buffer.from("audio-bytes"), {
        status: 200,
        headers: { "content-type": "audio/mpeg" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await makeRuntime({
      ttsProvider: "gemini-with-fallback",
      geminiApiKey: "gemini-key"
    }).respond({
      prompt: "Summarize current status.",
      auto: false,
      reason: "manual-request",
      includeAudio: true,
      snapshot: makeSnapshot()
    });

    expect(result.source).toBe("api");
    expect(result.audioBase64).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(calls[1]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent"
    );
    expect(calls[2]?.url).toBe("https://gen.pollinations.ai/v1/audio/speech");
  });

  it("degrades gracefully when Gemini-only mode is selected without API key", async () => {
    const calls: Array<{ url: unknown; body: Record<string, unknown> | null }> = [];
    const fetchMock = vi.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
      let body: Record<string, unknown> | null = null;
      if (init?.body && typeof init.body === "string") {
        body = JSON.parse(init.body) as Record<string, unknown>;
      }
      calls.push({ url: input, body });

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Gemini-only summary." } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await makeRuntime({
      ttsProvider: "gemini",
      geminiApiKey: ""
    }).respond({
      prompt: "Summarize current status.",
      auto: false,
      reason: "manual-request",
      includeAudio: true,
      snapshot: makeSnapshot()
    });

    expect(result.source).toBe("api");
    expect(result.audioBase64).toBeNull();
    expect(result.mimeType).toBeNull();
    expect(result.speech.degraded).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0]?.url).toBe("https://gen.pollinations.ai/v1/chat/completions");
  });
});
