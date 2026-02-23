---
name: load-commandcenter-instructions
description: Load Command Center repo instruction files into context. Use when working on Command Center code and needing coding conventions, build instructions, project structure, architecture, roadmap, or strategy context for the VS Code extension.
---

# Load Command Center Instructions

## When to use

Call this skill when you need context about the Command Center repo's conventions, architecture, build process, or project structure before making changes.

## Instruction files

Read one or more of these files depending on what context you need:

```
read_file("Phoenix-Agentic-VSCode-CommandCenter/.github/instructions/commandcenter-architecture.instructions.md")
read_file("Phoenix-Agentic-VSCode-CommandCenter/.github/instructions/commandcenter-build-and-test.instructions.md")
read_file("Phoenix-Agentic-VSCode-CommandCenter/.github/instructions/commandcenter-code-review.instructions.md")
read_file("Phoenix-Agentic-VSCode-CommandCenter/.github/instructions/commandcenter-coding-conventions.instructions.md")
read_file("Phoenix-Agentic-VSCode-CommandCenter/.github/instructions/commandcenter-current-task.instructions.md")
read_file("Phoenix-Agentic-VSCode-CommandCenter/.github/instructions/commandcenter-git-hygiene.instructions.md")
read_file("Phoenix-Agentic-VSCode-CommandCenter/.github/instructions/commandcenter-project-structure.instructions.md")
read_file("Phoenix-Agentic-VSCode-CommandCenter/.github/instructions/commandcenter-roadmap.instructions.md")
read_file("Phoenix-Agentic-VSCode-CommandCenter/.github/instructions/commandcenter-strategy.instructions.md")
```

## Quick reference

| File | When to load |
|------|-------------|
| `commandcenter-architecture.instructions.md` | Understanding module boundaries, message flow |
| `commandcenter-build-and-test.instructions.md` | Building, testing, packaging VSIX |
| `commandcenter-code-review.instructions.md` | Reviewing a PR |
| `commandcenter-coding-conventions.instructions.md` | Writing new code, naming, patterns |
| `commandcenter-current-task.instructions.md` | Starting or tracking a task |
| `commandcenter-git-hygiene.instructions.md` | Branch, commit, PR workflow |
| `commandcenter-project-structure.instructions.md` | Finding files, understanding layout |
| `commandcenter-roadmap.instructions.md` | Planning, priority context |
| `commandcenter-strategy.instructions.md` | Feature placement decisions |
