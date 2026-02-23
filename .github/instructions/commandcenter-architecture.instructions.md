# Command Center — Architecture

## Overview

The **Phoenix Command Center** is a VS Code extension (`phoenix-vscode-command-center`) that serves as the unified dashboard for Phoenix Ops — project board, GitHub Actions, pull requests, agent dispatch, Jarvis voice assistant, and QA workflows — all in a webview-based sidebar.

## Runtime Model

The extension runs inside the **VS Code extension host** (Node.js process) and renders its UI via **Webview Panels** in the Activity Bar sidebar and secondary sidebar. Communication between extension host and webview is via `vscode.postMessage` / `onDidReceiveMessage`.

## Module Topology

### Extension Host (`src/`)

| Module | Responsibility |
|--------|---------------|
| `extension.ts` | Activation wiring, command registration, disposable setup |
| `types.ts` | Shared TypeScript types for the extension host |
| `controller/CommandCenterController.ts` | Controller lifecycle, supervisor stream/polling, cross-domain orchestration |
| `controller/CommandCenterPayloads.ts` | Message payload type contracts for webview ↔ extension |
| `controller/snapshotPickers.ts` | Snapshot-driven QuickPick selectors and board-item lookups |
| `controller/issuePullRequestHandlers.ts` | Issue and PR creation/update command handlers |
| `providers/CommandCenterViewProvider.ts` | WebviewViewProvider — HTML shell, CSP, script loading |
| `services/DataService.ts` | GitHub GraphQL data fetching and caching |
| `services/GhClient.ts` | Authenticated GitHub API wrapper |
| `services/SupervisorStreamClient.ts` | SSE stream reader for supervisor events |
| `services/WorkspaceSupervisorManager.ts` | Auto-discovery and lifecycle of the Workspace Supervisor repo server |
| `services/EmbeddedSupervisorManager.ts` | Lifecycle for the optional embedded supervisor sidecar |
| `services/JarvisService.ts` | Jarvis voice assistant orchestration, prompt dispatch, audio playback |
| `services/PollinationsResilience.ts` | Rate-limit and error handling for Pollinations API |
| `utils/transform.ts` | Pure data transformations (board snapshots → display models) |
| `utils/issueTemplates.ts` | Issue template normalization, branch suggestion, markdown body builder |
| `utils/agentModelCatalog.ts` | Agent model catalog normalization and hub payload coercion |
| `utils/jarvisPrompts.ts` | Jarvis auto-decision logic and prompt composition |
| `utils/workspace.ts` | Workspace path utilities |

### Webview Runtime (`media/`)

| Script | Responsibility |
|--------|---------------|
| `webview.js` | Shared state container, common rendering helpers, core `render()` |
| `webview.issue-forms.js` | Issue/PR creation form normalization, metadata, submit handlers |
| `webview.actions.js` | Actions grouping, lane rendering, retry/log insight |
| `webview.pull-requests.js` | PR lanes, review insights, comment panel |
| `webview.agent.js` | Session classification, feed/chat timeline, composer payload assembly |
| `webview.events.js` | DOM event wiring, incoming extension message handling, boot |

## Message Flow

1. Webview posts message via `vscode.postMessage({ type, payload })`
2. `CommandCenterViewProvider` forwards to controller via handler registration
3. `CommandCenterController.handleIncomingMessage(...)` dispatches command/action
4. Controller performs work (GitHub API, supervisor call, etc.)
5. Controller posts state updates back to webview(s) via `postMessage`
6. Webview message handlers apply payloads and re-render

## Supervisor Integration

The extension connects to the **Workspace Supervisor** (separate Node.js server) for real-time state:

- **SSE stream**: `/events` endpoint for live snapshot deltas
- **REST**: `/snapshot`, `/health`, `/agents/*` for state queries
- **Fallback**: If supervisor is unreachable, extension can optionally fall back to direct GitHub polling (disabled by default)

The extension can also auto-start the Workspace Supervisor repo server or run an embedded supervisor sidecar.

## Key Design Principles

- **View-only logic in `media/`** — all write/API logic stays in `src/`
- **Message payloads defined in `CommandCenterPayloads.ts`** — single source of truth
- **Pure transformations in `utils/`** — testable without VS Code API
- **Single file ≤ 1500 lines** when practical
- **Supervisor-first**: reads should route through supervisor whenever possible
