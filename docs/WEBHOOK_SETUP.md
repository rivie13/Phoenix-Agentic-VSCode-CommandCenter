# Webhook Setup (Realtime)

The extension receives realtime updates from supervisor SSE.  
Supervisor must receive GitHub webhook deliveries.

## Preferred Path: Cloudflared + Configure Script

1. Start supervisor locally (`Supervisor: Dev` task in supervisor repo).
2. Start tunnel (`Supervisor: Cloudflared Tunnel` task).
3. Copy the public `https://...trycloudflare.com` URL printed by cloudflared.
4. (Optional) run `Supervisor: Generate Webhook Secret` first, or let the configure task create it.
5. Optional for shared/hosted supervisor: set `SUPERVISOR_API_TOKEN` in supervisor `.env`.
6. Run `Supervisor: Configure GitHub Webhooks` and paste URL.
   - Uses repos from supervisor `PHOENIX_REPOSITORIES` when set.
   - If `PHOENIX_REPOSITORIES` is not set, supervisor falls back to its built-in default repo list.
   - Reads `GITHUB_WEBHOOK_SECRET` from supervisor `.env`.
7. Verify:
   - `http://127.0.0.1:8787/healthz`
   - `lastWebhookAt` and `webhookEventsReceived` update after deliveries.

## Manual Webhook Configuration

For each repo, configure webhook:

- Payload URL: `https://<public-url>/webhooks/github`
- Content type: `application/json`
- Secret: same as supervisor `GITHUB_WEBHOOK_SECRET`
- Events: `issues`, `pull_request`, `workflow_run`, `workflow_job` (plus related events your workflow needs)

## Extension Settings For Realtime

- `phoenixOps.useSupervisorStream=true`
- `phoenixOps.allowDirectGhPollingFallback=false`
- `phoenixOps.supervisorBaseUrl=http://127.0.0.1:8787` (or your hosted supervisor URL)
- Optional auth: set `phoenixOps.supervisorAuthToken` to match supervisor `SUPERVISOR_API_TOKEN`

Sign-in UX:

- Click `Sign In` in the Command Center top bar, or run task `Command Center: GitHub OAuth Sign-In`.

## Common Failure Modes

- Webhook secret mismatch: supervisor returns `401` for deliveries.
- Tunnel URL changed: rerun webhook configure task.
- Supervisor not running: extension shows supervisor unavailable status.
- Missing GitHub permissions on repo/org webhooks: events are not delivered.
