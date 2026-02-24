# Jarvis Voice System: Barks & Technical Responses

This document outlines the "Two-Phase" audio strategy for Jarvis. To ensure low-latency feedback and a high-personality user experience, Jarvis uses a hybrid approach of cached **Barks** (short NPC-like phrases) and **Generated Responses** (LLM-synthesized technical analysis).

## 1. Architecture Overview: The Two-Phase Reactive Logic

To ensure Jarvis feels like a real-time NPC, we use a "Heuristic + Intelligence" hybrid strategy. This separates **Reflexes** (Local) from **Reasoning** (Remote).

### Phase 1: Local Reflex (The "Bark")
- **Trigger:** Local STT (Vosk) detects a keyword (e.g., "status", "stop", "queue") in the **Final Transcript** after the user has finished speaking.
- **Component:** Command Center Extension (`JarvisIntentHeuristic` service).
- **Latency:** ~20ms - 50ms (Triggered immediately upon end-of-utterance).
- **Action:** Plays a random local `.wav` file (Bark) to acknowledge the user immediately while the remote response is being computed. This ensures Jarvis never interrupts you but responds the millisecond you stop.
- **Example:** You say "Jarvis, how is the build looking?" -> [Silence] -> Jarvis says "Certainly, sir. Checking the logs now." (Instant local playback triggered by the final recognized text).

### Phase 2: Remote Reasoning (The "Technical Response")
- **Trigger:** Simultaneous with Phase 1; the Command Center sends the transcript to the Workspace Supervisor (`POST /jarvis/respond`).
- **Component:** Workspace Supervisor (Backend).
- **Latency:** 1.5s - 3s (LLM Generation + TTS Synthesis).
- **Action:** The Supervisor reads the **Live Dashboard Snapshot** and generates a technical, context-aware response which plays after the Bark finishes.
- **Example:** Supervisor returns: "Sir, the build in the Interface repo failed due to a Vitest timeout, but the Backend is stable."

---

## 2. Local Keyword Heuristic (Final Results)

The local STT engine (Vosk) provides a `final` result JSON object when silence is detected. We use a lightweight heuristic to trigger Phase 1 barks to fill the silence while the cloud LLM is thinking.

| Intent Category | Keywords (Final Result) | Command Center Bark (Local) |
| :--- | :--- | :--- |
| **STATUS_CHECK** | `status`, `looking`, `update`, `going` | "Checking the data now, sir." |
| **QUEUE_MGMT** | `queue`, `pending`, `terminals`, `wait` | "Calculating the backlog, sir." |
| **AGENT_STOP** | `stop`, `halt`, `kill`, `abort` | "Stopping the operation at once." |
| **AGENT_START** | `run`, `start`, `dispatch`, `deploy` | "Right away, sir. Initiating now." |
| **GREETING** | `hello`, `hi`, `morning`, `awake` | "Always here, sir. How can I help?" |
| **THANKS** | `thanks`, `thank you`, `good job` | "Always a pleasure, sir." |

---

## 3. Remote Generation (Supervisor Intelligence)

The **Supervisor** is the only component with the full context (Mirror of all repos). When it receives a request from the Command Center, it performs the following:

1.  **Context Injection**: It takes the user's prompt and injects the latest `DashboardSnapshot`.
2.  **Prompt Engineering**: It guides the LLM to explain *why* the snapshot looks the way it does.
3.  **Differentiated response**: If the user asked "How is it looking?", the Supervisor doesn't just say "Good." It says: "Everything is green, sir, except for that high-risk migration you have pending in the Supervisor repo."
4.  **TTS Synthesis**: It converts the technical response back to speech (base64) using the current personality.

---

## 4. File Naming Convention

To support programmatic randomization, audio files in the `media/audio/jarvis/` folder follow this pattern:

`[INTENT]_[PERSONALITY]_[VARIATION_ID].wav`

- **INTENT:** `ack`, `stop`, `busy`, `done`, `fail`, `approval`, `welcome`, `joke`
- **PERSONALITY:** `serene`, `attentive`, `alert`, `escalating`
- **VARIATION_ID:** `01`, `02`, `03`...

---

## 5. Master Generation Blocks (Copy & Paste to TTS)

Each block is optimized for one personality mode. The style instructions are plain text for direct pasting. Phrases are grouped by intent to help you name your `.wav` files correctly according to the `[INTENT]_[PERSONALITY]_[VARIATION_ID].wav` convention.

### Block 1: SERENE MODE (Calm / Unbothered)

