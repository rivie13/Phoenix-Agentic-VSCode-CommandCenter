# Gemini CLI & Claude Code CLI Integration Plan

**Status**: Planning Phase  
**Scope**: Command Center Extension (primary), Supervisor (secondary coordination)  
**Dependencies**: Existing Codex/Copilot CLI patterns

---

## Executive Summary

This plan outlines how to add **Gemini CLI** (Google's open-source AI agent) and **Claude Code CLI** (Anthropic's official CLI) to the Phoenix Command Center, following the established patterns used for Codex and Copilot CLI integration.

### Goals
- ✅ Mirror Codex/Copilot CLI authentication flow for both new CLIs
- ✅ Support local execution dispatch from Command Center Agent Hub
- ✅ Allow model selection and configuration per CLI
- ✅ Maintain cost-awareness execution policy (CLI first → cloud fallback)
- ✅ Enable supervisor to track and manage concurrent sessions

### Key Difference from TTS Integration
This is **NOT TTS/audio** focused (unlike JARVIS_GEMINI_IMPLEMENTATION.md). This is about adding **Gemini CLI** (code execution agent) and **Claude Code CLI** (code generation/understanding agent) as local execution runtimes—similar to how Codex and Copilot CLI work.

---

## 1. Gemini CLI Deep Dive

### Source
- **Repository**: [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli)
- **Type**: Open-source Python/Node.js agent for terminal-based code tasks
- **Status**: Active, Google-supported AI agent demo

### Authentication
- **Primary Auth**: `gemini auth login` or `gemini login` (OAuth-based, similar to `gh auth`)
- **API Key Alternative**: Environment variable `GEMINI_API_KEY` or config file
- **Scope**: Access to Gemini models (2.5 Flash, 3, 3.1 Pro, etc.)

### Execution Model
- Spawns as local process (like Codex/Copilot)
- Reads workspace context and project files
- Outputs task execution timeline to stdout
- Supports task-oriented workflows with function calling
- Respects rate limits and quota

### Model Configuration
- **Default Models**: `gemini-2-5-flash`, `gemini-3-flash`, `gemini-3-1-pro`
- **Latest**: Gemini 3.1 Pro (multimodal, best reasoning)
- **Cost**: Free tier available via Google AI Studio; enterprise tiers for production

### Configuration Approach
```ts
// Environment variables for Supervisor config
GEMINI_CLI_CMD=gemini              // or "gemini-cli"
GEMINI_DEFAULT_MODEL=gemini-2-5-flash
GEMINI_LAUNCH_TIMEOUT_MS=600000   // 10 minutes
GEMINI_MAX_CONCURRENT=2            // Conservative due to quota
```

---

## 2. Claude Code CLI Deep Dive

### Source
- **Package**: `@anthropic-ai/claude-code` (NPM)
- **Type**: Official CLI by Anthropic for structured code generation/understanding
- **Status**: Production-ready, actively maintained

### Authentication
- **Primary Auth**: `claude-code login` (OAuth-based to Anthropic account)
- **API Key Alternative**: `ANTHROPIC_API_KEY` environment variable
- **Scope**: Claude 4.6 models (Sonnet, Opus, Haiku for different tasks)

### Execution Model
- CLI-based agent with multi-file understanding
- Supports workspace scan and codebase analysis
- Outputs structured changes (diffs, multiple file edits)
- Built-in test generation and validation
- Rate-limited by Anthropic usage tier

### Model Configuration
- **Default Models**: `claude-opus-4.6` (best reasoning), `claude-sonnet-4.6` (balanced)
- **Fast/Cheap**: `claude-haiku-4.6` for simple tasks
- **Cost**: Requires Anthropic API credits; enterprise plans available

### Configuration Approach
```ts
// Environment variables for Supervisor config
CLAUDE_CODE_CLI_CMD=claude-code       // or custom path
CLAUDE_CODE_DEFAULT_MODEL=claude-sonnet-4.6
CLAUDE_CODE_LAUNCH_TIMEOUT_MS=900000  // 15 minutes (more complex tasks)
CLAUDE_CODE_MAX_CONCURRENT=1           // Single concurrent to avoid quota issues
```

---

## 3. Implementation Plan: Phase 1 (Command Center)

