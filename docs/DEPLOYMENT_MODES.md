# Deployment Modes

This extension supports multiple runtime models without changing code.

## Embedded Sidecar Behavior (Default)

- `phoenixOps.embeddedSupervisorEnabled=true` starts the bundled sidecar on:
  - `phoenixOps.embeddedSupervisorHost` (default `127.0.0.1`)
  - `phoenixOps.embeddedSupervisorPort` (default `8789`)
- The extension syncs snapshots into this sidecar for local agent-control workflows.
- This does not replace your configured external/local supervisor read path.

## 1) Local Supervisor (Single Developer)

- Extension connects to a local supervisor instance:
  - `phoenixOps.useSupervisorStream=true`
  - `phoenixOps.supervisorBaseUrl=http://127.0.0.1:8787`
  - `phoenixOps.allowDirectGhPollingFallback=false`
- Supervisor handles startup reconcile and webhook-driven updates.
- Realtime updates flow through supervisor SSE (`/events`).

## 2) Shared Supervisor (Team)

- Team hosts a shared supervisor (VM/container/k8s).
- Each user points extension to the shared endpoint:
  - `phoenixOps.supervisorBaseUrl=https://<team-supervisor>`
  - optional `phoenixOps.supervisorAuthToken=<token>`
- Supervisor can enforce bearer auth with `SUPERVISOR_API_TOKEN=<token>`.
- Keep `phoenixOps.allowDirectGhPollingFallback=false` to enforce supervisor-only reads.

## 3) No Supervisor (Fallback Mode)

- Realtime is unavailable in this mode.
- Enable fallback:
  - `phoenixOps.useSupervisorStream=false`
  - or `phoenixOps.allowDirectGhPollingFallback=true`
- Extension polls GitHub via `gh` with cache/backoff behavior.

## 4) VM CLI Isolation Mode

The Supervisor and all CLI agents (Codex, Copilot, Gemini) run inside a dedicated
VM. The host extension connects through an SSH localhost tunnel and acts as a
read/control surface only — no CLI execution, no credentials, no embedded Jarvis
sidecar on the host.

### Tunnel Setup

```bash
ssh -NT -L 8787:127.0.0.1:8787 <vm-user>@<vm-ip>
```

### Required Settings

```jsonc
{
  "phoenixOps.supervisorBaseUrl": "http://127.0.0.1:8787",
  "phoenixOps.workspaceSupervisorAutoStart": false,
  "phoenixOps.workspaceSupervisorRunBootstrapOnAutoStart": false,
  "phoenixOps.cliBootstrapOnStartup": false,
  "phoenixOps.cliStartupSpawnPtyTerminals": false,
  "phoenixOps.cliStartupAutoInstallMissing": false,
  "phoenixOps.cliStartupAutoSignIn": false,
  "phoenixOps.allowDirectGhPollingFallback": false,
  "phoenixOps.useSupervisorStream": true
}
```

### Optional (Recommended)

```jsonc
{
  "phoenixOps.supervisorAuthToken": "<same token configured in VM .env>"
}
```

### What Happens in This Mode

- Terminal output streams from VM PTY processes through WebSocket over the SSH tunnel.
- SSE events (`/events`) deliver real-time board, agent, and Jarvis updates over the tunnel.
- Agent dispatch sends workspace paths — these must resolve in the VM filesystem.
- The embedded Jarvis sidecar is automatically disabled when these settings are detected.

### Workspace Path Caveat

The extension resolves workspace paths from the host VS Code Git API. These host
paths are sent to the VM Supervisor in dispatch payloads. If host and VM paths
differ (e.g., Windows host → Linux VM), dispatch will fail unless:

- Repos exist at matching paths in the VM, **or**
- `phoenixOps.vmWorkspaceRoot` is set to translate host paths to VM paths (see #37).

### Reference

See Supervisor `docs/VM_CLI_ISOLATION_RUNBOOK.md` for full VM setup, bootstrap,
and troubleshooting procedures.

## Repository Discovery

When `phoenixOps.repositories` is empty, discovery uses:

- `workspaceGitRemotes` (recommended generic mode)
- `phoenixWorkspace` (legacy profile mode kept for backward compatibility)

Set:

- `phoenixOps.repositoryDiscoveryMode=workspaceGitRemotes`

for general multi-repo workspaces so repos are inferred from each folder `origin` remote.

## Recommended Defaults For New Users

- `phoenixOps.useSupervisorStream=true`
- `phoenixOps.allowDirectGhPollingFallback=false`
- `phoenixOps.repositoryDiscoveryMode=workspaceGitRemotes`
- `phoenixOps.repositories=[]` (auto-discover from workspace remotes)
