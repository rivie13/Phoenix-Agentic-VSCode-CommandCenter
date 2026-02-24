# Jarvis Personality & Identity Refactor

## Overview

The Jarvis voice assistant now has **personality-driven prompts** that adapt to operational context and user identity. This makes Jarvis feel more like a real assistant—witty, British, occasionally annoyed, and genuinely helpful.

## Key Changes

### 1. **Personality Modes**

Jarvis now operates in four personality modes based on operational context:

- **`serene`**: All clear, calm operations. Jarvis is relaxed and cheerful.
- **`attentive`**: Routine activity underway. Professional, measured tone.
- **`alert`**: Multiple issues or stale items. Concerned, direct tone.
- **`escalating`**: Critical situation (high-risk approvals, errors, failures). Serious, commanding tone.

The personality is **automatically determined** from snapshot state:
- How long since last announcement (staleness)
- Number of pending commands
- Error session counts
- Workflow failure counts

### 2. **User Identity Support**

Jarvis now knows your name and pronouns. On first run:

1. If your name isn't found, Jarvis asks: _"Before we begin, what should I call you?"_
2. You respond with your name
3. Identity is persisted to `~/.phoenix-jarvis-identity.json`
4. Supervisor scripts can read the env vars for automation

**Supported pronouns**: `he/him`, `she/her`, `they/them`, `other`

**Fallback behavior**:
- Check environment: `PHOENIX_JARVIS_NAME`, `PHOENIX_JARVIS_PRONOUNS`
- Check disk: `~/.phoenix-jarvis-identity.json`
- Default to "you"/"operator"

### 3. **Response Length Guidance**

Jarvis adapts response length based on context:

- **Auto callouts** (2-3 sentences): Swift, action-focused announcements
- **Manual requests, brief** (2-4 sentences): Quick status checks
- **Manual requests, extended** (5-8 sentences): Detailed breakdown, then _"For the complete picture, check the agent session itself."_

This keeps Jarvis concise but helpful, and always directs you to actual session logs for deep inspection.

### 4. **British Jarvis Accent & Attitude**

The system prompt now includes:

