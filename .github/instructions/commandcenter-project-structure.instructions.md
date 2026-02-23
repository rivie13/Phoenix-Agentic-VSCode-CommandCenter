# Command Center — Project Structure

```
Phoenix-Agentic-VSCode-CommandCenter/
├── .github/
│   ├── instructions/          # Copilot instruction files
│   └── skills/                # Copilot skill files
├── .vscode/
│   ├── launch.json            # Extension Development Host debug config
│   ├── settings.json          # Workspace settings
│   └── tasks.json             # VS Code task definitions
├── docs/
│   ├── ARCHITECTURE.md        # Module boundaries and message flow
│   ├── AGENT_DISPATCH_AUTOMATION_PLAN.md
│   ├── DEPLOYMENT_MODES.md    # Supervisor mode comparison
│   ├── ISSUE_HIERARCHY_TEMPLATE_PLAN.md
│   ├── MARKETPLACE_ROADMAP.md # Marketplace publishing plan
│   ├── WEBHOOK_SETUP.md       # Webhook integration docs
│   └── assets/                # Documentation images
├── media/
│   ├── webview.js             # Core webview state + render orchestration
│   ├── webview.actions.js     # Actions lane rendering
│   ├── webview.agent.js       # Agent session/feed/chat
│   ├── webview.events.js      # DOM event wiring + boot
│   ├── webview.issue-forms.js # Issue/PR form handling
│   ├── webview.pull-requests.js # PR lane rendering
│   ├── webview.css            # Webview styles
│   ├── phoenix-app-icon-mono.svg
│   ├── phoenix-app-icon-mono.png
│   ├── phoenix.svg
│   └── phoenix.png
├── src/
│   ├── extension.ts           # Activation entry point
│   ├── types.ts               # Shared extension host types
│   ├── controller/
│   │   ├── CommandCenterController.ts  # Main controller
│   │   ├── CommandCenterPayloads.ts    # Message type contracts
│   │   ├── issuePullRequestHandlers.ts # Issue/PR command handlers
│   │   └── snapshotPickers.ts          # QuickPick selectors
│   ├── embeddedSupervisor/
│   │   ├── jarvisPollinations.ts       # Embedded Jarvis client
│   │   └── server.ts                   # Embedded supervisor sidecar
│   ├── providers/
│   │   └── CommandCenterViewProvider.ts # WebviewViewProvider
│   ├── services/
│   │   ├── DataService.ts              # GitHub data fetch + cache
│   │   ├── EmbeddedSupervisorManager.ts # Embedded supervisor lifecycle
│   │   ├── GhClient.ts                 # GitHub API wrapper
│   │   ├── JarvisService.ts            # Jarvis voice orchestration
│   │   ├── PollinationsResilience.ts   # Pollinations error handling
│   │   ├── SupervisorStreamClient.ts   # SSE stream reader
│   │   └── WorkspaceSupervisorManager.ts # Workspace supervisor lifecycle
│   └── utils/
│       ├── agentModelCatalog.ts        # Model catalog normalization
│       ├── issueTemplates.ts           # Issue template builder
│       ├── jarvisPrompts.ts            # Jarvis prompt composition
│       ├── transform.ts               # Pure data transformations
│       └── workspace.ts               # Workspace path utilities
├── test/
│   ├── embeddedJarvisPollinations.test.ts
│   ├── jarvisService.test.ts
│   ├── pollinationsResilience.test.ts
│   └── transform.test.ts
├── out/                       # Compiled JS output (gitignored)
├── package.json               # Extension manifest + npm scripts
├── tsconfig.json              # TypeScript configuration
├── LICENSE
└── README.md
```

## Key conventions

- `src/` — Extension host TypeScript (compiled to `out/`)
- `media/` — Webview runtime scripts and assets (served directly)
- `test/` — vitest test files
- `docs/` — Architecture and planning documentation
- `out/` — Compiled output, not committed to git
- Extension manifest and VS Code contribution points live in `package.json`
