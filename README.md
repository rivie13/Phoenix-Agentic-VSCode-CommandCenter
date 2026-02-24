# Phoenix VS Code Command Center

Local-first VS Code extension for GitHub Projects + Actions visibility, supervisor-driven agent operations, and Jarvis voice callouts.

## Branding

- Activity Bar / extension icon: `media/phoenix-app-icon-mono.svg` and `media/phoenix-app-icon-mono.png`
- Project logo: `docs/assets/phoenix-logo.svg` and `docs/assets/phoenix-logo.png`

![Phoenix App Icon](media/phoenix-app-icon-mono.png)

![Phoenix Logo](docs/assets/phoenix-logo.png)

## Features

- Unified in-editor dashboard (Activity Bar -> **Phoenix Ops**)
- Board lanes for project statuses (`Backlog` -> `Done`)
- Pull request lanes (`Review Required`, `Changes Requested`, `Approved/Ready`)
- Actions triage buckets (`Queued`, `In Progress`, `Needs Attention`)
- Right-side **Agent Workspace** panel for focused agent operations
- Agent sessions panel (CLI/local/cloud heartbeat + status)
- Interactive per-session PTY terminal panel powered by xterm.js
- Session pin/unpin and archive/restore for focused tracking
- Stop running sessions directly from the agent chat/composer controls
- Open agent sessions as editor tabs for parallel monitoring
- Agent feed stream (recent event log, session-aware when selected)
- Agent control panel for steering messages, dispatch requests, and dangerous command approvals
- QA handoff approval flow (queue in supervisor, approve before PR promotion)
- Inline issue + PR creation flows in the dashboard with structured metadata support
- Context-aware chat composer (active file, selection, and workspace file attachments)
- Structured composer metadata (service/mode/model + MCP tool selections)
- Detail panel with issue/run/session metadata and links
- Disk-backed local cache to reduce GitHub API usage
- Safe writes with confirmations:
  - create issue
  - create pull request
  - merge pull request
  - comment on pull request
  - update project fields (`Status`, `Work mode`, `Priority`, `Size`, `Area`)
  - add/remove labels
- Realtime stream via supervisor SSE (`/events`) with automatic fallback behavior
- Jarvis voice supervisor with manual trigger, auto callouts, and optional wake-word listening

## Architecture Modes

- `Supervisor-first` (recommended): extension reads from configured supervisor snapshot + SSE stream.
- `Embedded sidecar` (optional): bundled local supervisor (`127.0.0.1:8789`) handles local agent-control UX and receives synced snapshots.
- `Direct gh fallback`: optional mode when supervisor is unavailable.

See:

- `docs/ARCHITECTURE.md`
- `docs/JARVIS_AUDIO_POLICY.md`
- `docs/JARVIS_LIVE_API_EVALUATION.md`
- `docs/DEPLOYMENT_MODES.md`
- `docs/WEBHOOK_SETUP.md`
- `docs/MARKETPLACE_ROADMAP.md`

## Quick Start

```powershell
npm install
npm run compile
```

Then open this repo in VS Code and press `F5` to launch an Extension Development Host.

## VS Code Tasks (No Terminal Needed)

Use `Run Task` in VS Code and pick:

- `Command Center: Install`
- `Command Center: Compile`
- `Command Center: Watch`
- `Command Center: Lint`
- `Command Center: Test`
- `Command Center: Verify`
- `Command Center: GitHub OAuth Sign-In`
- `Command Center: GitHub Auth Status`
- `Command Center: Codex CLI Sign-In`
- `Command Center: Copilot CLI Sign-In`
- `Command Center: Package VSIX`
- `Command Center: Install VSIX`

For debugging, use launch config:

- `Run Command Center Extension`

## Initial Configuration

After install, set these values for your environment:

- `phoenixOps.projectOwner` -> your GitHub user or org login
- `phoenixOps.projectNumber` -> your GitHub Project (v2) number
- `phoenixOps.repositories` -> explicit `owner/repo` list, or leave empty for auto-discovery
- `phoenixOps.repositoryDiscoveryMode` -> `workspaceGitRemotes` for generic multi-repo workspaces

## Settings

