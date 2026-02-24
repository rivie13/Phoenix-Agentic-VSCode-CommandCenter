# Jarvis TTS Refactor: Complete Plan Summary

Comprehensive plan for refactoring Jarvis audio to use **Gemini 2.5 Flash Preview TTS** (primary) with **Pollinations fallback**, while keeping **Pollinations for chat summaries**.

---

## Executive Summary

### Problem
- Current Pollinations TTS doesn't deliver emotional nuance or consistent voice across personality modes
- Voice cracking at audio start (due to unsupported `instructions` field for `tts-1` model)

### Solution
- **Use Gemini TTS** for emotionally-aware speech synthesis (sounds like one person across all 4 personalities)
- **Keep Pollinations for chat** (generating British-themed summaries)
- **Use Pollinations as fallback** when Gemini quota is exhausted
- **Secure API key management** via VS Code settings (encrypted, not in git)

### Outcome
Jarvis sounds human, emotional, consistently British, and can gracefully fall back if quota is hit.

---

## High-Level Architecture

```
Supervisor → Jarvis Callout
    ↓
Chat: Pollinations generates British summary
    ↓
TTS: Gemini synthesizes with emotion
    ├─ Success? → Play audio
    └─ Failure (quota, error)?
         ↓
         Fallback: Pollinations TTS
         ↓
         Play fallback audio
```

### Key Design Decisions

| Component | Provider | Why |
|-----------|----------|-----|
| **Chat/Summaries** | Pollinations | Fast, reliable, no special handling needed |
| **TTS (Primary)** | Gemini 2.5 Flash | Emotionally-aware, consistent voice across personalities |
| **TTS (Fallback)** | Pollinations | When Gemini quota exhausted (~1000 req/mo) |
| **API Key Storage** | VS Code SecretStorage | Encrypted, per-user, not in git, secure |
| **Setup UX** | Command Palette | `Phoenix: Setup Jarvis TTS` |

---

## Documentation Files

I've created 4 comprehensive documents in `/docs/`:

### 1. **JARVIS_TTS_ARCHITECTURE.md** (Developer Reference)
- Complete system architecture & data flow
- Detailed API integration specs
- Code structure for all providers
- Security model & credential handling
- Testing strategy
- Implementation checklist

**When to use**: When designing code, understanding the big picture, planning implementation phases.

### 2. **JARVIS_SETUP_USER_GUIDE.md** (End User Guide)
- How to get Gemini API key (free tier)
- How to get Pollinations key (optional)
- Step-by-step setup via Command Palette
- Troubleshooting guide
- FAQ
- Cost info (mostly free)

**When to use**: When users ask how to set up, or when they report errors.

### 3. **JARVIS_GEMINI_IMPLEMENTATION.md** (Developer Implementation)
- Step-by-step coding guide
- Each file to create/modify
- Code templates for all providers
- Extension setup & commands
- Integration points
- Testing approaches
- Validation checklist

**When to use**: When actually writing the code to integrate Gemini.

### 4. **JARVIS_PERSONALITY_TO_GEMINI_MAPPING.md** (Concept Reference)
- How chat system prompts map to TTS style instructions
- 4 personality modes with examples
- Testing criteria for each mood
- Implementation patterns

**When to use**: When tuning personality delivery or evaluating audio quality.

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [ ] Create `CredentialManager` for secure key storage
- [ ] Create `JarvisConfigManager` to load settings
- [ ] Define TTS provider interface
- [ ] Update `package.json` with configuration schema

### Phase 2: Providers (Week 1-2)
- [ ] Implement `GeminiTtsProvider`
- [ ] Refactor `PollinationsTtsProvider` into provider interface
- [ ] Implement `GeminiWithFallbackProvider` (orchestration)
- [ ] Unit test each provider

### Phase 3: Integration (Week 2)
- [ ] Update `EmbeddedJarvisPollinationsRuntime` to use provider injection
- [ ] Simplify `synthesizeSpeech()` to delegate to provider
- [ ] Keep `fetchSummaryText()` calling Pollinations for chat
- [ ] Integration test with supervisor

### Phase 4: UX (Week 2-3)
- [ ] Implement `JarvisSetupCommand` with setup workflow
- [ ] Add status bar indicator (Gemini vs Fallback)
- [ ] Debug logging with `ttsDebug` setting
- [ ] Error messages with helpful guidance

