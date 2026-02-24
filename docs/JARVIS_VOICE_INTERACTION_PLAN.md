# Jarvis Voice Interaction Plan

## Overview

This document describes the full implementation plan for adding bidirectional voice
interaction between the developer, Jarvis, and VS Code through the Command Center
extension. The goal is hands-free, conversational control of the Phoenix workspace:
you say "Jarvis", Jarvis listens, understands your intent, responds through audio, and
takes action in VS Code on your behalf. This plan also includes optional, toggleable
attention-guidance cues in the UI (highlight/focus), lightweight media intents ("play
my tunes"), and several easy quality-of-life additions.

---

## Questions Answered First

### Why not use Whisper or Pollinations for speech-to-text?

Whisper and the Pollinations audio endpoint are great for Jarvis's **output** (text
→ speech), but for speech **input** (your voice → text), they are the wrong tool:

- Every utterance would require an HTTP round-trip to an external API
- Introduces latency between you speaking and Jarvis responding
- Has a usage cost per transcription request
- Requires an internet connection at the moment you speak
- You cannot speak while offline

For **listening to you**, we want something local, instant, and free per use.

### Why not use a classic / pre-AI speech-to-text engine?

Classic STT engines (CMU Sphinx, Microsoft SAPI, older HMM-based systems) work, but
they have meaningful limitations for this use case:

| Property | Classic HMM-based STT | Modern Neural STT (Vosk) |
|---|---|---|
| Accuracy on conversational commands | ~70-80% | ~92-97% |
| Accuracy on technical terms (agent names, repo names) | Poor — needs vocabulary training | Good — large vocabulary by default |
| Handling of varied speaking pace | Brittle | Robust |
| Accuracy on short, ambiguous commands | Weak context modeling | Better with language model |
| Setup / integration complexity | High (custom grammars often required) | Low (drop-in Node.js package) |
| Offline operation | Yes | Yes |

The accuracy gap matters most here because commands like "pull up that agent session"
or "approve the pending command" need to be understood reliably or Jarvis takes the
wrong action. Classic engines would require you to speak in a rigid grammar. Neural
engines understand natural language the way Jarvis is designed to respond to it.

### What is Vosk?

Vosk is an open-source, offline speech recognition toolkit built on top of Kaldi
acoustic models, packaged for easy use across platforms and languages. Key properties:

- **Fully offline**: all processing runs locally on your machine, zero API calls
- **Free forever**: MIT licensed, no usage fees, no API key required
- **Small footprint**: the English model is ~40-50MB — reasonable to bundle or download
  on first use
- **Fast**: designed for real-time transcription, not batch processing
- **Node.js native binding**: the `vosk` npm package exposes a clean Node.js API
  compatible with VS Code extension host
- **Streaming capable**: can transcribe incrementally as you speak, not just when you
  stop talking
- **Accuracy**: meaningfully better than classic HMM engines; not as accurate as
  Whisper but more than sufficient for voice command recognition

Vosk is the right choice for speech-to-text here: it costs nothing per utterance,
runs locally, integrates directly into the extension host as a Node.js module, and
handles conversational English commands reliably.

---

## Technology Stack Summary

| Layer | Technology | Why |
|---|---|---|
| **Wake word detection** | Picovoice Porcupine (`@picovoice/porcupine-node`) | Has "Jarvis" as a built-in keyword (no training required), extremely low CPU, offline |
| **Microphone capture** | `node-record-lpcm16` | Lightweight PCM recorder, uses SoX on Windows/macOS/Linux |
| **Speech-to-text** | Vosk (`vosk` npm) | Offline, free, neural accuracy, Node.js native, streaming |
| **Intent routing** | Existing Jarvis LLM pipeline | The supervisor `/jarvis/respond` endpoint or direct Pollinations chat already understands natural commands |
| **Audio output** | Existing `JarvisHostAudioPlayer` + Pollinations TTS | Already implemented and tested |
| **VS Code actions** | Standard `vscode.commands.executeCommand()` API | Standard stable VS Code extension API, no proposed APIs needed |