- `phoenixOps.projectOwner` (default is a bootstrap placeholder; set your GitHub user/org)
- `phoenixOps.projectNumber` (default `3`; change for your environment)
- `phoenixOps.supervisorBaseUrl` (default `http://127.0.0.1:8787`)
- `phoenixOps.supervisorAuthToken` (default empty)
- `phoenixOps.workspaceSupervisorAutoStart` (default `true`; auto-start local Workspace Supervisor repo server for `supervisorBaseUrl`)
- `phoenixOps.workspaceSupervisorRepoPath` (optional path to `Phoenix-Agentic-Workspace-Supervisor`; auto-discovered when empty)
- `phoenixOps.workspaceSupervisorStartTimeoutMs` (default `45000`)
- `phoenixOps.workspaceSupervisorRunBootstrapOnAutoStart` (default `true`; extension-started supervisor also runs tunnel/webhook bootstrap)
- `phoenixOps.embeddedSupervisorEnabled` (default `false`; optional bundled local supervisor sidecar)
- `phoenixOps.embeddedSupervisorHost` (default `127.0.0.1`)
- `phoenixOps.embeddedSupervisorPort` (default `8789`)
- `phoenixOps.embeddedSupervisorApiToken` (optional local token)
- `phoenixOps.useSupervisorStream` (default `true`)
- `phoenixOps.allowDirectGhPollingFallback` (default `false`)
- `phoenixOps.openAgentWorkspaceOnStartup` (default `true`; reveal the right-side Agent panel on activation)
- `phoenixOps.refreshSeconds` (default `30`)
- `phoenixOps.boardCacheSeconds` (default `120`)
- `phoenixOps.actionsCacheSeconds` (default `120`)
- `phoenixOps.pullRequestCacheSeconds` (default `120`)
- `phoenixOps.rateLimitCooldownSeconds` (default `300`)
- `phoenixOps.repositories` (optional explicit `owner/repo` list)
- `phoenixOps.repositoryDiscoveryMode` (`phoenixWorkspace` or `workspaceGitRemotes`)
- `phoenixOps.codexCliAuthCommand` (terminal command used for Codex CLI auth)
- `phoenixOps.copilotCliAuthCommand` (terminal command used for Copilot CLI auth)
- `phoenixOps.codexCliPath` (Codex CLI command/path surfaced for supervisor runtime alignment)
- `phoenixOps.copilotCliPath` (Copilot CLI command/path surfaced for supervisor runtime alignment)
- `phoenixOps.cliBootstrapOnStartup` (default `true`; auto bootstrap CLI runtime at extension startup)
- `phoenixOps.cliStartupSpawnPtyTerminals` (default `true`; spawn startup PTY terminal sessions for available CLIs)
- `phoenixOps.cliStartupAutoInstallMissing` (default `true`; attempt CLI install when unavailable)
- `phoenixOps.cliStartupAutoSignIn` (default `true`; trigger sign-in when CLI auth is missing)
- `phoenixOps.codexCliInstallCommand` (startup install command for Codex CLI)
- `phoenixOps.copilotCliInstallCommand` (startup install command for Copilot CLI)
- `phoenixOps.codexDefaultModel` (optional default Codex model for dispatch)
- `phoenixOps.copilotDefaultModel` (optional default Copilot model for dispatch)
- `phoenixOps.copilotCloudEnabled` (enable/disable Copilot cloud issue dispatch warnings + validation)
- `phoenixOps.codexModelOptions` (fallback Codex model IDs for composer model picker)
- `phoenixOps.copilotModelOptions` (fallback Copilot model IDs for composer model picker)
- `phoenixOps.agentModelCatalogUrl` (optional hub endpoint for live Codex/Copilot model catalogs)
- `phoenixOps.agentModelCatalogAuthToken` (optional bearer token for `agentModelCatalogUrl`)
- `phoenixOps.mcpToolOptions` (MCP tool IDs shown in composer selector)
- `phoenixOps.jarvisEnabled` (enable/disable Jarvis features)
- `phoenixOps.jarvisAutoAnnouncements` (automatic supervisor-style callouts)
- `phoenixOps.jarvisStartupGreetingOnStartup` (default `true`; speak Jarvis greeting at activation)
- `phoenixOps.jarvisApiBaseUrl` (optional Pollinations OpenAI-compatible base URL; leave empty for automatic selection)
- `phoenixOps.jarvisApiKey` (Pollinations API key)
- `phoenixOps.jarvisTextModel` (optional model for Jarvis text replies; leave empty for automatic selection)
- `phoenixOps.jarvisSpeechModel` (optional OpenAI speech model for synthesis; leave empty for automatic selection)
- `phoenixOps.jarvisVoice` (voice id, default `onyx`) **USE ONYX INSTEAD OF ALLOY, WHICH I DO NOT LIKE, ALLOY IS DEFAULT**
- `phoenixOps.jarvisTtsProvider` (`gemini-with-fallback` default, or `gemini`, or `pollinations`)
- `phoenixOps.jarvisGeminiApiKey` (Google Gemini API key used for Jarvis TTS)
- `phoenixOps.jarvisGeminiModel` (Gemini TTS model, default `gemini-2.5-flash-preview-tts`)
- `phoenixOps.jarvisGeminiVoice` (Gemini voice name, default `Charon`)
- `phoenixOps.jarvisTtsDebug` (logs Gemini/fallback provider decisions)
- `phoenixOps.jarvisMaxAnnouncementsPerHour` (default `12`)
- `phoenixOps.jarvisMinSecondsBetweenAnnouncements` (default `180`)
- `phoenixOps.jarvisReasonCooldownMinutes` (default `20`)
- `phoenixOps.jarvisPollinationsHardCooldownSeconds` (default `900`; auth/quota/rate-limit/invalid-request cooldown)
- `phoenixOps.jarvisPollinationsSoftCooldownSeconds` (default `120`; timeout/network/server/unknown cooldown)
- `phoenixOps.jarvisOfferJokes` (allow occasional "want a joke?" callouts)
- `phoenixOps.jarvisConversationHistoryTurns` (default `8`)