### 3.1 Settings Schema Updates

**File**: `package.json` (VS Code extension manifest)

Add new settings for each CLI:

```json
{
  "contributes": {
    "configuration": [
      {
        "title": "Phoenix Ops: CLI Agents",
        "properties": {
          "phoenixOps.geminiCliAuthCommand": {
            "type": "string",
            "default": "auto",
            "description": "Terminal command for 'Phoenix Ops: Sign In to Gemini CLI'. Set to 'auto' to prefer `gemini login` with fallback."
          },
          "phoenixOps.geminiCliPath": {
            "type": "string",
            "default": "gemini",
            "description": "Path to Gemini CLI executable (e.g., 'gemini', '/usr/local/bin/gemini')."
          },
          "phoenixOps.geminiDefaultModel": {
            "type": "array",
            "items": { "type": "string" },
            "default": ["gemini-2-5-flash", "gemini-3-flash"],
            "description": "Fallback Gemini model IDs when model hub is unavailable."
          },
          "phoenixOps.claudeCodeCliAuthCommand": {
            "type": "string",
            "default": "auto",
            "description": "Terminal command for 'Phoenix Ops: Sign In to Claude Code CLI'. Set to 'auto' to prefer `claude-code login` with fallback."
          },
          "phoenixOps.claudeCodeCliPath": {
            "type": "string",
            "default": "claude-code",
            "description": "Path to Claude Code CLI executable (e.g., 'claude-code', 'npx @anthropic-ai/claude-code')."
          },
          "phoenixOps.claudeCodeDefaultModel": {
            "type": "array",
            "items": { "type": "string" },
            "default": ["claude-sonnet-4.6", "claude-opus-4.6"],
            "description": "Fallback Claude Code model IDs when model hub is unavailable."
          }
        }
      }
    ],
    "commands": [
      {
        "command": "phoenixOps.signInGeminiCli",
        "title": "Phoenix Ops: Sign In to Gemini CLI"
      },
      {
        "command": "phoenixOps.signInClaudeCodeCli",
        "title": "Phoenix Ops: Sign In to Claude Code CLI"
      }
    ]
  }
}
```

### 3.2 Auth Handler Extensions

**File**: `src/controller/settingsAuthHandlers.ts`

Add two new auth methods (reuse existing `runAuthCommandFromSetting` function):

```typescript
export async function signInGeminiCliCommand(): Promise<void> {
  await runAuthCommandFromSetting(
    "geminiCliAuthCommand",
    ["gemini login", "gemini auth login"],
    "Gemini CLI"
  );
}

export async function signInClaudeCodeCliCommand(): Promise<void> {
  await runAuthCommandFromSetting(
    "claudeCodeCliAuthCommand",
    ["claude-code login", "npm exec -y @anthropic-ai/claude-code -- login"],
    "Claude Code CLI"
  );
}
```

### 3.3 Command Registration

**File**: `src/extension.ts`

Register new commands in `activate()`:

```typescript
vscode.commands.registerCommand("phoenixOps.signInGeminiCli", async () =>
  controller.signInGeminiCliCommand()
),
vscode.commands.registerCommand("phoenixOps.signInClaudeCodeCli", async () =>
  controller.signInClaudeCodeCliCommand()
),
```

### 3.4 Controller Method Additions

**File**: `src/controller/CommandCenterController.ts`

Add methods to match existing pattern:

```typescript
async signInGeminiCliCommand(): Promise<void> {
  await runAuthCommandFromSetting(
    "geminiCliAuthCommand",
    ["gemini login", "gemini auth login"],
    "Gemini CLI"
  );
}

async signInClaudeCodeCliCommand(): Promise<void> {
  await runAuthCommandFromSetting(
    "claudeCodeCliAuthCommand",
    ["claude-code login", "npm exec -y @anthropic-ai/claude-code -- login"],
    "Claude Code CLI"
  );
}
```

### 3.5 Data Service Configuration

**File**: `src/services/DataService.ts`

Extend `RuntimeSettings` interface and `getSettings()` method:

