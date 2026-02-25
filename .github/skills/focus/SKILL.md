---
name: focus
description: Resume assigned work, confirm active task context, update checkpoints, or complete assigned tasks. Use when user says resume, what am I working on, task done, update checkpoint, what's my focus, or starts a new session.
---

# Focus — Phoenix Command Center

## Mandatory first step

Always read board state first (single source of truth):

- Project board: https://github.com/users/rivie13/projects/3
- Repository: `rivie13/Phoenix-Agentic-VSCode-CommandCenter`

## Workflows

### Resume (user says "resume", "what am I working on?", or starts a new session)

1. Read board items for this repo in `In Progress` (and, if needed, `Ready`)
2. If an in-progress item exists: summarize in 3 lines — what, current state, next step
3. If no active item: say "No active assigned board task" and ask for assignment source/intent

### Confirm assigned task (dispatcher/local/cloud assignment)

1. Read assignment input from prompt/context (dispatcher payload, direct user-assigned issue, or cloud assignment)
2. Validate assignment against board state and verify lock/dependency fields (`Area`, `Depends On`, `Lock Key`, `Needed Files`)
3. Study assignment context (issue body, acceptance criteria, linked comments/PRs) before implementation
4. Confirm branch target and execution mode (Local IDE / CLI / Cloud)
5. If assignment is valid, proceed and post checkpoints during execution

### Pick next task (fallback only; user explicitly asks)

1. Confirm there is no conflicting in-progress work for this repo on the board
2. Read the roadmap docs:
   - `.github/instructions/commandcenter-roadmap.instructions.md`
3. Check the project board for items in "Ready" (and only use Backlog if explicitly requested)
4. Recommend the highest-priority unblocked task based on phase order and dependencies
5. Ask user to confirm assignment
6. Create a GitHub issue if one doesn't exist
7. Move the issue to **In Progress** and set its Area on the project board using signal labels:
   ```
   mcp_github_github_issue_write(method="update", owner="rivie13", repo="Phoenix-Agentic-VSCode-CommandCenter", issueNumber=<N>, labels=["task", "set:status:in-progress", "set:area:<area>"])
   ```
   Valid Command Center areas: `extension`, `jarvis`, `agents`, `webview`, `tests`, `docs`, `ci`

### Update checkpoint (user says "save progress", "checkpoint", "update task")

1. Read the active board issue and latest PR/comment context
2. Ask what was accomplished and what's next
3. Post/update concise progress in issue/PR comments and board status fields

### Complete task (user says "task done", "finished", "close task")

1. Read active board issue and verify acceptance criteria are met
2. Run `npm run verify` before marking any code task complete
3. **Close the GitHub issue** — do NOT rely solely on `Closes #N` in the PR body. Explicitly close it:
   ```
   mcp_github_github_issue_write(method="update", owner="rivie13", repo="Phoenix-Agentic-VSCode-CommandCenter", issueNumber=<N>, state="closed", stateReason="completed")
   ```
4. **Close related sub-issues** — verify each completed sub-issue is closed
5. **Check parent epic** — if all sibling sub-issues are closed, close the parent epic too
6. Move the issue/epic to "Done" on the project board
7. Report completion and await/confirm next assignment
8. Update instruction files if the completed work changes architecture or conventions

> **Why explicit closing?** GitHub's `Closes #N` auto-close only works when the PR merges into the repo's *default branch*. Subfeature PRs that merge into a `feature/*` branch will NOT auto-close their linked issues. Always close issues explicitly via MCP tools.

### Assign to Copilot cloud agent (user says "assign to copilot", "cloud agent this")

1. Confirm the issue is well-scoped with clear acceptance criteria
2. **Move the issue to "Ready" status on the project board** (required — the workflow rejects non-Ready issues)
3. Add the `cloud-agent` label to the issue
4. The `cloud-agent-assign.yml` workflow will:
   - Verify the issue is in Ready status (rejects Backlog / No Status / other)
   - Assign @copilot to the issue
   - Update board Status → **In Progress** automatically
   - Update board Work mode → **Cloud Agent** automatically
5. Ensure board status/work mode reflect cloud delegation and link the issue/PR context

> **Do NOT** add the `cloud-agent` label to issues in Backlog — the workflow will remove the label and post a rejection comment.

## Issue hierarchy

- **Epic** (label: `epic`) — Multi-PR deliverable
- **Feature** (label: `feature`) — Concrete deliverable
- **Task** (label: `task`) — Single PR unit of work

### Issue–branch mapping

| Issue type | Label | Branch pattern | PR target |
|---|---|---|---|
| Epic | `epic` | `feature/<topic>` | `main` |
| Task | `task` | `subfeature/task/<description>` | `feature/<topic>` |
| Bug | `bug` | `subfeature/bugfix/<description>` | `feature/<topic>` |
| Refactor | `refactor` | `subfeature/refactor/<description>` | `feature/<topic>` |
| Test | `test` | `subfeature/test/<description>` | `feature/<topic>` |
| Docs | `docs` | `subfeature/docs/<description>` | `feature/<topic>` |
| Chore | `chore` | `subfeature/chore/<description>` | `feature/<topic>` |

When executing an assigned task, identify which `feature/*` branch it belongs to and create the subfeature branch from there.

## Cross-repo awareness

This is the **VS Code Command Center** repo (extension). Related repos:
- Supervisor: `rivie13/Phoenix-Agentic-Workspace-Supervisor`
- Backend: `rivie13/Phoenix-Agentic-Engine-Backend`

This extension depends on the Supervisor's API contract. Changes there may require extension updates.

## Project board

- **Board URL:** https://github.com/users/rivie13/projects/3
- **Columns:** Backlog → Ready → In Progress → In Review → Done

## Focus rules

- One task in-progress at a time
- Use todo list tool to track multi-step work
- Run `npm run verify` before marking any code task complete
- If blocked, document the blocker and switch to next unblocked task
- Update instruction files if the completed work changes architecture or conventions

## Privacy rules

This repo is **private**. Internal details are acceptable in board/issue/PR context, but avoid hardcoding secrets or credentials.
