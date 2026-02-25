---
name: build-and-test
description: Build, test, lint, and validate the Phoenix Command Center VS Code extension. Use when user asks to build, compile, test, lint, run verify, fix build errors, package VSIX, or validate changes.
---

# Build & Test — Phoenix Command Center

## Quick reference

| Task | Command |
|------|----------|
| Install deps | `npm install` |
| Type-check only | `npm run lint` |
| Run tests | `npm run test` |
| Compile to JS | `npm run compile` |
| Full quality gate | `npm run verify` |
| Watch mode | `npm run watch` |
| Package VSIX | `npm run package:vsix` |
| Install VSIX | `code --install-extension phoenix-vscode-command-center-0.1.0.vsix --force` |

## Workflow

1. **Always run `npm run verify` before committing** — this runs lint + test + compile
2. If only checking types: `npm run lint`
3. If only running tests: `npm run test`
4. For continuous development: `npm run watch` in background

## CI pipeline

GitHub Actions CI (`.github/workflows/ci.yml`) enforces the same quality gate automatically on every push to `main` and all pull requests. CI is a merge gate — PRs with failing checks must not be merged.

## Test details

- Framework: **vitest**
- Test location: `test/*.test.ts`
- Tests must be deterministic — no network calls, no VS Code API dependency
- Run with: `npm run test` → `vitest run`

## VS Code tasks

Use these pre-configured tasks from `.vscode/tasks.json`:
- `Command Center: Install`
- `Command Center: Compile`
- `Command Center: Watch`
- `Command Center: Lint`
- `Command Center: Test`
- `Command Center: Verify`
- `Command Center: Package VSIX`
- `Command Center: Install VSIX`

## Debug (F5)

Press F5 to launch the Extension Development Host with the extension loaded. Requires `npm run compile` to have been run first (or `npm run watch` running in background).

## Troubleshooting

- **Compile errors**: Run `npm run lint` for pure type errors
- **Test failures**: Check `test/` files; all tests run without VS Code API
- **VSIX fails**: Ensure `npm run compile` succeeded; `out/` must exist
- **Extension not loading**: Check activation events in `package.json`
