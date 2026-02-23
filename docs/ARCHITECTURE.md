# Phoenix Command Center Architecture

This document describes the current module boundaries after breaking up the previous webview monolith.

## Top-Level Runtime

- Extension host entrypoint: `src/extension.ts`
- Extension controller/orchestration: `src/controller/CommandCenterController.ts`
- Webview provider and HTML shell: `src/providers/CommandCenterViewProvider.ts`
- Webview runtime scripts: `media/webview*.js`
- Data/control services: `src/services/*.ts`

## Webview Runtime Layout

The webview now loads multiple scripts in a fixed order to keep each concern isolated while sharing one global runtime state.

1. `media/webview.js`
   - Shared state container and common rendering helpers.
   - Core render orchestration (`render()`).
2. `media/webview.issue-forms.js`
   - Issue/PR creation form normalization, metadata, and submit handlers.
3. `media/webview.actions.js`
   - Actions grouping, lane rendering, retry/log insight rendering.
4. `media/webview.pull-requests.js`
   - Pull request lanes, review insights, comment panel.
5. `media/webview.agent.js`
   - Session classification, feed/chat timeline, composer payload assembly.
6. `media/webview.events.js`
   - DOM event wiring, incoming extension message handling, boot sequence.

## Extension Host Layout

- `src/extension.ts`
  - Activation wiring and command registration.
- `src/controller/CommandCenterController.ts`
  - Controller lifecycle, supervisor stream/polling flow, and cross-domain orchestration.
  - Wires focused handler modules through dependency adapters.
- `src/controller/CommandCenterPayloads.ts`
  - Message payload and bridge type contracts for webview-to-extension communication.
- `src/controller/webviewMessageRouter.ts`
  - Webview message routing (`type`/payload branching) and command fan-out.
- `src/controller/issuePullRequestHandlers.ts`
  - Issue/PR form metadata, create flows, and board tab open actions.
- `src/controller/agentRuntimeHandlers.ts`
  - Agent dispatch/message/stop/approval writes and context attachment flows.
- `src/controller/jarvisSupervisorHandlers.ts`
  - Workspace supervisor Jarvis `/jarvis/respond` and `/jarvis/speak` integration flow.
- `src/controller/jarvisInteractionHandlers.ts`
  - Jarvis activation and auto-announcement decision/response flow.
- `src/controller/jarvisDelegatedApprovalHandler.ts`
  - Delegated pending-command approval policy and approval execution.
- `src/services/JarvisHostAudioPlayer.ts`
  - Host-native Jarvis audio playback queue used when webview autoplay policies block direct media playback.
- `src/controller/embeddedSupervisorHandlers.ts`
  - Embedded supervisor start/snapshot-sync HTTP integration flow.
- `src/controller/configurationPrompts.ts`
  - Interactive supervisor/model-hub configuration prompt flows and validation.
- `src/controller/supervisorFlowHandlers.ts`
  - Supervisor stream bootstrap and snapshot refresh/reconcile flow.
- `src/controller/agentModelCatalogHandlers.ts`
  - Model hub fetch/caching fallback behavior for agent model catalog payloads.
- `src/controller/settingsAuthHandlers.ts`
  - CLI auth command launch flow plus scoped configuration update helpers.
- `src/controller/snapshotPickers.ts`
  - Shared snapshot-driven QuickPick selectors and board-item lookup helpers.
- `src/utils/issueTemplates.ts`
  - Issue template normalization, planned-branch suggestion, markdown body builder.
- `src/utils/agentModelCatalog.ts`
  - Agent model catalog normalization and hub payload coercion.
- `src/utils/jarvisPrompts.ts`
  - Jarvis auto-decision logic and prompt/fallback composition helpers.

## Message Flow

1. Webview posts message via `vscode.postMessage(...)`.
2. `CommandCenterViewProvider` forwards to controller.
3. `CommandCenterController.handleIncomingMessage(...)` delegates routing to `routeWebviewMessage(...)`.
4. Router delegates to focused handlers (`issuePullRequestHandlers`, `agentRuntimeHandlers`, controller-owned commands).
5. Controller posts state updates back to one or more webviews.
6. Webview `window.message` handlers apply payloads and rerender.

## Refactor Guardrails

- Keep a single file below ~1500 lines when practical.
- Keep view-only logic in `media/` and host/write logic in `src/`.
- Add new message payload shapes in `src/controller/CommandCenterPayloads.ts`.
- Add deterministic/pure transformations under `src/utils/`.
- Prefer adding focused render/event modules over growing `media/webview.js`.
- Jarvis audio policy: never add browser `speechSynthesis` fallback; use supervisor audio payloads and host-native playback instead.