When `phoenixOps.repositories` is empty:

- `workspaceGitRemotes` discovers repos from each workspace folder `origin` remote (recommended for most users)
- `phoenixWorkspace` preserves the legacy profile behavior used by existing setups

## Pollinations Credits + Tier Support

- Jarvis text/voice features in Phoenix Command Center are powered by Pollinations. Credit: `https://pollinations.ai/`
- `Phoenix Ops: Pollinations Sign Up / Sign In` opens `https://auth.pollinations.ai/`.
- For Pollinations tier/pollen support for your published VS Code app, submit:
  `https://github.com/pollinations/pollinations/issues/new?template=tier-app-submission.yml`
- Save your API key with `Phoenix Ops: Set Pollinations API Key` (stored in `phoenixOps.jarvisApiKey`).

## Commands

- `Phoenix Ops: Refresh`
- `Phoenix Ops: Sign In to GitHub`
- `Phoenix Ops: Sign In to Codex CLI`
- `Phoenix Ops: Sign In to Copilot CLI`
- `Phoenix Ops: Gemini API Key Portal`
- `Phoenix Ops: Set Gemini API Key`
- `Phoenix Ops: Pollinations Sign Up / Sign In`
- `Phoenix Ops: Set Pollinations API Key`
- `Phoenix Ops: Configure Supervisor Mode`
- `Phoenix Ops: Configure Jarvis Voice Settings`
- `Phoenix Ops: Configure Agent Model Hub`
- `Phoenix Ops: Create Issue`
- `Phoenix Ops: Create Pull Request`
- `Phoenix Ops: Merge Pull Request`
- `Phoenix Ops: Comment on Pull Request`
- `Phoenix Ops: Update Project Field`
- `Phoenix Ops: Update Labels`
- `Phoenix Ops: Open Issue in Browser`
- `Phoenix Ops: Open Run in Browser`
- `Phoenix Ops: Open Pull Request in Browser`
- `Phoenix Ops: Open Right Agent Panel`
- `Phoenix Ops: Open Session in Editor`
- `Phoenix Ops: Ask Jarvis`
- `Phoenix Ops: Toggle Jarvis Manual Mode`

Keyboard shortcuts:

- `Ctrl+Alt+J` (`Cmd+Alt+J` on macOS) -> Ask Jarvis
- `Ctrl+Alt+M` (`Cmd+Alt+M` on macOS) -> Toggle Jarvis Manual Mode

Jarvis startup + wake word:

