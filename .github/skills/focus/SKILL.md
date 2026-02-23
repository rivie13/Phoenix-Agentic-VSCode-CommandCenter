---
name: focus
description: Resume current work, check active task status, start a new task, or mark a task complete in the Command Center repo. Use when user says resume, what am I working on, task done, pick next task, update checkpoint, what's my focus, or starts a new session.
---

# Focus — Phoenix Command Center

## Session start

1. Read `commandcenter-current-task.instructions.md` for task lifecycle rules
2. Read `commandcenter-roadmap.instructions.md` for current phase and priorities
3. Check the GitHub project board for issues assigned or in-progress
4. If a todo list exists, review and resume from last in-progress item

## Ralph Loop lifecycle

```
Identify → Plan → Implement → Verify → Complete → Update
```

Every task follows this closed loop. See `commandcenter-current-task.instructions.md` for details.

## Checking current state

```
# Read current task rules
read_file("Phoenix-Agentic-VSCode-CommandCenter/.github/instructions/commandcenter-current-task.instructions.md")

# Read roadmap for priority context
read_file("Phoenix-Agentic-VSCode-CommandCenter/.github/instructions/commandcenter-roadmap.instructions.md")

# Check for open PRs
tool_search_tool_regex({ pattern: "mcp_github" })
mcp_github_github_list_pull_requests({ owner: "rivie13", repo: "Phoenix-Agentic-VSCode-CommandCenter", state: "open" })

# Check for assigned issues
mcp_github_github_list_issues({ owner: "rivie13", repo: "Phoenix-Agentic-VSCode-CommandCenter", state: "open" })
```

## Focus rules

- One task in-progress at a time
- Use todo list tool to track multi-step work
- Run `npm run verify` before marking any code task complete
- If blocked, document the blocker and switch to next unblocked task
- Update instruction files if the completed work changes architecture or conventions