This architecture uses **zero proposed APIs** from VS Code. It uses the standard
`vscode.commands.executeCommand` API to trigger actions, which is fully stable and
already used throughout the extension.

---

## Architecture: Full Voice Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  ALWAYS-ON PASSIVE LISTENING  (started at extension activation)     │
│                                                                     │
│  Porcupine Wake Word Engine                                         │
│  ├─ polls 512-sample PCM frames from microphone                     │
│  ├─ runs keyword model locally (~1% CPU)                            │
│  └─ fires "Jarvis" event when wake word detected                    │
│                                                                     │
│  STATUS BAR: 🎤 (grey/dim = passive, green = listening)             │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ "Jarvis" detected
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ACTIVE LISTENING          (~1-8 seconds max)                       │
│                                                                     │
│  1. Play activation chime (short audio, signals Jarvis is ready)    │
│  2. Start Vosk STT session (streaming)                              │
│  3. Record mic audio until:                                         │
│     - Vosk detects end-of-utterance (silence threshold)             │
│     - OR maximum duration exceeded (8s)                             │
│     - OR user says "cancel" / "never mind"                          │
│  4. Vosk returns final transcript text                              │
│                                                                     │
│  STATUS BAR: 🎤 (green, pulsing)                                    │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ transcript: "what is going on right now"
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  INTENT DISPATCH                                                    │
│                                                                     │
│  Pass transcript to existing Jarvis pipeline:                       │
│  controller.activateJarvis(transcript)                              │
│                                                                     │
│  This triggers the SUPERVISOR MODE branch (see below for            │
│  full mode-specific behavior)                                       │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ Jarvis text response + focusHint
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  RESPONSE + ACTIONS                                                 │
│                                                                     │
│  1. JarvisHostAudioPlayer plays Jarvis's spoken response            │
│  2. If focusHint/attentionCue present → execute VS Code action      │
│     and optionally spotlight related UI elements                     │
│  3. If musicIntent present → open preferred provider (Spotify /      │
│     YouTube) with query/context                                      │
│                                                                     │
│  Resume passive Porcupine listening after playback ends or when user goes manual mode.             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Mode-Specific Behavior

The voice pipeline behaves differently depending on which supervisor mode the
extension is running in. All 3 modes are fully supported.

---

### Mode 1: Local Workspace Supervisor

**Configuration**: `phoenixOps.supervisorBaseUrl=http://127.0.0.1:8787`,
`phoenixOps.useSupervisorStream=true`

The Workspace Supervisor repo (`Phoenix-Agentic-Workspace-Supervisor`) is running
locally. This is the **richest voice mode**.

```
Voice Input
  └─► transcript
        └─► POST /jarvis/respond (Workspace Supervisor)
              ├─ Supervisor handles LLM call (openai/Pollinations)
              ├─ Supervisor handles TTS generation
              ├─ Supervisor returns { text, audioBase64, focusHint }
              └─► Command Center receives JarvisSpeakPayload
                    ├─► JarvisHostAudioPlayer.enqueue() → audio plays
                    └─► focusHint → executeCommand() → VS Code action
```

**Voice commands fully available in Mode 1:**

| You Say | What Happens |
|---|---|
| "What's going on?" | Supervisor generates full snapshot summary |
| "Pull up that agent session" | `openSessionInEditorCommand()` → opens session in editor |
| "Show me the error" | Opens error log / session detail |
| "Approve it" | `jarvisDelegatedApprovalHandler` → approves pending command |
| "Reject that" | Rejects the pending approval |
| "Create an issue for that" | Launches issue creation form in webview |
| "Stop the agent" | Dispatches agent stop via supervisor |
| "Start an agent on [repo]" | Dispatches agent to repo via supervisor |
| "What failed in CI?" | Supervisor fetches workflow run details |
| "Focus me on blockers" | Highlights blocker-related lane/cards in the webview (if enabled) |
| "Play my tunes" / "Play lo-fi on YouTube" | Opens Spotify/YouTube search or deep link via `vscode.env.openExternal` |
| "Never mind" / silence | Cancels to passive listening |

