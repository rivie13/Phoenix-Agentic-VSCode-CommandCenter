---
name: bug-report
description: Investigate a bug and create a high-quality GitHub bug issue with reproducible steps and code-level findings for the Command Center extension. Use when user asks to report a bug, file an issue, document a regression, or write an investigation-backed bug report.
---

# Bug Report — Phoenix Command Center

## Repo Context

| Field | Value |
|-------|-------|
| Repo  | `rivie13/Phoenix-Agentic-VSCode-CommandCenter` |
| Owner | `rivie13` |
| Visibility | Public |
| Stack | VS Code Extension · TypeScript CommonJS · vitest |

## Investigation workflow

1. **Reproduce** the bug — identify exact steps, extension commands, or webview interactions
2. **Locate** the relevant code path in `src/` (extension host) or `media/` (webview)
3. **Read** the source to understand the expected behavior
4. **Identify** the root cause or narrow down the suspect area
5. **Search** for related issues using GitHub MCP tools
6. **Write** the bug report issue

## CRITICAL — Use GitHub MCP tools only

**NEVER** use `gh` CLI. Always use:
- `mcp_github_github_issue_write` — create the issue
- `mcp_github_github_search_issues` — check for duplicates
- `mcp_github_github_list_issues` — list open issues

Load tools first:
```
tool_search_tool_regex({ pattern: "mcp_github" })
```

## Bug report template

```markdown
## Bug Description
<clear one-line summary>

## Steps to Reproduce
1. <step>
2. <step>
3. <step>

## Expected Behavior
<what should happen>

## Actual Behavior
<what actually happens>

## Code-Level Findings
- **File**: `src/...` or `media/...`
- **Function**: `handleIncomingMessage()` / `render()` etc.
- **Root cause**: <analysis>

## Environment
- VS Code version: <version>
- Extension version: 0.1.0
- OS: Windows / macOS / Linux
- Supervisor mode: workspace / embedded / direct

## Screenshots / Logs
<if applicable>
```

## Valid areas for labels

`extension`, `controller`, `webview`, `services`, `utils`, `jarvis`, `supervisor`, `agent`, `board`, `actions`, `prs`, `tests`, `docs`
