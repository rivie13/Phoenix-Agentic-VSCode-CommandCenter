---
name: github-code-review
description: Fetch and address GitHub pull request code review comments for the Command Center repo, including Copilot code reviews. Use when user asks to get review feedback, address review comments, fix review issues, request a code review, check PR reviews, or respond to reviewer feedback.
---

# GitHub Code Review — Phoenix Command Center

## Repo Context

| Field | Value |
|-------|-------|
| Repo  | `rivie13/Phoenix-Agentic-VSCode-CommandCenter` |
| Owner | `rivie13` |
| Visibility | Public |

## CRITICAL — Use GitHub MCP tools only

**NEVER** use `gh` CLI. Load and use:

```
tool_search_tool_regex({ pattern: "mcp_github" })
```

Key tools:
- `mcp_github_github_pull_request_read` — read PR details and reviews
- `mcp_github_github_pull_request_review_write` — submit a review
- `mcp_github_github_request_copilot_review` — request Copilot review
- `mcp_github_github_add_reply_to_pull_request_comment` — reply to review comments
- `mcp_github_github_push_files` — push fixes

## Review workflow

1. **Read the PR** and all review comments
2. **Categorize** each comment: must-fix, suggestion, nit, question
3. **Address must-fix items first** — make code changes
4. **Reply to each comment** with what was done or why it was declined
5. **Run `npm run verify`** after all changes
6. **Push fixes** via MCP tools
7. **Re-request review** if needed

## Review focus areas for this repo

- [ ] Write logic stays in `src/`, view logic in `media/`
- [ ] Message payloads typed in `CommandCenterPayloads.ts`
- [ ] Disposables properly registered
- [ ] No VS Code API leaks into webview scripts
- [ ] Tests added for new pure logic
- [ ] No hardcoded secrets or tokens
- [ ] Webview CSP maintained
