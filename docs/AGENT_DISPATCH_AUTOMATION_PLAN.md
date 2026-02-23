# Agent Dispatch Automation Plan

This plan documents dispatch semantics for local and multi-worktree CLI automation.

## Dispatch Modes

- `local`: run a CLI agent in the current VS Code worktree and branch.
- `cli` / `cloud`: run an agent in a targeted repository/branch/workspace selected by supervisor policy.

## Local Dispatch Semantics

- The extension should send `transport=local` with no explicit branch/repo/workspace unless the user overrides.
- The extension resolves current workspace context from the active Git repository:
  - repo slug from `origin` remote
  - current branch from HEAD
  - workspace from repository root path
- Supervisor receives these resolved values and starts the local CLI agent in that exact context.

## Multi-Worktree CLI Dispatch

Supervisor can dispatch CLI agents to different worktrees/branches by:

1. Ensuring target worktree exists for `repo + branch`.
2. Launching CLI process with working directory set to target worktree path.
3. Emitting agent session metadata back to extension (`repository`, `branch`, `workspace`).

Recommended controls:

- Workspace allowlist for dispatch targets.
- Concurrency and queue limits per user/repo.
- Branch protection awareness for merge operations.

## Session UX Requirements

- Sessions should be openable as editor tabs for side-by-side monitoring.
- Session documents should refresh on snapshot updates.
- Session metadata must always include repository/branch/workspace to make dispatch provenance explicit.

## Future Enhancements

- Explicit "Dispatch to worktree" form in extension (repo + branch + workspace selector).
- Supervisor-created ephemeral worktrees for branch isolation.
- Auto-cleanup policy for stale worktrees.
