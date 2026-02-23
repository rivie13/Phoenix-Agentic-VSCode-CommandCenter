# Marketplace Readiness Roadmap

This document tracks publish readiness while keeping local-first workflows and legacy compatibility intact.

## Current Capability Snapshot

- Supervisor-first realtime is supported.
- Embedded supervisor sidecar support is implemented (`embeddedSupervisorEnabled`).
- Optional direct `gh` fallback mode is supported.
- Generic repo discovery mode (`workspaceGitRemotes`) is available.
- Legacy discovery mode (`phoenixWorkspace`) remains for backward compatibility.
- Agent control surface is implemented (session feed, dispatch, approvals, QA handoff flow).
- Jarvis text + voice supervisor features are implemented with configurable Pollinations settings.
- Pollinations sign-in command now targets `https://credipollinations.ai/`.

## Remaining Publish Work

1. Finalize store metadata and release docs
   - Add marketplace-oriented badges/screenshots/changelog cadence.
   - Keep README command/settings tables synchronized with package contributions.

2. Add first-run onboarding workflow
   - Check `gh` auth, supervisor URL, repo discovery mode, and Jarvis API key status.
   - Surface guided remediation from inside the webview when checks fail.

3. Harden hosted/shared supervisor usage
   - Keep bearer token support as baseline.
   - Add deployment guidance for reverse proxy, rate limits, and observability.

4. Automate packaging + pre-release flow
   - CI build/test/package (`vsce`) on tagged commits.
   - Publish pre-release channel before stable.

5. Complete Pollinations app-tier submission for support credits
   - Submit: `https://github.com/pollinations/pollinations/issues/new?template=tier-app-submission.yml`
   - Keep published extension metadata aligned with submission details.

## Non-Breaking Strategy

- Keep current behavior intact for existing users.
- Keep legacy discovery mode available.
- Recommend generic defaults for new users:
  - `phoenixOps.repositoryDiscoveryMode=workspaceGitRemotes`
  - `phoenixOps.useSupervisorStream=true`
  - `phoenixOps.allowDirectGhPollingFallback=false`
