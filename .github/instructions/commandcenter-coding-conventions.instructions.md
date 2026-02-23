# Command Center - Coding Conventions

## Language And Runtime

- **TypeScript** with `strict: true`
- **CommonJS** modules (`"module": "commonjs"` in tsconfig)
- **Target**: ES2022
- **VS Code API**: `@types/vscode` >= 1.109.0

## File Naming

- Extension host source: `src/**/*.ts` - PascalCase for classes, camelCase for utilities
- Webview scripts: `media/webview.*.js` - vanilla JS, no bundler
- Tests: `test/*.test.ts`
- Assets: `media/*.svg`, `media/*.png`

## Code Style

### TypeScript (Extension Host)

- Explicit return types on all exported functions
- Interfaces preferred over type aliases for object shapes
- No `any` unless unavoidable and documented with a comment
- Use `readonly` for immutable properties
- Prefer `const` over `let`; never use `var`
- Async functions use `async/await`, not raw Promise chains
- Error handling: catch specific error types, log with `console.error` or VS Code output channel

### Webview Scripts (Browser JS)

- Plain JavaScript - no TypeScript, no bundler
- Use `const`/`let` only (no `var`)
- Communicate with extension host exclusively via `vscode.postMessage()`
- No Node.js APIs - browser-safe only
- DOM manipulation via vanilla JS (no framework)
- Jarvis audio rule: never use browser `window.speechSynthesis` as fallback
- Supervisor Jarvis audio must remain AI audio payloads played by web audio/html audio or extension-host native playback

## VS Code Extension Patterns

- Register all disposables via `context.subscriptions.push(...)`
- Webview CSP must be explicitly configured in provider
- Commands defined in `package.json` `contributes.commands` with matching activation events
- Settings namespace: `phoenixOps.*`
- Use VS Code `window.showInformationMessage` / `showErrorMessage` for user notifications
- Use QuickPick / InputBox for structured user input

## Message Contract

- All webview <-> extension message types are defined in `src/controller/CommandCenterPayloads.ts`
- Messages carry `{ type: string, payload?: unknown }` shape
- Never pass raw VS Code API objects across the webview boundary

## Module Placement

| Logic type | Location |
|------------|----------|
| Activation, command registration | `src/extension.ts` |
| Cross-domain orchestration | `src/controller/CommandCenterController.ts` |
| Message payload types | `src/controller/CommandCenterPayloads.ts` |
| QuickPick helpers | `src/controller/snapshotPickers.ts` |
| Issue/PR command handlers | `src/controller/issuePullRequestHandlers.ts` |
| Webview HTML shell | `src/providers/CommandCenterViewProvider.ts` |
| Data fetching and caching | `src/services/DataService.ts` |
| GitHub API wrapper | `src/services/GhClient.ts` |
| Supervisor SSE stream | `src/services/SupervisorStreamClient.ts` |
| Supervisor repo lifecycle | `src/services/WorkspaceSupervisorManager.ts` |
| Embedded supervisor lifecycle | `src/services/EmbeddedSupervisorManager.ts` |
| Jarvis voice assistant | `src/services/JarvisService.ts` |
| Jarvis host audio playback | `src/services/JarvisHostAudioPlayer.ts` |
| Pollinations resilience | `src/services/PollinationsResilience.ts` |
| Pure data transformations | `src/utils/*.ts` |
| View-only rendering | `media/webview.*.js` |

## Test Conventions

- Test files: `test/*.test.ts`
- Framework: vitest
- Tests must be deterministic - no network, no VS Code API, no filesystem
- Mock external dependencies; test pure logic in isolation
- Naming: `describe('ModuleName', () => { it('should ...', ...) })`