- When `phoenixOps.jarvisStartupGreetingOnStartup=true` (default), Jarvis posts a startup greeting on extension activation.
- Startup greeting is derived from Command Center's live filtered snapshot (extension context), not supervisor cached `/jarvis/respond` context.
- Jarvis keeps per-VSCode-session memory in extension global storage (`phoenix-jarvis-session-memory.json`), including ordered user/Jarvis turns and a compact session summary.
- Cross-session carryover is intentionally light: startup may include only the last few completed session summaries (currently 3).
- Use topbar `Supervisor Mode`, `Jarvis TTS`, `Set Gemini Key`, and `Model Hub` buttons to configure control-plane routing, Gemini/Pollinations speech settings, API keys, and dynamic composer model catalogs without hand-editing settings JSON.
- Use topbar `Wake Word: On` to enable local mic wake-word detection (`jarvis`, `hey jarvis`, `okay jarvis`) when browser speech recognition is available and mic access is allowed.
- Jarvis now builds Pollinations text prompts from prioritized session highlights, pending approvals, PR review pressure, and recent session feed excerpts before any voice call.
- Speech generation is a second step that voices the generated text summary (or local fallback summary when degraded).
- Pollinations degradation now uses channel-specific cooldowns (chat/speech) with single warning per cooldown window and local fallback summaries when API calls are paused.
- Startup CLI bootstrap remains enabled, but install/sign-in retries are now throttled and deduplicated to avoid terminal storms across repeated VS Code restarts.
- Extension activation now uses a short startup warm-up budget so supervisor/auth bootstrap continues in the background while the UI becomes responsive sooner.
- Jarvis voice playback only uses AI-generated audio payloads and explicitly forbids browser `speechSynthesis` fallback.
- When webview autoplay is blocked by browser policy, Command Center queues host-native playback in extension host so supervisor announcements still play without a click.
- Jarvis speech events are forwarded best-effort to supervisor `POST /jarvis/speak` so voice announcements appear in agent session/feed telemetry.

## Build VSIX

```powershell
npm run package:vsix
```

## Install VSIX Locally

```powershell
code --install-extension .\phoenix-vscode-command-center-0.1.0.vsix --force
```

## Requirements

- `gh` CLI installed and authenticated with `project`, `repo`, and `workflow` scopes.
- Optional supervisor service at `http://127.0.0.1:8787` for realtime updates.

## Realtime For Teams

For shared use, host a supervisor and point extension settings to it:

- `phoenixOps.supervisorBaseUrl=https://<your-supervisor>`
- optional `phoenixOps.supervisorAuthToken=<token>` (matches supervisor `SUPERVISOR_API_TOKEN`)
- keep `phoenixOps.allowDirectGhPollingFallback=false` to enforce supervisor-first reads

Webhook setup guide:

- `docs/WEBHOOK_SETUP.md`

For agent sessions/feed, external workers can post to supervisor endpoints:

- `POST /agents/session`
- `POST /agents/feed`
- `POST /agents/message`
- `POST /agents/dispatch`
- `POST /agents/command/decision`
- `POST /jarvis/speak`
- `POST /jarvis/respond`
- `POST /qa/handoff`
- `POST /qa/handoff/decision`
- `GET /qa/handoffs`
- `GET /qa/handoff/:handoffId`

QA queue behavior:

- Queueing a QA handoff creates a linked pending approval item in the existing approval UI.
- Approving/rejecting the linked command updates the QA handoff status.
- Agents should open PRs only after the QA handoff reaches `approved`.

This repo includes `.vscode/settings.json` MCP wiring that points to the sibling
`Phoenix-Agentic-Workspace-Supervisor/dist/qaMcpServer.js` script for local development.

For accurate per-session chat/context stats in the extension UI (instead of estimate),
include usage fields on session/feed payloads when available from SDK/CLI runtimes:

- `usage.continues`
- `usage.chatMessages`
- `usage.contextTokens`
- `usage.contextWindow`
- `usage.model`

(`stats.*` and `metrics.*` aliases are also accepted.)

Dispatch behavior:

- `transport=local` dispatches a CLI agent for the current VS Code worktree and branch.
- Other transports can target explicit repository/branch/workspace values.

## Troubleshooting

- If the panel looks empty after install, run `Developer: Reload Window`.
- Run task `Command Center: Verify` to confirm compile/tests pass.
- Confirm `gh auth status` is valid.
- If supervisor is unavailable, set `phoenixOps.useSupervisorStream=false` and use polling mode.
- For startup + Jarvis diagnostics, check VS Code Output channels:
  - `Phoenix Ops Command Center`
  - `Phoenix Workspace Supervisor`
