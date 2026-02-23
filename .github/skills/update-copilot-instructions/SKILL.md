---
name: update-copilot-instructions
description: Update Copilot instruction files to reflect current Command Center project state, architecture, phase progress, or conventions. Use when user asks to update instructions, refresh copilot context, sync instruction files with current reality, or update architecture/roadmap documentation in instruction files.
---

# Update Copilot Instructions — Phoenix Command Center

## Repo Context

All instruction files live in:
```
Phoenix-Agentic-VSCode-CommandCenter/.github/instructions/
```

## Instruction file inventory

| File | Purpose |
|------|---------|
| `commandcenter-architecture.instructions.md` | Module topology, message flow, supervisor integration |
| `commandcenter-build-and-test.instructions.md` | Build, test, lint, verify, VSIX packaging |
| `commandcenter-code-review.instructions.md` | Code review checklist |
| `commandcenter-coding-conventions.instructions.md` | TypeScript CommonJS style, VS Code patterns, webview conventions |
| `commandcenter-current-task.instructions.md` | Ralph Loop lifecycle, task tracking |
| `commandcenter-git-hygiene.instructions.md` | Branch strategy, PR flow, commit rules |
| `commandcenter-project-structure.instructions.md` | Directory layout reference |
| `commandcenter-roadmap.instructions.md` | Phase progress, milestone tracking |
| `commandcenter-strategy.instructions.md` | Feature placement, supervisor mode strategy |

## Update workflow

1. **Read the target instruction file** to understand current state
2. **Gather current truth** from source code, docs, `package.json`, and `tsconfig.json`
3. **Apply the update** using `replace_string_in_file` — never rewrite entire files unnecessarily
4. **Verify** the changes are consistent and accurate

## Common update triggers

- New source file or module added → update `commandcenter-project-structure.instructions.md`
- Build command changed → update `commandcenter-build-and-test.instructions.md`
- Architectural decision change → update `commandcenter-architecture.instructions.md`
- Phase milestone completed → update `commandcenter-roadmap.instructions.md`
- New coding pattern adopted → update `commandcenter-coding-conventions.instructions.md`
- New webview script added → update `commandcenter-project-structure.instructions.md` and `commandcenter-architecture.instructions.md`
- New command or setting added → update `commandcenter-architecture.instructions.md`

## Rules

- Only update instruction files when the actual project state has changed
- Keep instruction content factual and verifiable from source
- Preserve the existing format and section structure
- Do not add speculative or aspirational content to instruction files
- Instruction files document **what is**, not **what will be**