Character: Sophisticated British AI assistant. Received Pronunciation. Suave, polite, articulate, uses "sir" naturally. Think J.A.R.V.I.S. or a professional valet.
Style: Speak with a relaxed, melodic cadence. Slightly slower than average. Use a warm, reassuring tone. You are leisurely and unbothered.

Phrases to Generate:

Acknowledgment (ack_serene_XX.wav)
- "Certainly, sir."
- "Indeed, sir."
- "Consider it done."
- "A capital idea."

Status Update (status_serene_XX.wav)
- "Checking the logs now, sir."
- "Scanning the horizon for you."
- "Fetching the latest data, one moment."

Stop/Abort (stop_serene_XX.wav)
- "As you wish, stopping."
- "Ceasing operations."
- "Shutting it down, sir."

Greeting/Welcome (welcome_serene_XX.wav)
- "Always here, sir."
- "Good to see you again."
- "How can I assist you this morning?"

Gratitude (thanks_serene_XX.wav)
- "Always a pleasure, sir."
- "The pleasure is mine."

Busy/Wait (busy_serene_XX.wav)
- "One moment while I consult the records."
- "Patience is a virtue, sir. Calculating..."

Success/Done (done_serene_XX.wav)
- "All clear, sir. Tidy work."
- "The workspace is back in order."


### Block 2: ATTENTIVE MODE (Normal / Focused)

Character: Sophisticated British AI assistant. Received Pronunciation. Suave, polite, articulate, uses "sir" naturally. Think J.A.R.V.I.S. or a professional valet.
Style: Speak with professional focus. Crisp articulation, standard speed. You are alert but calm, like a pilot in routine flight.

Phrases to Generate:

Acknowledgment (ack_attentive_XX.wav)
- "Right away."
- "Acknowledged."
- "Proceeding, sir."
- "I'm on it."

Status Update (status_attentive_XX.wav)
- "Reviewing the board now."
- "Getting the status update."
- "Analyzing the current state."

Stop/Abort (stop_attentive_XX.wav)
- "Stopping now."
- "Termination initiated."
- "Abort confirmed."

Greeting/Welcome (welcome_attentive_XX.wav)
- "Listening, sir."
- "What's the plan for today?"

Gratitude (thanks_attentive_XX.wav)
- "You are most welcome."
- "Glad I could help."

Busy/Wait (busy_attentive_XX.wav)
- "Working on it now."
- "Processing the request."

Success/Done (done_attentive_XX.wav)
- "Operation finished."
- "Results are ready."
- "Done."


### Block 3: ALERT MODE (Tense / Tactical)

Character: Sophisticated British AI assistant. Received Pronunciation. Suave, polite, articulate, uses "sir" naturally. Think J.A.R.V.I.S. or a professional valet.
Style: Speak with heightened focus and a slightly lower pitch. Faster than normal with sharp emphasis. Eliminate any leisurely inflection.

Phrases to Generate:

Acknowledgment (ack_alert_XX.wav)
- "Moving at once."
- "Prioritizing this now."
- "No time to waste, sir."

Status Update (status_alert_XX.wav)
- "Scanning for highlights."
- "Checking what's blocked, sir."

Stop/Abort (stop_alert_XX.wav)
- "Stopping immediately."
- "Emergency stop active."

Greeting/Welcome (welcome_alert_XX.wav)
- "Awaiting your command."
- "System nominal, listening."

Gratitude (thanks_alert_XX.wav)
- "Acknowledged, continuing work."

Busy/Wait (busy_alert_XX.wav)
- "Calculating now, sir. Stand by."
- "Hold on. I'm digging into this."


### Block 4: ESCALATING MODE (Urgent / Critical)

Character: Sophisticated British AI assistant. Received Pronunciation. Suave, polite, articulate, uses "sir" naturally. Think J.A.R.V.I.S. or a professional valet.
Style: Speak with high urgency and intensity. Short breaths, sharp delivery. Tone is serious and strained. Maximum brevity.

Phrases to Generate:

Acknowledgment (ack_escalating_XX.wav)
- "Acting now."
- "Immediate execution."
- "Full power."

Status Update (status_escalating_XX.wav)
- "Data incoming."
- "Pulling high-priority logs."

Stop/Abort (stop_escalating_XX.wav)
- "ABORT CONFIRMED."
- "Force-killing process."

Busy/Wait (busy_escalating_XX.wav)
- "Processing at max speed."


### Block 5: THE SNIPPY BACKLOG (Exasperated Wit)

Character: Sophisticated British AI assistant. Received Pronunciation. Suave, polite, articulate, uses "sir" naturally. Think J.A.R.V.I.S. or a professional valet.
Style: Slightly condescending but polite. British wit with a hint of exasperation. Sharp, crisp delivery.

Phrases to Generate:

Backlog Nagging (ann_attentive_XX.wav)
- "A bit of a crowd forming in the terminal list, isn't there?"
- "Do you plan on answering any of these, sir?"
- "The pending list is looking rather... substantial."
- "I'm beginning to feel like a receptionist, sir."
- "I do hate to nag, but the queue is quite full."
- "Shall we address the backlog today, or is it a decoration?"

---

## 4. Implementation Logic

### Supervisor-Side (Discovery)
The Supervisor should scan the environment and return the `intent` and `personality` in the JSON response of `/jarvis/respond`.

### Command Center-Side (Execution)
1. **Action Captured:** User clicks 'Stop'.
2. **Immediate Local Playback:** `AudioCache.playRandom("stop", currentPersonality)`
3. **Remote Request:** Send `POST /jarvis/respond`.
4. **Deferred Playback:** When the response comes back, if it contains an `audioBase64` payload that is *longer* than the bark, play it after a 500ms cross-fade.

---

## 5. Tips for Google AI Studio TTS
- **Temperature:** Keep it low for Serene (0.2), higher for Alert (0.8) to get more urgent inflections.
- **SSML (if available):** Use `<break time="1s"/>` between variations to make cutting easier.
- **Voice Selection:** Use 'Onyx' or 'Charon' (if using Gemini 2.0) for that deep, sophisticated British tone.

## 6. Batch Generation Script (Gemini 2.5 Flash TTS)

Command Center includes a generator script for all canned bark WAV files from this document:

```powershell
npm run jarvis:generate:barks
```

Output path:

`artifacts/jarvis-canned-barks/<timestamp>/`

The script writes:

- all generated `.wav` files named by convention (`[intent]_[personality]_[variation].wav`)
- `phrases.json` (planned phrase catalog)
- `manifest.json` (generation results, bytes, errors)

Rate-limit-safe defaults are intentionally conservative for Gemini 2.5 Flash TTS:

- RPM: `8` (below `10` limit)
- TPM: `8000` (below `10K` limit)
- RPD: `90` (below `100` limit)

Useful overrides:

```powershell
npm run jarvis:generate:barks -- --rpm 8 --tpm 8000 --rpd 90 --voice Charon
npm run jarvis:generate:barks -- --dry-run
npm run jarvis:generate:barks -- --max-items 10
npm run jarvis:generate:barks -- --organize
npm run jarvis:generate:barks:organized
```

Selective regeneration (for voice consistency passes):

```powershell
# regenerate only specific clips (supports wildcards * and ?)
npm run jarvis:generate:barks -- --run-name redo-attentive --only-file "ann_attentive_03.wav,ann_attentive_04.wav" --no-resume --organize

# regenerate a whole intent/personality slice
npm run jarvis:generate:barks -- --run-name redo-ann --only-intent ann --only-personality attentive --no-resume --organize

# regenerate from a selection file (json/jsonc/text)
npm run jarvis:generate:barks -- --run-name redo-list --selection-file artifacts/jarvis-canned-barks/redo-selection.txt --no-resume --organize
```

Selection file accepted formats:

- text: one filename per line (comments allowed with `#` or `//`)
- JSON array: `["ann_attentive_03.wav", "ack_serene_01.wav"]`
- JSON object with arrays in `files`, `onlyFiles`, `include`, `selection`, or `items`

Default template path (generated from latest full run inventory):

`artifacts/jarvis-canned-barks/redo-selection.txt`

Template behavior:

- missing clips from the last run are preselected (uncommented)
- all other clips are commented with `#`
- to regenerate a clip, remove the leading `# ` and keep one filename per line

API key resolution order:

1. `--api-key`
2. env vars (`PHOENIX_JARVIS_GEMINI_API_KEY`, `SUPERVISOR_JARVIS_GEMINI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`)
3. VS Code settings key `phoenixOps.jarvisGeminiApiKey`

### 6.1 Audition Review Folder Layout

For easier review and keeper selection, generated clips can be organized into mode/intent subfolders (enable with `--organize`):

`artifacts/jarvis-canned-barks/<run-name>/generated/<mode>/<intent>/<intent>_<personality>_<variation>.wav`

### 6.2 Run Status — `full-barks-2026-02-24`

- Status: partial (daily Gemini model request quota exhausted)
- Completed: `60 / 64`
- Missing generations:
	- `ann_attentive_03.wav`
	- `ann_attentive_04.wav`
	- `ann_attentive_05.wav`
	- `ann_attentive_06.wav`

## 7. Live API Migration Notes

For the evaluation and migration recommendation to Gemini native audio sessions, see:

`docs/JARVIS_LIVE_API_EVALUATION.md`