### Phase 5: Testing & Polish (Week 3)
- [ ] Comprehensive testing (unit, integration, manual)
- [ ] Verify voice consistency across personalities
- [ ] Fallback behavior under quota exhaustion
- [ ] Performance & latency measurement

### Phase 6: Release (Week 4)
- [ ] Documentation review & updates
- [ ] Beta rollout to internal users
- [ ] Gather feedback on audio quality
- [ ] GA release with user guide

---

## File Structure

```
src/
├── services/
│   ├── CredentialManager.ts                    [NEW]
│   ├── EmbeddedSupervisorManager.ts            [MODIFY - wire TTS provider]
│   └── tts/                                    [NEW FOLDER]
│       ├── JarvisTtsProvider.ts                [NEW - interface]
│       ├── GeminiTtsProvider.ts                [NEW]
│       ├── PollinationsTtsProvider.ts          [NEW - refactored]
│       └── GeminiWithFallbackProvider.ts       [NEW - fallback orchestration]
├── embeddedSupervisor/
│   └── jarvisPollinations.ts                   [MODIFY - inject provider, simplify]
├── commands/
│   └── JarvisSetupCommand.ts                   [NEW - setup workflow]
├── utils/
│   └── jarvisConfig.ts                         [NEW - config loading]
└── extension.ts                                [MODIFY - register commands]

docs/
├── JARVIS_TTS_ARCHITECTURE.md                  [NEW - technical reference]
├── JARVIS_SETUP_USER_GUIDE.md                  [NEW - user guide]
├── JARVIS_GEMINI_IMPLEMENTATION.md             [NEW - coding guide]
├── JARVIS_PERSONALITY_TO_GEMINI_MAPPING.md     [EXISTING - still valid]
└── JARVIS_GEMINI_TTS_TEST_SCENARIOS.md         [EXISTING - still valid]

package.json                                    [MODIFY - add config schema]
```

---

## Configuration Schema

Users will configure via VS Code Settings:

```json
{
  "phoenix.jarvis.ttsProvider": "gemini-with-fallback",  // or "gemini" or "pollinations"
  "phoenix.jarvis.gemini.model": "gemini-2.5-flash-preview-0001",
  "phoenix.jarvis.gemini.voice": "en-GB-Neural2-C",
  "phoenix.jarvis.ttsDebug": false
}
```

API Keys stored securely (via `Phoenix: Setup Jarvis TTS` command):
- `phoenix.jarvis.gemini.apiKey` → SecretStorage (encrypted)
- `phoenix.jarvis.pollinations.apiKey` → SecretStorage (encrypted)

---

## Personality Modes & TTS Delivery

Each personality has a style instruction set that drives Gemini TTS delivery:

| Mode | Chat Intent | TTS Style | Speed | Emotion |
|------|-------------|-----------|-------|---------|
| **Serene** | Warm, cheerful | Relaxed, warm RP | Slow | Contentment |
| **Attentive** | Professional, measured | Sophisticated RP | Normal | Focused |
| **Alert** | Concerned, urgent | Crisp, firm | Faster | Alertness |
| **Escalating** | Serious, commanding | Sharp, commanding | Fast | Urgency |

All delivered with **consistent British voice** (no voice changes between personalities).

---

## API Key Management

### For Users

**Get Gemini Key**:
1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Click "Create API Key"
3. Copy key, paste in `Phoenix: Setup Jarvis TTS`

