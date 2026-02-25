# PRIORITY — Board-Driven Task Context

## Single source of truth

Use the **Phoenix Project Board** as the only task state source:

- Board URL: https://github.com/users/rivie13/projects/3
- Status flow: Backlog → Ready → Claimed → In Progress → QA Required → QA Feedback → In Review → Done

Do not use local filesystem artifacts for coordination.

## Session start behavior

At the start of each session:

1. Confirm the assigned issue/task from the incoming execution context (dispatcher prompt, local user instruction, or cloud assignment context).
2. Verify the assignment exists on the board and confirm lock/dependency eligibility (`Area`, `Lock Key`, `Needed Files`, `Depends On`).
3. Study the assignment context (issue body, acceptance criteria, linked PR/comments, dependency notes) before implementation.
4. Execute the assignment and report checkpoints to board/issue/PR context.

If a side task appears, treat it as a separate board item and keep references explicit via issue links/sub-issues.

If no assignment is explicit, ask for assignment clarification (or only then select a ready unblocked item).

## Concurrent task awareness

Use board-native concurrency controls only:

- Check active overlaps on `Lock Key` / `Needed Files` / `Area`.
- Verify all `Depends On` prerequisites are complete.
- If conflict/block exists, stop and report blocker context to the user.

## Task lifecycle (Ralph Loop)

The loop is board-driven:

1. **Confirm Assignment**: identify assigned issue from dispatcher/local/cloud context and verify board linkage
2. **Study + Work**: review assignment context, implement task, and post progress on board/issue/PR context
3. **Complete**: verify acceptance criteria and move status to In Review/Done
4. **Next**: publish completion and await the next assignment

## Issue hierarchy

Use GitHub sub-issues for structured work: **Epic** → **Feature** → **Task**. Sub-issues can cross repos.

## Cloud agent assignment

`cloud-agent` labeling remains gated by board readiness:

- Issue must be in **Ready** status
- Workflow assigns Copilot and updates board to In Progress + Cloud Agent mode

## Agent responsibilities — branches, PRs, issues

Agents must manage their own git lifecycle:

- Create branch, commit, push, open PR, and close issues explicitly
- Update board metadata/status as work progresses
- Release lock metadata on completion/failure/abandon

Human actions should be limited to merge decisions (and conflict resolution when needed).

## Cross-repo coordination

When work depends on other repos:

- Model dependency on the board/issue links (sub-issues, `Depends On`)
- Do not rely on local files for cross-repo state
- Related repos: Supervisor (`rivie13/Phoenix-Agentic-Workspace-Supervisor`), Backend (`rivie13/Phoenix-Agentic-Engine-Backend`)

## Privacy

This repo is **public**. Keep progress notes, issues, and PR text free of secrets or private strategy details.
