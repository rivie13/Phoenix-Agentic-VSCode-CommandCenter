# Phoenix VS Code Command Center

Local-first VS Code extension for Phoenix board + Actions visibility and safe write actions.

## Features

- Unified in-editor dashboard (Activity Bar → **Phoenix Ops**)
- Board lanes for canonical statuses (`Backlog` → `Done`)
- Actions triage buckets (`Queued`, `In Progress`, `Needs Attention`)
- Detail panel with run/job summaries and links
- Safe writes with confirmations:
  - create issue
  - update project fields (`Status`, `Work mode`, `Priority`, `Size`, `Area`)
  - add/remove labels
- Realtime stream via supervisor SSE (`/events`) with automatic fallback polling

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
- `Command Center: Package VSIX`
- `Command Center: Install VSIX`

For debugging, use launch config:

- `Run Command Center Extension`

## Settings

- `phoenixOps.projectOwner` (default `rivie13`)
- `phoenixOps.projectNumber` (default `3`)
- `phoenixOps.supervisorBaseUrl` (default `http://127.0.0.1:8787`)
- `phoenixOps.useSupervisorStream` (default `true`)
- `phoenixOps.refreshSeconds` (default `30`)
- `phoenixOps.repositories` (optional explicit `owner/repo` list)

If `phoenixOps.repositories` is empty, Phoenix repos are inferred from workspace folders.

## Commands

- `Phoenix Ops: Refresh`
- `Phoenix Ops: Create Issue`
- `Phoenix Ops: Update Project Field`
- `Phoenix Ops: Update Labels`
- `Phoenix Ops: Open Issue in Browser`
- `Phoenix Ops: Open Run in Browser`

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
- Optional supervisor service at `http://127.0.0.1:8787` for SSE live updates.

## Troubleshooting

- If the panel looks empty after install, run `Developer: Reload Window`.
- Run task `Command Center: Verify` to confirm compile/tests pass.
- Confirm `gh auth status` is valid.
- If supervisor is unavailable, set `phoenixOps.useSupervisorStream` to `false` and use polling mode.
