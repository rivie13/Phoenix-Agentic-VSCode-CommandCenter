---
name: github-actions-debug
description: Debug failed GitHub Actions CI/CD workflow runs for the Command Center repo. Use when user asks to fix CI, debug a failed workflow, check why a build failed, investigate GitHub Actions errors, or troubleshoot pipeline failures.
---

# GitHub Actions Debug — Phoenix Command Center

## Repo Context

| Field | Value |
|-------|-------|
| Repo  | `rivie13/Phoenix-Agentic-VSCode-CommandCenter` |
| Owner | `rivie13` |
| Stack | VS Code Extension · TypeScript CommonJS · vitest |

## CRITICAL — Use GitHub MCP tools only

**NEVER** use `gh` CLI. Load and use:

```
tool_search_tool_regex({ pattern: "mcp_github" })
```

Key tools:
- `mcp_github_github_actions_list` — list workflow runs
- `mcp_github_github_actions_get` — get a specific run
- `mcp_github_github_get_job_logs` — get job logs

## Debug workflow

1. **List recent runs** to find the failed one
2. **Get job logs** for the failed run
3. **Identify the failure** — compile error, test failure, lint error, VSIX packaging issue
4. **Locate** the relevant source code
5. **Fix** the issue
6. **Verify** locally with `npm run verify`
7. **Push** the fix

## Common failure patterns

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| TypeScript compile error | Type mismatch, missing import | Fix types, run `npm run lint` |
| vitest failure | Test assertion wrong, mock missing | Fix test logic in `test/` |
| VSIX packaging error | Missing `out/` directory | Ensure `npm run compile` runs first |
| Missing dependency | `package.json` out of sync | Run `npm install` |

## Local reproduction

```bash
npm run verify   # Reproduces the full CI pipeline locally
```