```typescript
export interface RuntimeSettings {
  // ... existing fields ...
  
  // New CLI configs
  geminiCliPath: string;
  geminiDefaultModel: string | null;
  claudeCodeCliPath: string;
  claudeCodeDefaultModel: string | null;
}

export class DataService {
  getSettings(): RuntimeSettings {
    // ... existing code ...
    
    const geminiCliPath = config.get<string>("geminiCliPath", "gemini").trim() || "gemini";
    const geminiDefaultModel = (explicitStringSetting("geminiDefaultModel") ?? "").trim();
    const claudeCodeCliPath = config.get<string>("claudeCodeCliPath", "claude-code").trim() || "claude-code";
    const claudeCodeDefaultModel = (explicitStringSetting("claudeCodeDefaultModel") ?? "").trim();
    
    return {
      // ... existing ...
      geminiCliPath,
      geminiDefaultModel,
      claudeCodeCliPath,
      claudeCodeDefaultModel,
    };
  }
}
```

### 3.6 Agent Model Catalog Updates

**File**: `src/utils/agentModelCatalog.ts`

Extend service types to include Gemini and Claude Code:

```typescript
export function coerceServiceModelMap(raw: unknown): 
  Partial<Record<"codex" | "copilot" | "gemini" | "claude-code", AgentModelOption[]>> {
  // Reuse pattern from existing codex/copilot handling
  // Add normalization for "gemini" and "claude-code" services
  
  // At minimum, catalog should support:
  // - services.gemini: [ { id, name, group, deprecated } ]
  // - services.claude-code: [ { id, name, group, deprecated } ]
}

export function defaultAgentModelCatalog(
  settings: { 
    codexModelOptions: unknown;
    copilotModelOptions: unknown;
    geminiDefaultModel: unknown;           // NEW
    claudeCodeDefaultModel: unknown;       // NEW
  }
): AgentModelCatalogPayload {
  // Build default gemini & claude-code arrays from settings
  // Merge with codex/copilot defaults
}
```

### 3.7 Webview Runtime State

**File**: `media/webview.events.js` (runtime dispatch config)

Extend state to include new CLI paths and models:

```javascript
state.runtime = {
  // ... existing codex/copilot/workspace fields ...
  
  geminiCliPath: typeof dispatchConfig.geminiCliPath === "string" && dispatchConfig.geminiCliPath.trim()
    ? dispatchConfig.geminiCliPath.trim()
    : "gemini",
  geminiDefaultModel: typeof dispatchConfig.geminiDefaultModel === "string" && dispatchConfig.geminiDefaultModel.trim()
    ? dispatchConfig.geminiDefaultModel.trim()
    : null,
  claudeCodeCliPath: typeof dispatchConfig.claudeCodeCliPath === "string" && dispatchConfig.claudeCodeCliPath.trim()
    ? dispatchConfig.claudeCodeCliPath.trim()
    : "claude-code",
  claudeCodeDefaultModel: typeof dispatchConfig.claudeCodeDefaultModel === "string" && dispatchConfig.claudeCodeDefaultModel.trim()
    ? dispatchConfig.claudeCodeDefaultModel.trim()
    : null,
};
```

### 3.8 Agent Hub UI Updates (Composer Service Selector)

**Files**: Webview UI components (e.g., `media/webview.agent.js`, Vue/React components if applicable)

**Changes**:
1. Extend service selector dropdown to include:
   - "Codex CLI"
   - "Copilot CLI"
   - "Gemini CLI" ← NEW
   - "Claude Code CLI" ← NEW
   - "GitHub Copilot Cloud" (radio button, requires issue number)

2. Conditional UI logic:
   ```
   if service === "gemini":
     - Show Gemini model picker (defaultModel or catalog options)
     - Show workspace/branch selector (required)
   
   if service === "claude-code":
     - Show Claude Code model picker (defaultModel or catalog options)
     - Show workspace selector (required)
     - Optional: "Analyze codebase first" checkbox
   ```

3. Validation:
   - CLI dispatch (codex/copilot/gemini/claude-code) requires non-null workspace
   - Cloud dispatch (copilot) requires issue number

---

## 4. Implementation Plan: Phase 2 (Supervisor)

### 4.1 Environment Variables & Config Loading

**File**: `.env.example` (and `src/config.ts`)

Add config entries:

