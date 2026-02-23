# Command Center — Strategy

## Purpose

The Command Center is the **user-facing dashboard** for Phoenix Ops. It surfaces project state, enables direct actions, and connects to the Supervisor control plane — all within VS Code.

## Feature Placement Decision Framework

When deciding where new functionality belongs:

| Question | If yes → |
|----------|----------|
| Does it render UI for the developer? | **Command Center** (webview or QuickPick) |
| Does it manage persistent state or queue ordering? | **Workspace Supervisor** |
| Does it need to run when VS Code is closed? | **Workspace Supervisor** or **Backend** |
| Does it involve GitHub webhook processing? | **Workspace Supervisor** |
| Is it a pure data transformation? | **Command Center `src/utils/`** |
| Does it expose MCP tools for external agents? | **Workspace Supervisor** |
| Does it need backend API integration (engine, auth)? | **Backend** |
| Is it a shared TypeScript contract or SDK? | **Interface** |

## Architectural Principles

1. **Supervisor-first reads**: Board, actions, and PR data should come from the supervisor snapshot/stream whenever possible. Direct GitHub polling is a fallback.

2. **View logic in `media/`, write logic in `src/`**: Webview scripts handle rendering only. All API calls, state mutations, and orchestration happen in the extension host.

3. **Message-driven communication**: Extension host and webview communicate exclusively via typed messages defined in `CommandCenterPayloads.ts`.

4. **Graceful degradation**: If the supervisor is unreachable, the extension should degrade to reduced functionality rather than crash. Rate-limit detection triggers cooldown.

5. **Configuration over code**: Extension settings (`phoenixOps.*`) allow users to customize behavior without code changes.

## Supervisor Mode Strategy

The extension supports three supervisor modes:

| Mode | Description | When to use |
|------|-------------|-------------|
| **Workspace** | Connects to `Phoenix-Agentic-Workspace-Supervisor` repo server | Primary development mode |
| **Embedded** | Runs a bundled sidecar supervisor | Lightweight/standalone use |
| **Direct** | Falls back to direct GitHub polling | Offline/degraded mode |

Workspace mode is the default and recommended approach.

## VS Code Extension Marketplace Strategy

- Extension is currently **private** (`"private": true` in `package.json`)
- Marketplace publishing is planned for Phase E
- Extension must work standalone (no mandatory external services)
- All Phoenix-specific features should degrade gracefully for non-Phoenix workspaces