**Get Pollinations Key** (optional):
1. Go to [Pollinations Auth](https://auth.pollinations.ai/)
2. Sign up, copy token
3. Paste in `Phoenix: Setup Jarvis TTS`

**Cost**: Mostly free (~1000 requests/month covered by free tiers)

### For Developers

Keys are stored in VS Code's **SecretStorage**:
- Encrypted by OS credential manager (Windows Credential Manager, macOS Keychain, Linux Secret Service)
- Never written to disk in plain text
- Never sent outside the extension (only to Gemini & Pollinations APIs)
- Can be cleared/reset via setup command

---

## Quality Assurance

### Before Release

- [ ] Audio quality review (all 4 personalities)
- [ ] Voice consistency check (same person across moods?)
- [ ] Fallback behavior test (simulate Gemini quota)
- [ ] Latency measurement (acceptable for real-time callouts?)
- [ ] Error handling (helpful error messages?)

### Listening Checklist

When you test Gemini audio, listen for:
- ✅ **British accent** clear and consistent
- ✅ **Emotional delivery** matches personality
- ✅ **Voice stability** (not changing between personalities)
- ✅ **No artifacts** (no cracking, distortion, or pauses)
- ✅ **Natural pacing** (speed matches urgency)
- ✅ **Engagement** (sounds like Jarvis cares?)

---

## Fallback Behavior

When Gemini TTS fails (quota, error, timeout):

1. Exception caught in `GeminiWithFallbackProvider.synthesize()`
2. Logs warning if debug enabled
3. Delegates to `PollinationsTtsProvider`
4. Returns response with `fallbackUsed: true`
5. Caller plays audio (same as primary, just different voice)
6. User hears Pollinations voice for that callout only
7. Next callout tries Gemini again

**Result**: No downtime, fallback is seamless, user may notice voice change but audio still plays.

---

## Key Differences from Current Implementation

| Aspect | Before (Pollinations Only) | After (Gemini + Fallback) |
|--------|---------------------------|--------------------------|
| **Chat Provider** | Pollinations | ✅ Pollinations (unchanged) |
| **TTS Provider** | Pollinations | ✅ Gemini (primary) |
| **TTS Fallback** | None | ✅ Pollinations |
| **Voice Consistency** | ❌ Same voice, no emotion | ✅ Same voice, emotional delivery |
| **Audio Artifacts** | ❌ Cracking at start | ✅ Clean audio |
| **API Key Storage** | Secrets in config | ✅ Encrypted SecretStorage |
| **User Configuration** | Manual key in settings | ✅ `Phoenix: Setup Jarvis TTS` command |
| **Cost** | Pollinations quota | ✅ Mostly Gemini free tier (~1000 req/mo) |

---

## Testing Methodology

### Unit Tests
- Mock Gemini/Pollinations APIs
- Test provider error handling
- Test credential storage
- Test config loading

### Integration Tests
- Real supervisor + TTS providers
- Trigger callouts with different personalities
- Verify audio synthesis works end-to-end
- Verify fallback activates when Gemini fails

### Manual Testing
- Run setup command, store keys
- Start supervisor, trigger callouts
- Listen to audio for all 4 personalities
- Simulate Gemini failure (rate limit)
- Verify fallback works

---

## Post-Release Monitoring

### Metrics to Track
- Gemini API latency (how fast does synthesis happen?)
- Fallback frequency (how often does Gemini fail?)
- User satisfaction (is the voice acceptable?)
- Cost (how many free tier requests are used?)

### Common Issues
- Voice changing between personalities (Gemini config issue)
- Fallback triggering frequently (quota too low, or latency issue?)
- Audio quality degradation (Gemini model issue?)

---

## Questions to Resolve Before Coding

1. **Gemini API Endpoint**: Confirm exact TTS endpoint (may not be `/generateContent`)
2. **Gemini Response Format**: Where is audio in response? (`audio.data`? `audioContent`? `inline_data`?)
3. **Gemini Voices**: Which British voices are available? (`en-GB-Neural2-C` correct?)
4. **Gemini Rate Limits**: How many free tier requests per month? (Estimate: 1000)
5. **Latency**: How long does Gemini TTS take for 2-3 sentence callout? (Target: <2 sec)
6. **Error Codes**: What error codes does Gemini return on quota/throttling? (401, 429, others?)

---

## Next Steps

1. **Read the docs**:
   - [JARVIS_TTS_ARCHITECTURE.md](JARVIS_TTS_ARCHITECTURE.md) for technical overview
   - [JARVIS_SETUP_USER_GUIDE.md](JARVIS_SETUP_USER_GUIDE.md) for user perspective
   - [JARVIS_GEMINI_IMPLEMENTATION.md](JARVIS_GEMINI_IMPLEMENTATION.md) for coding details

2. **Resolve open questions** (Gemini API specifics)

3. **Begin Phase 1** (Foundation: credentials, config, interfaces)

4. **Iterate through phases** with testing at each stage

5. **Release** with user documentation and setup ceremony

---

## Success Criteria

✅ Jarvis sounds like **one person** across all 4 personalities
✅ Jarvis delivers **emotional nuance** (serious when escalating, calm when serene)
✅ Audio is **clean** (no cracking, distortion, or artifacts)
✅ **Gemini is primary** TTS provider (free tier is sufficient)
✅ **Fallback works** seamlessly when Gemini quota exhausted
✅ **User setup is easy** (one command, paste two keys)
✅ **Keys are secure** (VS Code encrypted storage)
✅ **Chat summaries** still use Pollinations (no change)
✅ **Documentation is comprehensive** (user guide + dev guide)

---
