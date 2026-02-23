---
name: phase-planning
description: Navigate the Command Center roadmap, understand current phase status, plan next tasks, and track what needs to be done. Use when user asks what to work on next, current project status, phase progress, roadmap, task planning, or what's left to do.
---

# Phase Planning — Phoenix Command Center

## Repo Context

This is the **VS Code Command Center** extension (public). See `docs/ARCHITECTURE.md` and `docs/MARKETPLACE_ROADMAP.md` for planning details.

## How to check roadmap

Read the planning docs for full details:

```
read_file("Phoenix-Agentic-VSCode-CommandCenter/docs/ARCHITECTURE.md")
read_file("Phoenix-Agentic-VSCode-CommandCenter/docs/MARKETPLACE_ROADMAP.md")
read_file("Phoenix-Agentic-VSCode-CommandCenter/docs/DEPLOYMENT_MODES.md")
read_file("Phoenix-Agentic-VSCode-CommandCenter/docs/AGENT_DISPATCH_AUTOMATION_PLAN.md")
read_file("Phoenix-Agentic-VSCode-CommandCenter/.github/instructions/commandcenter-roadmap.instructions.md")
```

## Key docs

| File | Purpose |
|------|---------|
| `docs/ARCHITECTURE.md` | Module boundaries, message flow |
| `docs/DEPLOYMENT_MODES.md` | Supervisor mode comparison |
| `docs/MARKETPLACE_ROADMAP.md` | Marketplace publishing plan |
| `docs/AGENT_DISPATCH_AUTOMATION_PLAN.md` | Agent dispatch design |
| `docs/ISSUE_HIERARCHY_TEMPLATE_PLAN.md` | Issue hierarchy templates |
| `docs/WEBHOOK_SETUP.md` | Webhook integration |

## Using VS Code tasks for development

- `Command Center: Install` — Install dependencies
- `Command Center: Verify` — Lint + test + compile
- `Command Center: Watch` — Dev mode with watch
- `Command Center: Package VSIX` — Build distributable
- `Command Center: Install VSIX` — Install into VS Code

## Working principles

1. Read `docs/` before starting any new task
2. Keep changes scoped to one task at a time
3. View logic stays in `media/` — write/API logic in `src/`
4. All message types go through `CommandCenterPayloads.ts`
5. Supervisor integration is the primary data source — not direct GitHub polling
6. Tests must be deterministic and VS Code API-free
