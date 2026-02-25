# Command Center — Git Hygiene

## Branch Strategy

Three-tier hierarchy aligned with the Phoenix project board:

```
main
 └── feature/<issue>-<slug>
      └── feature/<issue>-<slug>/<sub-feature>
```

### Naming examples

```
feature/42-jarvis-voice-settings
feature/42-jarvis-voice-settings/volume-control
feature/55-pr-review-panel
```

## Commit Messages

Use conventional commits:

```
type(area): short description

body (optional)
```

### Types

`feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`, `perf`

### Valid areas

`extension`, `controller`, `webview`, `services`, `utils`, `jarvis`, `supervisor`, `agent`, `board`, `actions`, `prs`, `tests`, `docs`, `ci`

### Examples

```
feat(webview): add PR comment panel rendering
fix(controller): handle supervisor stream reconnect on timeout
test(jarvis): add JarvisService prompt composition tests
docs(extension): update activation event list in README
```

## PR Workflow

### CRITICAL — Use GitHub MCP tools only

**NEVER** use `gh` CLI for PR operations. Always use:
- `mcp_github_github_create_pull_request`
- `mcp_github_github_update_pull_request`
- `mcp_github_github_merge_pull_request`
- `mcp_github_github_push_files`
- `mcp_github_github_create_branch`

### Quality gate

Run `npm run verify` before every PR push. All three steps must pass:
1. `npm run lint` — type check
2. `npm run test` — vitest
3. `npm run compile` — build

### CI checks

- After creating/updating PR:
  - Check GitHub Actions/workflow run status for the PR
  - If any workflow/job fails, fetch logs and fix the root cause
  - Re-run validations locally and re-trigger/recheck workflow runs
  - Do not mark PR ready while required checks are failing
- PR GitHub Actions checks are green (or explicitly understood/waived)

### PR size

- Target ≤ 400 added/modified lines per PR
- Split larger changes into stacked PRs

### Merge strategy

- **Squash merge** to `main`
- **Fast-forward or squash** for feature → sub-feature
- **Delete branch** after merge

## Post-Merge Checklist

- [ ] Linked issue moved to Done on project board
- [ ] Branch deleted
- [ ] Instruction files updated if architecture/conventions changed
- [ ] VSIX re-packaged and tested if extension behavior changed

## Signal Labels

Project board uses signal labels to communicate task state:
- `signal:needs-review` — PR ready for review
- `signal:blocked` — task is blocked by dependency
- `signal:in-progress` — actively being worked on

## Related Repos

Changes in Command Center may require coordinated updates in:
- `Phoenix-Agentic-Workspace-Supervisor` — if API contract or SSE event shape changes
- `Phoenix-Agentic-Engine-Backend` — if backend API integration is affected