**Jarvis's responses** come from the supervisor which has full access to the workspace
snapshot, all session states, pending approvals, workflow runs, and agent feeds.

---

### Mode 2: Embedded Supervisor (Sidecar)

**Configuration**: `phoenixOps.embeddedSupervisorEnabled=true`,
sidecar runs at `127.0.0.1:8789`

The embedded sidecar is started and managed by the Command Center extension itself.
It provides a subset of supervisor functionality without requiring the full Workspace
Supervisor repo to be running.

```
Voice Input
  └─► transcript
        └─► POST /jarvis/respond (Embedded Sidecar at 127.0.0.1:8789)
              ├─ Sidecar has access to synced snapshot from extension
              ├─ Handles LLM call and TTS for Jarvis response
              ├─ Returns { text, audioBase64, focusHint }
              └─► Same playback path as Mode 1
```

**Voice commands available in Mode 2:**

| Command Type | Availability | Notes |
|---|---|---|
| Status queries | ✅ Full | Snapshot is synced from extension to sidecar |
| Session navigation | ✅ Full | `focusHint` → `openSessionInEditorCommand()` |
| Delegated approvals | ✅ Supported | Sidecar can execute approval against GitHub API |
| Agent dispatch | ⚠️ Partial | Limited to what embedded supervisor exposes |
| Music intents | ✅ Supported | External provider launch is extension-host local |
| Webhook-driven actions | ❌ Not available | No webhook listener in embedded mode |

**Behavior difference from Mode 1:** The embedded sidecar does not have a webhook
listener or SSE stream. Snapshot is periodically synced from the extension. Live
agent feed events may not be reflected in real-time when speaking.

---

### Mode 3: No Supervisor / Fallback Mode

**Configuration**: `phoenixOps.useSupervisorStream=false` or
`phoenixOps.allowDirectGhPollingFallback=true`

No supervisor is running. The extension polls GitHub directly. Voice input is still
fully functional but the Jarvis response pipeline runs entirely client-side in the
extension host (same path as the existing fallback `tickJarvisAuto` logic).

```
Voice Input
  └─► transcript
        └─► jarvisInteractionHandlers (client-side, no supervisor)
              ├─ Builds system + user prompt from current snapshot
              ├─ POST to Pollinations /v1/chat/completions → LLM text
              ├─ POST to Pollinations /v1/audio/speech → audioBase64
              └─► JarvisHostAudioPlayer.enqueue() → audio plays
                    └─► focusHint → executeCommand() → VS Code action
```

> **Note on STT in Mode 3**: Voice input (wake word + Vosk transcription) is
> unchanged. Vosk is offline and does not depend on the supervisor. It is only the
> Jarvis **response** side that degrades to client-side Pollinations calls. The
> user's voice is still transcribed locally for free.

**Voice commands available in Mode 3:**

| Command Type | Availability | Notes |
|---|---|---|
| Status queries | ✅ Full | Uses locally polled snapshot |
| Session navigation | ✅ Full | `focusHint` + `openSessionInEditor` work |
| Music intents | ✅ Supported | Opens browser/app links directly from extension host |
| Delegated approvals | ❌ Not available | Requires supervisor to execute safely |
| Agent dispatch | ❌ Not available | Requires supervisor |
| Webhook actions | ❌ Not available | No supervisor |

**Degraded audio mode**: If internet is unavailable (no Pollinations TTS), Jarvis
falls back to text-only: response is posted to the Command Center webview as a chat
message. Wake word and Vosk STT still work fully offline.

---

## VS Code Actions from Voice

The `focusHint` field returned by Jarvis maps to actual VS Code commands. This
mapping lives in the extension host and uses only stable VS Code extension APIs.

