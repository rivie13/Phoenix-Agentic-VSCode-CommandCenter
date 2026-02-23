---
excludeAgent: "coding-agent"
---

# Command Center — Code Review

When reviewing changes in the **Phoenix Command Center** VS Code extension, verify the following checklist.

## Architecture conformance

- [ ] Write/API logic stays in `src/` — webview scripts in `media/` are view-only
- [ ] New message payload shapes are added to `src/controller/CommandCenterPayloads.ts`
- [ ] Pure transformations go in `src/utils/`, not in controller or webview
- [ ] No single file exceeds ~1500 lines

## TypeScript quality

- [ ] `npm run lint` passes (strict mode, no `any` unless justified)
- [ ] No `@ts-ignore` or `@ts-expect-error` without a code comment explaining why
- [ ] Explicit return types on exported functions
- [ ] Interfaces preferred over type aliases for object shapes
- [ ] CommonJS module format consistent with `tsconfig.json`

## VS Code extension patterns

- [ ] Disposables registered via `context.subscriptions.push(...)`
- [ ] No global mutable state outside controller lifecycle
- [ ] Webview CSP configured properly in `CommandCenterViewProvider`
- [ ] Commands registered with proper activation events in `package.json`
- [ ] Extension settings follow existing `phoenixOps.*` naming convention

## Testing

- [ ] New logic accompanied by tests in `test/`
- [ ] Tests are deterministic — no network calls, no VS Code API dependency
- [ ] `npm run verify` passes

## Webview scripts

- [ ] New webview modules follow the `media/webview.*.js` naming pattern
- [ ] Webview scripts use only browser-safe APIs (no Node.js builtins)
- [ ] Event handlers wired in `webview.events.js`, not inline

## Security

- [ ] No secrets or API keys hardcoded
- [ ] Webview CSP restricts script sources appropriately
- [ ] Supervisor auth tokens handled via VS Code settings, never logged

## Documentation

- [ ] Public-facing changes reflected in `README.md`
- [ ] Architecture changes reflected in `docs/ARCHITECTURE.md`
- [ ] New commands/settings documented in `package.json` contributes section
