# Command Center — Build & Test

## Prerequisites

- Node.js ≥ 18
- npm (bundled with Node)
- VS Code ≥ 1.109.0

## Install dependencies

```bash
npm install
```

## Compile (TypeScript → JavaScript)

```bash
npm run compile      # tsc -p ./
```

Output lands in `out/`.

## Watch (continual rebuild)

```bash
npm run watch        # tsc -watch -p ./
```

## Lint (type-check only)

```bash
npm run lint         # tsc -p ./ --noEmit
```

## Test

```bash
npm run test         # vitest run
```

Tests live in `test/` and use vitest. All tests must be deterministic and runnable without VS Code extension host.

## Verify (full quality gate)

```bash
npm run verify       # lint + test + compile
```

**Run `npm run verify` before every PR and commit.**

## CI pipeline

GitHub Actions CI (`.github/workflows/ci.yml`) runs the same quality gate automatically:

- **Trigger**: push to `main` and all pull requests
- **Steps**: checkout → Node.js 20 setup with npm cache → `npm ci` → `npm run lint` → `npm run test` → `npm run compile`
- **Concurrency**: duplicate runs on the same branch are cancelled automatically

CI is a merge gate — PRs with failing checks must not be merged.

## Package VSIX

```bash
npm run package:vsix   # npx @vscode/vsce package
```

Produces `phoenix-vscode-command-center-0.1.0.vsix` in the repo root.

## Install VSIX locally

```bash
code --install-extension phoenix-vscode-command-center-0.1.0.vsix --force
```

## VS Code Tasks

| Task | Purpose |
|------|----------|
| `Command Center: Install` | `npm install` |
| `Command Center: Compile` | `npm run compile` |
| `Command Center: Watch` | `npm run watch` (background) |
| `Command Center: Lint` | `npm run lint` |
| `Command Center: Test` | `npm run test` |
| `Command Center: Verify` | `npm run verify` |
| `Command Center: Package VSIX` | Build VSIX (depends on Compile) |
| `Command Center: Install VSIX` | Install VSIX into VS Code (depends on Package) |

## Debug (F5)

Use the VS Code **Extension Development Host** launch configuration (`.vscode/launch.json`). Press F5 to compile and launch a new VS Code window with the extension loaded.

## Troubleshooting

- **Compile errors**: Run `npm run lint` first to see pure type errors without emitting
- **Test failures**: Run `npm run test` to see vitest output; tests must not depend on VS Code API at runtime
- **VSIX packaging fails**: Ensure `npm run compile` succeeds first; `@vscode/vsce` requires the `out/` directory