```typescript
// Conceptual mapping — implementation lives in a new voiceCommandRouter.ts
switch (focusHint.type) {
  case "openSession":
    vscode.commands.executeCommand("phoenixOps.openSessionInEditor", focusHint.sessionId);
    break;
  case "openIssue":
    vscode.commands.executeCommand("phoenixOps.openIssueInBrowser", focusHint.issueNumber);
    break;
  case "openRun":
    vscode.commands.executeCommand("phoenixOps.openRunInBrowser", focusHint.runId);
    break;
  case "openFile":
    vscode.workspace.openTextDocument(vscode.Uri.file(focusHint.filePath))
      .then(doc => vscode.window.showTextDocument(doc));
    break;
  case "createIssue":
    vscode.commands.executeCommand("phoenixOps.createIssue");
    break;
  case "highlightLane":
    vscode.commands.executeCommand("phoenixOps.jarvisAttentionCue", {
      lane: focusHint.lane,
      durationMs: focusHint.durationMs ?? 6000,
      reason: focusHint.reason
    });
    break;
  case "highlightCard":
    vscode.commands.executeCommand("phoenixOps.jarvisAttentionCue", {
      cardId: focusHint.cardId,
      durationMs: focusHint.durationMs ?? 6000,
      reason: focusHint.reason
    });
    break;
  case "openMusic": {
    const provider = focusHint.provider ?? "spotify";
    const query = encodeURIComponent(focusHint.query ?? "my mix");
    const url = provider === "youtube"
      ? `https://www.youtube.com/results?search_query=${query}`
      : `https://open.spotify.com/search/${query}`;
    vscode.env.openExternal(vscode.Uri.parse(url));
    break;
  }
}
```

Jarvis's LLM prompt is extended with tool definitions describing the available VS Code
actions, so it can decide which `focusHint` to include in its response naturally.

---

## Attention Guidance UX (Toggleable)

Jarvis can optionally guide user attention by spotlighting relevant UI elements in the
Command Center webview when speaking about important items (failing runs, blocked
issues, pending approvals, active agent incidents).

### Behavior

- Attention cues are **assistive**, not mandatory: they never block interaction.
- Cues are short-lived and auto-clear (default: 6s).
- If `phoenixOps.jarvisAttentionGuidanceEnabled=false`, all cues are ignored and
  Jarvis behavior remains voice/text-only.
- Cues should prefer existing semantic emphasis styles in `media/webview.css` and
  avoid introducing new color tokens.

### Supported Cue Types

| Cue | Example voice intent | UI effect |
|---|---|---|
| `highlightLane` | "Focus me on blockers" | Emphasize lane header + cards in that lane |
| `highlightCard` | "Show me the issue Jarvis is talking about" | Scroll card into view and apply temporary emphasis |
| `focusPanel` | "Take me to pull requests" | Switches tab/panel and highlights key section |
| `showToastHint` | "What should I look at first?" | Brief contextual hint in webview status area |

### Accessibility + User Control

- Respect reduced-motion preferences (no pulse animation when reduced motion is on).
- Provide command palette toggle: `phoenixOps.jarvisToggleAttentionGuidance`.
- Add "Snooze attention guidance" command for temporary suppression (e.g., 30 min).

---

## Music Intents ("Play My Tunes")

Jarvis supports lightweight media launch intents for productivity flow without becoming
a full music player integration.

### Scope

- Supported commands: "play my tunes", "play lo-fi", "play my coding playlist" "Google search".
- Provider routing: Spotify or YouTube based on user setting/default.
- Execution path: extension-host `vscode.env.openExternal(...)` only.
- No OAuth or playback control in MVP (open search/deep link only).
- Can do a google search on the prompt you said, may optionally have jarvis refine what you said to a google search if you want?

### Example Mapping

| Voice input | Route |
|---|---|
| "Play my tunes" | Open default provider home or "my mix" query |
| "Play synthwave on Spotify" | `https://open.spotify.com/search/synthwave` |
| "Play focus music on YouTube" | `https://www.youtube.com/results?search_query=focus%20music` |


---

## Voice Listening State Policy

To avoid accidental triggering and make the system predictable:

