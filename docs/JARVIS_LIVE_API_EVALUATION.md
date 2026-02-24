# Jarvis Live API Evaluation (Gemini Native Audio)

## Why this document exists

This captures the current recommendation for moving Jarvis from a canned-bark + batch TTS model toward a Live API architecture.

## Executive summary

- Gemini Live API is a strong fit for Jarvis conversational voice in Command Center.
- It can accept text turns (including dashboard snapshots/summaries) and return native audio.
- It does **not** imply unlimited free usage; limits still apply per project and tier.
- For production safety and lower latency, keep Live sessions server-side in Supervisor or use ephemeral tokens for direct webview usage.

## What we verified

1. **Model and endpoint**
   - Native audio model: `gemini-2.5-flash-native-audio-preview-12-2025`.
   - API surface: Live API over WebSockets (`BidiGenerateContent`).

2. **Session behavior**
   - Audio-only sessions are limited unless you use session management features.
   - Connection resets are expected; session resumption handles continuity.
   - Context window compression can extend effective session lifetime.

3. **Modality constraints**
   - A Live session supports one response modality (`AUDIO` or `TEXT`) at a time.
   - If using `AUDIO`, output transcription can still provide a text transcript stream.

4. **Security model**
   - Browser-direct Live usage should use ephemeral tokens, not long-lived API keys.
   - Ephemeral tokens currently apply to Live API flows.

5. **Quota and billing reality**
   - Free pricing exists for supported tiers, but practical usage remains rate-limited.
   - Limits are per project tier and can change over time.
   - Multiple API keys on the same project do not create unlimited capacity by default.

## Practical implications for Phoenix

### What Live API can replace

- Can replace local bark WAV generation/playback for interactive Jarvis responses.
- Can reduce explicit local "memory" handling for short-lived interactions by using session context.
- Can reduce prompt payload size by sending compact snapshot summaries each turn.

### What it does not remove entirely

- You still need:
  - Session lifecycle handling (disconnect/go-away/resume).
  - Safety guards and approval routing for command execution workflows.
  - A compact state handoff strategy when sessions rotate.

### Recommended key strategy

- **Tier 1 key**: primary for reliability and higher practical throughput.
- **Free-tier key**: controlled fallback path for non-critical interactions and degradation mode.
- Keep key ownership explicit at the Supervisor boundary; do not expose long-lived keys in webview.

## Proposed target architecture

1. **Supervisor-managed Live session (recommended first)**
   - Command Center sends compact snapshot summaries + user prompt to Supervisor.
   - Supervisor maintains Live session(s), handles resumption/compression, returns audio/text payloads.

2. **Optional direct webview Live mode (later)**
   - Only with ephemeral token provisioning endpoint in Supervisor.
   - Webview connects directly to Gemini Live for latency-sensitive paths.

3. **Fallback path**
   - If Live session unavailable/quota-limited, use text-only fallback and optional Pollinations speech.

## Voice consistency guidance

To keep Jarvis voice coherent across responses:

- Fix one `voice_name` (for example `Charon`) for the entire session.
- Keep a stable `systemInstruction` persona block per session.
- Use concise, deterministic snapshot summaries to avoid style drift.
- Avoid overloading turns with conflicting tone directives.
- Periodically refresh with one canonical style reminder message when sessions resume.

## Migration phases

### Phase 0 (investigation + proof)

- Build a small Supervisor Live client spike.
- Validate latency, interruption behavior, and transcript quality.

### Phase 1 (feature-flagged rollout)

- Add `jarvisMode = live | tts` style routing in Supervisor/Command Center.
- Start with internal use and capture telemetry.

### Phase 2 (default to Live)

- Make Live primary, keep TTS fallback.
- Keep bark assets optional/deprecated for emergency local acknowledgement only.

## Open decisions

- Whether Command Center should ever run browser-direct Live sessions, or remain Supervisor-only.
- How aggressively to trim session context versus relying on compression.
- Whether to keep Pollinations fallback for speech or text-only fallback only.