- Sophisticated, British tone (think Tony Stark's butler)
- Witty but professional
- Mild annoyance if things linger
- Genuine interest in project success
- Conversational but focused

**Example responses**:

_Serene mode (auto):_
> "All is serene at the moment, James. Everything's running smoothly. Shall I keep an eye on things, or would you prefer to check the agent sessions yourself?"

_Alert mode (auto):_
> "Several things want attention, I'm afraid. We've got three sessions queued and a workflow failure that needs looking into. Might I suggest we address the failure first?"

_Escalating mode (manual):_
> "Right then, we have a proper situation. High-risk command awaiting approval, two agent errors, and a failed CI run. I suggest approving or rejecting the command immediately, then pivoting to the error sessions."

## Architecture

### New Types

```typescript
export interface JarvisIdentity {
  name: string | null;
  preferredPronouns?: "he/him" | "she/her" | "they/them" | "other";
  isIdentityComplete: boolean;
}

export type JarvisPersonalityMode = "serene" | "attentive" | "alert" | "escalating";
```

### Modified Functions

All prompt builders now accept personality and identity:

```typescript
// System prompt now includes personality and identity context
export function buildJarvisSystemPrompt(
  personality: JarvisPersonalityMode,
  auto: boolean,
  identity?: JarvisIdentity
): string

// User prompt includes personality-specific response length guidance
export function buildJarvisUserPrompt(
  prompt: string,
  snapshot: DashboardSnapshot,
  auto: boolean,
  personality: JarvisPersonalityMode,
  identity?: JarvisIdentity
): string

// Fallback includes personality-aware tones
export function buildFallbackJarvisReply(
  snapshot: DashboardSnapshot,
  prompt: string,
  auto: boolean,
  personality: JarvisPersonalityMode,
  identity?: JarvisIdentity
): string
```

### New Functions

```typescript
// Determine personality from snapshot state and timing
export function determineJarvisPersonality(
  snapshot: DashboardSnapshot,
  lastAnnouncementMs: number,
  nowMs: number
): JarvisPersonalityMode

// Backward-compatible wrappers (deprecated but functional)
export function buildJarvisSystemPromptLegacy(auto: boolean): string
export function buildJarvisUserPromptLegacy(prompt: string, snapshot: DashboardSnapshot, auto: boolean): string
export function buildFallbackJarvisReplyLegacy(snapshot: DashboardSnapshot, prompt: string, auto: boolean): string
```

### Identity Persistence (`jarvisIdentity.ts`)

```typescript
// Read identity from disk or env vars
export function readJarvisIdentityFromDisk(): JarvisIdentity | null

// Write identity to disk and update env vars
export function writeJarvisIdentityToDisk(identity: JarvisIdentity): boolean

// Create incomplete identity for identity-request decision flow
export function createIncompleteIdentity(): JarvisIdentity

// Build PowerShell/shell script for supervisor env setup
export function buildSupervisorEnvScript(identity: JarvisIdentity): string

// Log identity status to console
export function logIdentitySetup(identity: JarvisIdentity): void
```

## Integration Points

### Command Center Handler (`jarvisInteractionHandlers.ts`)

The handler now:

1. Calls `deps.getJarvisIdentity()` to get stored identity
2. Passes identity to `pickAutoJarvisDecision()` to trigger identity-request if missing
3. Computes `personality` via `determineJarvisPersonality()`
4. Passes both `personality` and `identity` to prompt builders

**New dependency**:
```typescript
getJarvisIdentity: () => JarvisIdentity | null
```

### Controller Integration

The `CommandCenterController` must:

1. Implement `getJarvisIdentity()` by reading from `jarvisIdentity.readJarvisIdentityFromDisk()`
2. Handle the `"identity-missing"` decision reason to trigger identity-request UI
3. When user provides name, call `jarvisIdentity.writeJarvisIdentityToDisk()` to persist

### Supervisor Integration

The Workspace Supervisor can:

1. Read `PHOENIX_JARVIS_NAME` and `PHOENIX_JARVIS_PRONOUNS` env vars before spawning agents
2. Use `buildSupervisorEnvScript()` to generate setup commands for CI/CD pipelines
3. Update `.env` or shell profiles to persist user identity across sessions

## Migration

### If You're Using Old Functions

The old function signatures still work but are **deprecated**:

```typescript
// ❌ Old way (auto mode assumed, no personality/identity)
const systemPrompt = buildJarvisSystemPrompt(false);

// ✅ New way (with personality and identity)
const personality = determineJarvisPersonality(snapshot, lastAnnouncementMs, now);
const identity = readJarvisIdentityFromDisk();
const systemPrompt = buildJarvisSystemPrompt(personality, false, identity ?? undefined);
```

The legacy wrappers will call the new functions with `"attentive"` personality and no identity, maintaining backward compatibility.

### Callers Must Update

- **`jarvisInteractionHandlers.ts`**: ✅ Already updated
- Any custom handlers: Update to use new signatures and pass `getJarvisIdentity()` dep

## Configuration

### Environment Variables

Set these to pre-populate Jarvis identity:

```bash
export PHOENIX_JARVIS_NAME="James"
export PHOENIX_JARVIS_PRONOUNS="he/him"
```

For GitHub Actions or CI/CD:

```yaml
env:
  PHOENIX_JARVIS_NAME: "CI Agent"
  PHOENIX_JARVIS_PRONOUNS: "they/them"
```

### Disk Config

Path: `~/.phoenix-jarvis-identity.json`

```json
{
  "name": "James",
  "preferredPronouns": "he/him"
}
```

If the file doesn't exist, Jarvis will create it after you provide your name.

## Examples

### Scenario 1: First Run with Missing Name

1. Command Center starts
2. `pickAutoJarvisDecision()` finds `identity.name === null`
3. Returns decision with reason: `"identity-missing"`
4. Controller receives decision, shows interactive prompt: _"What should I call you?"_
5. User responds: "James"
6. Controller calls `writeJarvisIdentityToDisk({ name: "James", ... })`
7. Jarvis now addresses James in all future interactions

### Scenario 2: Auto Announcement During High-Risk Situation

1. Two high-risk pending commands exist
2. `pickAutoJarvisDecision()` flags high-risk, returns early (identity already known)
3. Handler computes `personality = "escalating"` due to high-risk count
4. System prompt reflects serious, commanding tone
5. Jarvis speaks with urgency: _"James, we have high-risk approvals waiting. I strongly recommend addressing them immediately."_

### Scenario 3: Manual Request with Extended Response

1. User asks Jarvis: _"What's going on with agent X?"_
2. Handler normalizes prompt, determines personality: `"alert"` (some items waiting)
3. System prompt includes response format: _"If James asks for deep detail, respond with 5–8 sentences maximum, then direct to session logs."_
4. Jarvis provides detailed breakdown (6-7 sentences) then closes: _"For the complete session timeline, I'd recommend checking the actual agent session in the dashboard."_

## Testing

### Manual Test Cases

1. **Identity Request**:
   - Delete `~/.phoenix-jarvis-identity.json`
   - Unset `PHOENIX_JARVIS_*` env vars
   - Start Command Center, trigger Jarvis
   - Verify it asks for your name
   - Provide name, verify it's persisted

2. **Personality Mode**:
   - Create a snapshot with `3+ waiting` sessions
   - Verify auto announcement uses "attentive" or "alert" personality
   - Create high-risk pending command
   - Verify auto announcement uses "escalating" personality

3. **Extended Response**:
   - Manually ask Jarvis a detailed question
   - Verify response is 5–8 sentences and ends with redirect to agent sessions
   - Verify response uses your name

4. **Personality Audition Queue**:
  - Run command: `Phoenix Ops: Audition Jarvis Personalities`
  - Enter a short script line Jarvis should read for all modes
  - Verify supervisor calls `/jarvis/respond` four times with explicit `personality` override (`serene`, `attentive`, `alert`, `escalating`)
  - Verify clips are saved to `artifacts/jarvis-auditions/<timestamp>/`
  - Verify host audio playback runs in queue order with spacing between clips

## Backward Compatibility

- ✅ Old function signatures still work (deprecated wrappers)
- ✅ Existing code without identity/personality continues to use "attentive" mode
- ✅ No breaking changes to message payloads or API contracts
- ✅ Supervisor can ignore identity if not yet updated

## Next Steps

1. Update `CommandCenterController` to implement `getJarvisIdentity()` dependency
2. Update `CommandCenterController` to handle `"identity-missing"` decision reason
3. Add VS Code QuickInput or webview modal to ask for name/pronouns when identity is missing
4. (Optional) Update Supervisor to read and use `PHOENIX_JARVIS_*` env vars in agent bootstraps
5. (Optional) Add Marketplace docs showing how to set Jarvis name in settings