```bash
# Gemini CLI local execution
GEMINI_CLI_CMD=gemini
GEMINI_DEFAULT_MODEL=gemini-2-5-flash
GEMINI_LAUNCH_TIMEOUT_MS=600000
GEMINI_MAX_CONCURRENT=2

# Claude Code CLI local execution
CLAUDE_CODE_CLI_CMD=claude-code
CLAUDE_CODE_DEFAULT_MODEL=claude-sonnet-4.6
CLAUDE_CODE_LAUNCH_TIMEOUT_MS=900000
CLAUDE_CODE_MAX_CONCURRENT=1
```

Update `config.ts`:

```typescript
export function loadConfig(cwd: string): SupervisorConfig {
  // ... existing code ...
  
  const geminiCliCommand = (process.env.GEMINI_CLI_CMD ?? "gemini").trim() || "gemini";
  const geminiDefaultModel = (process.env.GEMINI_DEFAULT_MODEL ?? "").trim() || null;
  const geminiLaunchTimeoutMs = parseIntRange(process.env.GEMINI_LAUNCH_TIMEOUT_MS, 600_000, 15_000, 3_600_000);
  const geminiMaxConcurrent = parseIntRange(process.env.GEMINI_MAX_CONCURRENT, 2, 1, 8);
  
  const claudeCodeCliCommand = (process.env.CLAUDE_CODE_CLI_CMD ?? "claude-code").trim() || "claude-code";
  const claudeCodeDefaultModel = (process.env.CLAUDE_CODE_DEFAULT_MODEL ?? "").trim() || null;
  const claudeCodeLaunchTimeoutMs = parseIntRange(process.env.CLAUDE_CODE_LAUNCH_TIMEOUT_MS, 900_000, 15_000, 3_600_000);
  const claudeCodeMaxConcurrent = parseIntRange(process.env.CLAUDE_CODE_MAX_CONCURRENT, 1, 1, 4);
  
  return {
    // ... existing fields ...
    geminiCliCommand,
    geminiDefaultModel,
    geminiLaunchTimeoutMs,
    geminiMaxConcurrent,
    claudeCodeCliCommand,
    claudeCodeDefaultModel,
    claudeCodeLaunchTimeoutMs,
    claudeCodeMaxConcurrent,
  };
}
```

### 4.2 Agent Launcher Enhancements

**File**: `src/agentLauncher.ts`

Extend `LaunchRuntime` and `resolveRuntime()`:

```typescript
private resolveRuntime(service: string | null): LaunchRuntime {
  const normalized = (service ?? "").trim().toLowerCase();
  
  // Existing logic for "codex" and "copilot"...
  
  if (normalized === "gemini") {
    return {
      service: "gemini",
      label: "Gemini CLI",
      command: this.config.geminiCliCommand,
      defaultModel: this.config.geminiDefaultModel,
      timeoutMs: this.config.geminiLaunchTimeoutMs
    };
  }
  
  if (normalized === "claude-code" || normalized === "claude") {
    return {
      service: "claude-code",
      label: "Claude Code CLI",
      command: this.config.claudeCodeCliCommand,
      defaultModel: this.config.claudeCodeDefaultModel,
      timeoutMs: this.config.claudeCodeLaunchTimeoutMs
    };
  }
  
  throw new AgentLaunchError(400, `Unsupported local/cli service '${service ?? "unknown"}'.`);
}
```

Update concurrent session tracking:

```typescript
activeCount(): number {
  // Current implementation likely sums all active sessions.
  // Keep as-is or add service-specific tracking if needed.
}

canLaunch(service: string | null): boolean {
  const runtime = this.resolveRuntime(service);
  const active = this.activeSessions.filter(s => s.service === runtime.service).length;
  const maxAllowed = 
    runtime.service === "gemini" ? this.config.geminiMaxConcurrent :
    runtime.service === "claude-code" ? this.config.claudeCodeMaxConcurrent :
    runtime.service === "copilot" ? this.config.copilotMaxConcurrent :
    this.config.codexMaxConcurrent;
  return active < maxAllowed;
}
```

### 4.3 Dispatch Route Logic

**File**: `src/server.ts`

Update agent dispatch route to handle new services:

