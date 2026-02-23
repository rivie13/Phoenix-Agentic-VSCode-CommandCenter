---
name: pr-management
description: Create, update, and manage GitHub pull requests for the Command Center repo. Use when user asks to create a PR, update a PR description, push changes, list PRs, merge a PR, check PR status, or manage branches.
---

# PR Management — Phoenix Command Center

## Repo Context

| Field | Value |
|-------|-------|
| Repo  | `rivie13/Phoenix-Agentic-VSCode-CommandCenter` |
| Owner | `rivie13` |
| Visibility | Public |
| Stack | VS Code Extension · TypeScript CommonJS · vitest |
| Related repos | `Phoenix-Agentic-Workspace-Supervisor` |

## CRITICAL — Use GitHub MCP tools only

**NEVER** use `gh` CLI. Always use GitHub MCP tools:
- `mcp_github_github_create_pull_request`
- `mcp_github_github_list_pull_requests`
- `mcp_github_github_pull_request_read`
- `mcp_github_github_update_pull_request`
- `mcp_github_github_merge_pull_request`
- `mcp_github_github_push_files`
- `mcp_github_github_create_branch`
- `mcp_github_github_list_branches`
- `mcp_github_github_list_commits`

Load tools first:
```
tool_search_tool_regex({ pattern: "mcp_github" })
```

## Quality gate — run before PR

```bash
npm run verify   # lint + test + compile
```

## PR title format

```
feat(area): short description
fix(area): short description
docs(area): short description
refactor(area): short description
test(area): short description
chore(area): short description
```

Valid areas: `extension`, `controller`, `webview`, `services`, `utils`, `jarvis`, `supervisor`, `agent`, `board`, `actions`, `prs`, `tests`, `docs`, `ci`

## PR body template

```markdown
## Summary
<one-line description>

## Changes
- Bullet list of changes

## Testing
- [ ] `npm run verify` passes
- [ ] Extension tested in Development Host (F5)

## Related Issues
Closes #<issue-number>
```

## Branch naming

```
feature/<issue>-<slug>          ← feature off main
feature/<issue>-<slug>/<sub>    ← sub-feature off feature
```

## PR size discipline

- Target ≤ 400 added/modified lines per PR
- If larger, split into stacked PRs

## Merge rules

- Squash merge to main
- Feature branches may use fast-forward or squash
- Delete branch after merge
- Update linked issue status after merge
