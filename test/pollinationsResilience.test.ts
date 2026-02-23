import { describe, expect, it } from "vitest";
import {
  PollinationsCooldownTracker,
  PollinationsError,
  computePollinationsCooldownSeconds,
  parseRetryAfterSeconds
} from "../src/services/PollinationsResilience";

describe("pollinations resilience primitives", () => {
  it("parses Retry-After as seconds and date", () => {
    expect(parseRetryAfterSeconds("90")).toBe(90);
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    expect(parseRetryAfterSeconds("2026-01-01T00:02:00.000Z", base)).toBe(120);
  });

  it("computes hard/soft cooldowns and caps max", () => {
    expect(
      computePollinationsCooldownSeconds({
        kind: "auth",
        retryAfterSeconds: null,
        hardCooldownSeconds: 900,
        softCooldownSeconds: 120
      })
    ).toBe(900);
    expect(
      computePollinationsCooldownSeconds({
        kind: "network",
        retryAfterSeconds: null,
        hardCooldownSeconds: 900,
        softCooldownSeconds: 120
      })
    ).toBe(120);
    expect(
      computePollinationsCooldownSeconds({
        kind: "network",
        retryAfterSeconds: 9999,
        hardCooldownSeconds: 900,
        softCooldownSeconds: 120
      })
    ).toBe(1800);
  });

  it("tracks channel cooldown windows and warning windows", () => {
    const tracker = new PollinationsCooldownTracker();
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const failure = new PollinationsError({
      message: "rate limited",
      kind: "rate_limit",
      channel: "chat",
      endpoint: "https://text.pollinations.ai/openai/v1/chat/completions",
      retryAfterSeconds: 30
    });
    const cooldown = tracker.noteFailure(
      "chat",
      failure,
      { hardCooldownSeconds: 900, softCooldownSeconds: 120 },
      now
    );
    expect(cooldown.cooldownSeconds).toBe(30);
    expect(tracker.isActive("chat", now + 10_000)).toBe(true);
    expect(tracker.snapshot("chat", now + 10_000).failureKind).toBe("rate_limit");
    expect(tracker.shouldWarn("chat", cooldown.untilMs, now + 5_000)).toBe(true);
    tracker.markWarned("chat", cooldown.untilMs);
    expect(tracker.shouldWarn("chat", cooldown.untilMs, now + 6_000)).toBe(false);
    expect(tracker.isActive("chat", now + 31_000)).toBe(false);
  });
});