```typescript
app.post("/api/agents/dispatch", requireSupervisorAuth, async (req, res) => {
  // ... existing validation ...
  
  const { transport, service, workspace, issueNumber, ... } = req.body;
  // Existing stores dispatch (agent session creation)...
  
  // Route to appropriate launcher
  if ((transport === "cli" || transport === "local") && ["codex", "copilot", "gemini", "claude-code"].includes(service)) {
    setImmediate(() => {
      agentLauncher.launch({ ... }).catch(err => logError(`launcher: ${err.message}`));
    });
  } else if (transport === "cloud" && service === "copilot") {
    setImmediate(() => {
      copilotCloudDispatcher.assignToIssue({ ... }).catch(err => logError(`copilot: ${err.message}`));
    });
  } else {
    res.status(400).json({ error: "Unsupported transport/service combination" });
    return;
  }
  
  res.status(202).json({ accepted: true, sessionId, ... });
});
```

### 4.4 Status Endpoint

**File**: `src/server.ts` (/api/status route)

Include new CLI config in response:

```typescript
app.get("/api/status", requireSupervisorAuth, (req, res) => {
  res.json({
    // ... existing fields ...
    codexCliCommand: config.codexCliCommand,
    copilotCliCommand: config.copilotCliCommand,
    geminiCliCommand: config.geminiCliCommand,           // NEW
    claudeCodeCliCommand: config.claudeCodeCliCommand,   // NEW
    codexDefaultModel: config.codexDefaultModel,
    copilotDefaultModel: config.copilotDefaultModel,
    geminiDefaultModel: config.geminiDefaultModel,       // NEW
    claudeCodeDefaultModel: config.claudeCodeDefaultModel, // NEW
    launcherRunningSessions: agentLauncher?.activeCount() ?? 0,
  });
});
```

---

## 5. Testing & Validation Checklist

### Unit Tests (Vitest)

- [ ] `settingsAuthHandlers.test.ts`: New `runAuthCommandFromSetting` calls for Gemini/Claude Code
- [ ] `agentLauncher.test.ts`: `resolveRuntime()` returns correct config for gemini/claude-code
- [ ] `agentLauncher.test.ts`: Concurrent session limits enforced per service
- [ ] `CommandCenterController.test.ts`: Auth commands trigger correct terminal invocations
- [ ] `agentModelCatalog.test.ts`: New service types coerced and defaulted correctly

### Integration Tests

- [ ] Command Center webview dispatches `service=gemini` and receives session ID
- [ ] Command Center webview dispatches `service=claude-code` and receives session ID
- [ ] Supervisor receives dispatch, launches process, returns 202
- [ ] Feed entries appear as process writes to stdout
- [ ] Session transitions to `offline` when process exits gracefully
- [ ] Session transitions to `error` when process exits non-zero

### Manual Testing (Local Environment)

- [ ] `npm run verify` passes (lint, compile, type-check)
- [ ] Extension loads without errors
- [ ] Settings UI displays new Gemini/Claude Code auth commands
- [ ] "Sign In to Gemini CLI" and "Sign In to Claude Code CLI" commands work
- [ ] Model picker shows Gemini/Claude Code models when configured
- [ ] Supervisor healthcheck returns config with new CLI paths
- [ ] Agent Hub composer allows service selection including new CLIs
- [ ] Dispatch of Gemini CLI task spawns `gemini` process in workspace
- [ ] Dispatch of Claude Code CLI task spawns `claude-code` process in workspace
- [ ] Feed events stream correctly for both new CLIs

---

## 6. Dependency & Installation Considerations

### Command Center (VS Code Extension)
- **No new dependencies** — uses existing `spawnSync`, vscode APIs
- Assumes Gemini CLI and Claude Code CLI are installed globally or on PATH
- Installation by user:
  ```bash
  npm install -g google-gemini/gemini-cli
  npm install -g @anthropic-ai/claude-code
  ```

### Supervisor (Node.js)
- **No new dependencies** — uses existing `child_process.spawn`
- Assumes same CLI tools on PATH or configured via env vars
- Could optionally add `cross-spawn` for Windows compatibility if needed

### Documentation Updates
- Update README.md with new settings
- Add troubleshooting section for Gemini CLI and Claude Code CLI authentication
- Document model selection and concurrency limits

---

## 7. UX/Messaging Considerations