| State | Description | Status Bar |
|---|---|---|
| `passive` | Porcupine running, scanning for wake word, Vosk off | 🎤 grey |
| `activating` | Wake word just heard, chime playing | 🎤 yellow |
| `listening` | Vosk active, recording your command | 🎤 green (pulse) |
| `processing` | Transcript received, waiting for Jarvis response | 🎤 blue |
| `speaking` | Jarvis audio playing | 🔊 blue |
| `muted` | Wake word detection disabled by user | 🎤 red/slash |
| `unavailable` | Mic not available / permission denied | 🎤 strikethrough |

Jarvis **does not respond to itself**: while `JarvisHostAudioPlayer` is playing audio,
microphone recording is paused. This prevents Jarvis's own voice from accidentally
re-triggering the wake word.

---

## Silence / Cancel Behavior

While in `listening` state:
- **Silence for 3.5 seconds** → end-of-utterance, process whatever Vosk has
- **"Cancel" / "Never mind" / "Stop"** → recognized by Vosk as a cancel phrase,
  return immediately to `passive` state with no Jarvis call
- **Maximum 8 seconds** → hard cutoff, returns to passive with partial transcript or
  error

---

## New Files To Create

| File | Purpose |
|---|---|
| `src/services/PorcupineWakeWordService.ts` | Manages Porcupine init, mic feed, wake word event emission |
| `src/services/VoskSpeechToTextService.ts` | Manages Vosk model loading, streaming STT sessions |
| `src/services/MicrophoneRecordingService.ts` | Abstracts mic capture via `node-record-lpcm16` |
| `src/services/JarvisVoiceOrchestrator.ts` | State machine: passive → activating → listening → processing → speaking → passive |
| `src/controller/voiceCommandRouter.ts` | Maps Jarvis `focusHint` to `vscode.commands.executeCommand()` calls |
| `src/services/JarvisChimePlayer.ts` | Plays short activation/deactivation chimes via JarvisHostAudioPlayer |
| `src/services/JarvisAttentionGuidanceService.ts` | Handles attention cue lifecycle, command toggles, and suppression windows |
| `media/webview.attention.js` | Applies/clears temporary webview spotlight cues from extension messages |

### Files Modified

| File | Change |
|---|---|
| `src/extension.ts` | Register voice services on activation, hook to `phoenixOps.jarvisActivate` keybinding |
| `src/controller/CommandCenterController.ts` | Wire `JarvisVoiceOrchestrator` start/stop, expose mute toggle command |
| `src/controller/jarvisInteractionHandlers.ts` | Accept transcript from orchestrator, same pipeline as keyboard input |
| `src/controller/CommandCenterPayloads.ts` | Add typed payloads for `attentionCue` / `clearAttentionCue` messages |
| `media/webview.events.js` | Handle attention cue message events |
| `media/webview.js` | Attach attention cue state to render pipeline |
| `media/webview.css` | Reuse existing emphasis tokens for temporary spotlight styles |
| `package.json` | Add attention/music commands and new voice-related setting keys |

---

## New Settings

```json
"phoenixOps.jarvisVoiceEnabled": {
  "type": "boolean",
  "default": false,
  "description": "Enable always-on Jarvis wake word listening. Requires microphone permission."
},
"phoenixOps.jarvisVoiceWakeWord": {
  "type": "string",
  "default": "jarvis",
  "description": "Wake word keyword (must match a Porcupine built-in keyword)."
},
"phoenixOps.jarvisVoiceAutoMuteDuringSpeech": {
  "type": "boolean",
  "default": true,
  "description": "Pause microphone recording while Jarvis audio is playing to prevent self-triggering."
},
"phoenixOps.jarvisVoiceListenTimeoutSeconds": {
  "type": "number",
  "default": 8,
  "description": "Maximum seconds to wait for user speech after wake word before returning to passive."
},
"phoenixOps.jarvisAttentionGuidanceEnabled": {
  "type": "boolean",
  "default": true,
  "description": "Allow Jarvis to temporarily highlight relevant UI regions (lanes/cards/panels) to focus attention."
},
"phoenixOps.jarvisAttentionGuidanceSnoozeMinutes": {
  "type": "number",
  "default": 30,
  "description": "Default snooze length for temporary attention-guidance suppression."
},
"phoenixOps.jarvisMusicProvider": {
  "type": "string",
  "enum": ["spotify", "youtube"],
  "default": "spotify",
  "description": "Default provider used when users ask Jarvis to play music without specifying a platform."
},
"phoenixOps.jarvisAllowExternalMediaLaunch": {
  "type": "boolean",
  "default": true,
  "description": "Allow Jarvis to open external music providers for voice intents like 'play my tunes'."
}
```

