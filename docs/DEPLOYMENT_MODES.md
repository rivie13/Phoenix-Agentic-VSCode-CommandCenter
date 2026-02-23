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
