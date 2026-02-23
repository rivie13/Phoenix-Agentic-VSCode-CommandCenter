# Command Center — Roadmap

## Current Status

The Command Center is a functional VS Code extension providing:
- Project board view with issue lanes and status management
- GitHub Actions monitoring with retry/log insights
- Pull request management with review insights and comment panel
- Agent dispatch and session monitoring via supervisor integration
- Jarvis voice assistant with auto-announcements
- QA handoff workflow via MCP tool integration
- Issue and PR creation forms with template support
- Workspace and embedded supervisor mode support

## Milestone Tracking

### Phase A — Core Dashboard (Completed)

- [x] Webview-based sidebar with board, actions, PR tabs
- [x] GitHub authentication and GraphQL data service
- [x] Supervisor SSE stream integration
- [x] Board snapshot display with status lanes
- [x] Actions run monitoring and retry
- [x] PR listing with review insights

### Phase B — Agent Integration (Completed)

- [x] Agent workspace panel in secondary sidebar
- [x] Session feed and chat timeline
- [x] Composer payload assembly for agent dispatch
- [x] Model catalog and hub configuration
- [x] Supervisor stream client with reconnect

### Phase C — Jarvis Voice Assistant (Completed)

- [x] Pollinations API integration for text + speech
- [x] Auto-announcement scheduling based on supervisor state
- [x] Manual mode toggle
- [x] Conversation history retention
- [x] Resilience and cooldown handling

### Phase D — QA & Issue Management (In Progress)

- [x] QA handoff workflow via supervisor
- [x] Issue creation with template support
- [x] PR creation and merge commands
- [ ] Issue hierarchy templates
- [ ] Enhanced QA approval UI

### Phase E — Marketplace Readiness (Planned)

- [ ] VSIX packaging and distribution pipeline
- [ ] Marketplace listing preparation
- [ ] User-facing documentation
- [ ] Settings UX polish
- [ ] Telemetry opt-in

## Planning Docs

| Document | Purpose |
|----------|---------|
| `docs/ARCHITECTURE.md` | Module boundaries, message flow |
| `docs/DEPLOYMENT_MODES.md` | Supervisor mode comparison |
| `docs/MARKETPLACE_ROADMAP.md` | Marketplace publishing plan |
| `docs/AGENT_DISPATCH_AUTOMATION_PLAN.md` | Agent dispatch design |
| `docs/ISSUE_HIERARCHY_TEMPLATE_PLAN.md` | Issue hierarchy design |
| `docs/WEBHOOK_SETUP.md` | Webhook integration |
