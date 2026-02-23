---
name: git-hygiene
description: Enforce branch hygiene, pre-commit validation, PR setup via GitHub MCP tools, and review follow-up workflow in the Command Center repo. Use when user asks about git workflow, PR creation, branch management, or commit hygiene.
---

# Git Hygiene — Phoenix Command Center

## Repo Context

| Field | Value |
|-------|-------|
| Repo  | `rivie13/Phoenix-Agentic-VSCode-CommandCenter` |
| Owner | `rivie13` |
| Visibility | Public |
| Default branch | `main` |

## CRITICAL — GitHub MCP tools only

**NEVER** use `gh` CLI. Load and use GitHub MCP tools:

```
tool_search_tool_regex({ pattern: "mcp_github" })
```

## Branch naming

```
feature/<issue>-<slug>          ← feature off main
feature/<issue>-<slug>/<sub>    ← sub-feature off feature
```

## Commit format

```
type(area): short description
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`, `perf`

Areas: `extension`, `controller`, `webview`, `services`, `utils`, `jarvis`, `supervisor`, `agent`, `board`, `actions`, `prs`, `tests`, `docs`, `ci`

## Pre-commit quality gate

```bash
npm run verify   # lint + test + compile — must pass
```

## PR creation

1. Run `npm run verify` — all green
2. Create branch via `mcp_github_github_create_branch`
3. Push files via `mcp_github_github_push_files`
4. Create PR via `mcp_github_github_create_pull_request`
5. Link to originating issue in PR body

## PR size

- Target ≤ 400 lines added/modified
- Split larger changes into stacked PRs

## Merge rules

- **Squash merge** to `main`
- **Delete branch** after merge
- Update linked issue status after merge

## Post-merge

- [ ] Issue moved to Done
- [ ] Branch deleted
- [ ] Instruction files updated if needed
- [ ] VSIX re-tested if extension behavior changed