### Welcome/First-Run Flow
When user opens Command Center for the first time:
1. GitHub OAuth sign-in (existing)
2. Prompt to sign in to available CLI agents:
   - Codex CLI (default suggested)
   - Copilot CLI
   - **Gemini CLI** (with link to https://ai.google.dev/gemini-api)
   - **Claude Code CLI** (with link to https://console.anthropic.com)

### Agent Hub Service Selector
- Show radiobutton/dropdown for **Execution Mode**:
  ```
  ○ Local CLI Agent
    └─ [ Codex CLI v ▼ ] | [ Copilot CLI v ▼ ] | [ Gemini CLI v ▼ ] | [ Claude Code CLI v ▼ ]
  ○ Cloud (GitHub Copilot)
    └─ Issue Number: [ ____ ]
  ```
- Helpful tooltips:
  - Gemini: "Access Google's latest Gemini 3.1 Pro for reasoning-heavy tasks"
  - Claude Code: "Anthropic's Claude for fine-grained code understanding and generation"

### Error Messages
- "Gemini CLI not found. Install with: `npm install -g google-gemini/gemini-cli`"
- "Claude Code CLI not authenticated. Run 'Phoenix Ops: Sign In to Claude Code CLI'"
- "Gemini CLI quota exceeded. Falling back to Copilot CLI." (if fallback enabled)

---

## 8. Cost & Quota Management

### Gemini CLI
- **Free Tier**: 15 requests/min via Gemini API
- **Recommendation**: Set `GEMINI_MAX_CONCURRENT=2` to avoid hitting limits
- **Fallback**: If quota exhausted, supervisor can retry with Copilot CLI or Claude Code CLI

### Claude Code CLI
- **Anthropic API Credits**: Required (free tier available)
- **Recommendation**: Set `CLAUDE_CODE_MAX_CONCURRENT=1` (more intensive tasks)
- **Model Cost**: Sonnet < Opus; Haiku for cheap proto tasks

### Execution Policy Ordering (Updated)
Dispatcher should respect this priority when available:
1. **Codex CLI** (if authenticated and quota available)
2. **Copilot CLI** (fallback if Codex unavailable)
3. **Gemini CLI** (optional alternative if configured)
4. **Claude Code CLI** (optional alternative if configured)
5. **Cloud Run** (Copilot Cloud) — explicitly selected by user

---

## 9. Cross-Repo Coordination

### Supervisor → Launcher
- Supervisor's `AgentLauncher` spawns processes for all 4 CLI types
- Each respects its own concurrency limit
- Feed events map to agent session timeline

### Command Center → Supervisor
- Requests dispatch with `service: "gemini"` or `service: "claude-code"`
- Supervisor routes to launcher based on service type
- Returns session ID immediately (202 Accepted)

### Backend (if applicable)
- No direct involvement needed for local CLI dispatch
- If contract-based dispatch is added, would need to support new service types in API contracts

---

## 10. Documentation Deliverables

1. **GEMINI_CLI_QUICKSTART.md** (new)
   - How to install `google-gemini/gemini-cli`
   - How to authenticate with Google account
   - Example tasks and usage patterns
   - Quota and rate limit info

2. **CLAUDE_CODE_CLI_QUICKSTART.md** (new)
   - How to install `@anthropic-ai/claude-code`
   - How to authenticate with Anthropic account
   - Supported model options and performance tiers
   - Cost and usage tracking

3. **CLI_AGENTS_ARCHITECTURE.md** (new)
   - Overview of all 4 CLI agents (Codex, Copilot, Gemini, Claude Code)
   - Selection criteria and use cases
   - Concurrency and cost management
   - Fallback strategies

4. **Update README.md**
   - Add new settings sections
   - Add troubleshooting for Gemini and Claude Code CLIs
   - Update feature matrix

---

## 11. Rollout & Backward Compatibility

### No Breaking Changes
- All new settings have defaults
- Existing Codex/Copilot flows unchanged
- New CLI support is **opt-in** — each requires explicit auth/setup

### Phased Rollout
- **Phase 1** (this plan): Add infrastructure (settings, auth handlers, launcher support)
- **Phase 2** (future): Integrate with model hub for live model discovery
- **Phase 3** (future): Add Gemini/Claude Code to execution policy (auto-fallback)

---

## 12. Known Gaps & Future Improvements

- [ ] **Model Hub Integration**: Fetch live Gemini & Claude Code model catalogs
- [ ] **Fallback Chain**: Implement automatic fallback across all 4 CLIs based on availability
- [ ] **GPU/Resource Awareness**: Detect if Claude Code CLI requires specific hardware
- [ ] **Codebase Indexing**: Pre-scan workspace for Claude Code CLI optimization
- [ ] **Cost Tracking**: Integrate billing alerts for Anthropic/Google quotas
- [ ] **CLI Version Management**: Auto-detect and warn on outdated CLI versions
- [ ] **Prompt Injection Safety**: Sandbox CLI execution to prevent attacks

---

## Appendix A: File Checklist

### Command Center Changes
- [ ] `package.json` — Settings schema (gemini/claude-code)
- [ ] `src/controller/settingsAuthHandlers.ts` — Auth functions
- [ ] `src/controller/CommandCenterController.ts` — Controller methods
- [ ] `src/extension.ts` — Command registration
- [ ] `src/services/DataService.ts` — Runtime settings
- [ ] `src/utils/agentModelCatalog.ts` — Service type extensions
- [ ] `media/webview.events.js` — Runtime state
- [ ] `media/webview.agent.js` or UI components — Service selector UI
- [ ] `.vscode/tasks.json` — Add sign-in tasks (optional)

### Supervisor Changes
- [ ] `.env.example` — New env vars
- [ ] `src/config.ts` — Config parsing
- [ ] `src/types.ts` — Update `SupervisorConfig` interface
- [ ] `src/agentLauncher.ts` — `resolveRuntime()` and `canLaunch()` logic
- [ ] `src/server.ts` — Dispatch route and status endpoint

### Tests
- [ ] `test/agentLauncher.test.ts` — New service resolution tests
- [ ] `src/controller/settingsAuthHandlers.test.ts` — Auth handler tests
- [ ] `src/utils/agentModelCatalog.test.ts` — Schema coercion tests

### Documentation
- [ ] `docs/GEMINI_CLI_QUICKSTART.md` (new)
- [ ] `docs/CLAUDE_CODE_CLI_QUICKSTART.md` (new)
- [ ] `docs/CLI_AGENTS_ARCHITECTURE.md` (new)
- [ ] `README.md` — Update settings section

---

## Appendix B: Reference Implementation Patterns

### Existing Pattern: Codex/Copilot CLI
```
User Action: "Sign In to Codex CLI"
  ↓
Command triggered: `phoenixOps.signInCodexCli`
  ↓
Controller: `signInCodexCliCommand()`
  ↓
Auth Handler: `runAuthCommandFromSetting("codexCliAuthCommand", ["codex login"], "Codex CLI")`
  ↓
Terminal: Spawned saying "codex login" ← User completes auth interactively
  ↓
Config: Setting persisted
  ↓
Supervisor: Reads `CODEX_CLI_CMD` env var, spawns process on dispatch
  ↓
Agent Hub: Shows feed from stdout
```

### New Pattern: Gemini/Claude Code CLI (Same Flow!)
```
User Action: "Sign In to Gemini CLI"
  ↓
Command triggered: `phoenixOps.signInGeminiCli`
  ↓
Controller: `signInGeminiCliCommand()`
  ↓
Auth Handler: `runAuthCommandFromSetting("geminiCliAuthCommand", ["gemini login"], "Gemini CLI")`
  ↓
Terminal: Spawned saying "gemini login" ← User completes auth interactively
  ↓
Config: Setting persisted
  ↓
Supervisor: Reads `GEMINI_CLI_CMD` env var, spawns process on dispatch
  ↓
Agent Hub: Shows feed from stdout
```

---

## Summary

This plan leverages the **proven Codex/Copilot CLI architecture** to add two more local execution times. The implementation is straightforward because the infrastructure is already in place. The main work is:

1. ✅ Extend settings schema (2–3 settings per CLI)
2. ✅ Duplicate auth handlers (3–4 lines per CLI)
3. ✅ Update launcher logic (`resolveRuntime()` cases)
4. ✅ Extend webview UI (service dropdown options)
5. ✅ Update documentation

**Estimated effort**: 2–3 days implementation + 1 day testing = 3–4 days total.