---

## Implementation Phases

### Phase 1 — Microphone + Wake Word (No STT yet)

**Goal**: Prove the hardware pipeline works. Porcupine detects "Jarvis" and fires an
event. The activation chime plays. No transcription yet.

- Install and wire `@picovoice/porcupine-node`
- Implement `MicrophoneRecordingService` using `node-record-lpcm16`
- Implement `PorcupineWakeWordService` feeding mic frames to Porcupine
- Implement `JarvisChimePlayer` with a short activation sound
- Wire `phoenixOps.jarvisVoiceEnabled` setting → starts or stops service on change
- Status bar indicator showing passive / activating state
- **Test**: Say "Jarvis" → chime plays, status bar lights up green

### Phase 2 — Speech-to-Text with Vosk

**Goal**: After wake word, Vosk transcribes your speech. Text is logged for debugging.

- Install `vosk` npm package
- Implement `VoskSpeechToTextService`:
  - Download/bundle English small model (~43MB) to `globalStoragePath`
  - Start streaming recognizer session after wake word
  - Emit partial results during speech
  - Emit final result on silence or timeout
- Implement silence detection (rolling RMS energy threshold on PCM frames)
- Add cancel phrase detection ("cancel", "never mind", "stop")
- **Test**: Say "Jarvis, what are the open sessions?" → transcript appears in Output channel

### Phase 3 — Jarvis Response (connect to existing pipeline)

**Goal**: Transcribed text flows into `activateJarvis()`. Jarvis speaks the response.

- Implement `JarvisVoiceOrchestrator` state machine
- Pass transcript to `controller.activateJarvis(transcript)` (existing method,
  unchanged — same path as keyboard input)
- Mute mic during audio playback (integrate with `JarvisHostAudioPlayer` queue events)
- Implement `voiceCommandRouter.ts` to execute VS Code actions from `focusHint`
- Add `openMusic` routing via `vscode.env.openExternal` respecting provider setting
- Add attention cue command wiring (`phoenixOps.jarvisAttentionCue`) with setting gate
- **Test**: Say "Jarvis, what is going on?" → Jarvis speaks a status summary

### Phase 4 — Mode-Specific Polish

**Goal**: Validate behavior across all 3 supervisor modes.

- Test Mode 1 (Local Supervisor): All supervisor-backed voice commands
- Test Mode 2 (Embedded Sidecar): Confirm snapshot sync reflects in voice responses
- Test Mode 3 (No Supervisor): Confirm client-side fallback works, test offline
  degradation (text-only mode when Pollinations TTS unavailable)
- Implement degraded text-only fallback when no audio is possible
- Add `phoenixOps.jarvisMuteVoice` command (toggle mute without disabling service)

### Phase 5 — Jarvis-Initiated Voice Events

**Goal**: Jarvis can speak **unprompted** and you can respond verbally without typing.

This is the scenario: Jarvis announces "There is an issue with the agent session,
sir" and you respond "pull it up for me" — without saying the wake word because
Jarvis just spoke and the conversation is already active.

- After Jarvis plays an **auto-announcement**, hold `listening` state open for 5s
  (a "conversational window")
- If you speak within the window, treat it as a continued conversation
- If no speech within 5s, return to `passive`
- Status bar shows "🎤 responding..." to indicate the window is open
- **Test**: Wait for Jarvis auto-announce → immediately respond "pull it up" without
  saying "Jarvis" first

