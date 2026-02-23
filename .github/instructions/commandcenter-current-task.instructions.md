# Command Center — Current Task

## Task Lifecycle (Ralph Loop)

Every task follows the **Ralph Loop** — a closed-loop feedback cycle:

```
Identify → Plan → Implement → Verify → Complete → Update
```

### 1. Identify

- Read the linked GitHub issue fully
- Check the project board for current status/signal labels
- Confirm the task is not blocked by another issue

### 2. Plan

- Design the approach before writing code
- For multi-file changes, list affected files and the order of changes
- For webview changes, distinguish between `media/` (view) and `src/` (logic) work

### 3. Implement

- One logical change per commit
- Stay within the scope of the task — do not refactor unrelated code
- Follow conventions in `commandcenter-coding-conventions.instructions.md`

### 4. Verify

- Run `npm run verify` (lint + test + compile) — must pass
- Test the extension in the Extension Development Host (F5) when changes affect UI
- Test webview interactions manually when rendering logic changes

### 5. Complete

- Push the branch and create a PR using GitHub MCP tools
- Link the PR to the originating issue
- Request review if required

### 6. Update

- Update the project board field via Command Center or MCP tools
- Update instruction files if the change affects architecture, conventions, or structure
- Mark the issue as completed after PR is merged

## Focus Rules

- Only one task in-progress at a time
- Use the todo list tool to track multi-step work
- If blocked, document the blocker and switch to the next unblocked task
- Always check `commandcenter-roadmap.instructions.md` for priority context