### Phase 6 — QoL Quick Wins (Low Complexity)

**Goal**: Add high-value polish items with low implementation risk and minimal scope.

- **Repeat last response**: "Jarvis, repeat that" replays the last TTS clip or text. (would have to preserve mp3 which we do not do currently I believe)
- **What did you hear?**: "Jarvis, what did you hear" returns last transcript for confidence checking.
- **Snooze proactive announcements**: "Snooze Jarvis for 30 minutes" temporarily suppresses proactive speech.
- **Attention guidance toggle by voice**: "Disable focus highlights" / "Enable focus highlights".
- **Panel quick-nav aliases**: "Show actions", "Show pull requests", "Show agents" map to existing panel switches.

These additions stay within the existing extension/webview architecture and do not
require external services or major UI redesign.

---

## Dependencies

### Node.js Packages

```json
"@picovoice/porcupine-node": "^3.x",
"node-record-lpcm16": "^1.x",
"vosk": "^0.3.x"
```

### System Prerequisites

| OS | Prerequisite | Notes |
|---|---|---|
| Windows | SoX (`choco install sox`) | Required by `node-record-lpcm16`; document in README |
| macOS | SoX (`brew install sox`) | Same |
| Linux | ALSA (`libasound2-dev`) | Usually already present |
| All | Microphone permission granted to VS Code | macOS: Privacy & Security → Microphone |

### External Service Accounts

| Service | Purpose | Cost |
|---|---|---|
| Picovoice Console | Free access key for Porcupine "Jarvis" keyword | Free tier available |
| Vosk English model | Download ~43MB on first voice enable | Completely free, no account |

---

## Audio Policy Compliance

This plan respects the [`JARVIS_AUDIO_POLICY.md`](./JARVIS_AUDIO_POLICY.md) rules:

- ✅ No `window.speechSynthesis` — all STT runs in extension host via Node.js
- ✅ Wake word detection (Porcupine) runs in extension host, not webview
- ✅ Vosk STT runs in extension host, not webview
- ✅ Mic muting during playback prevents self-triggering
- ✅ Jarvis audio output still uses `JarvisHostAudioPlayer` (unchanged)
- ✅ Webview trace logging for audio events preserved

---

## Privacy and Security Notes

- **All voice processing is local**: Porcupine runs locally. Vosk runs locally. Your
  spoken words never leave your machine during transcription.
- **Only the transcript is sent** to the Jarvis LLM pipeline (same as typing a
  prompt manually). The raw audio is never transmitted.
- **Always-on mic is opt-in**: `jarvisVoiceEnabled` defaults to `false`. The user
  must explicitly enable it.
- **Visual indicator always visible**: Status bar icon shows listening state at all
  times so there is no silent/invisible mic activity.
- **Mute toggle**: `phoenixOps.jarvisMuteVoice` command allows instant disable from
  command palette or keyboard shortcut without opening settings.

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Porcupine native bindings incompatible with VS Code Electron version | Medium | Test early; Porcupine ships Electron prebuilds; fallback: sidecar process |
| Vosk model download slow/fails on first enable | Low | Show progress notification; allow manual model path configuration |
| SoX not installed on user's Windows machine | Medium | Document in README; show error message with install instructions |
| Mic permission denied on macOS | Low | Show clear permission guidance with link to Privacy settings |
| False wake word triggers from ambient audio | Low | Porcupine has very low false positive rate; mute toggle is always available |
| Vosk accuracy insufficient for technical command names | Low | Can supplement with a small custom vocabulary hint in Vosk config |
| Self-trigger from Jarvis speaking | Low | Mic auto-muted during `JarvisHostAudioPlayer` playback |
| Attention cues feel distracting for some users | Medium | Default to subtle emphasis, provide one-command toggle + snooze |
| External media launch opens wrong provider/content | Low | Respect explicit provider in utterance first, then fall back to user default setting |
