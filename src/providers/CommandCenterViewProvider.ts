import * as vscode from "vscode";

export interface ViewMessage {
  type: string;
  command?: string;
  url?: string;
}

export interface ViewMessageEnvelope {
  message: ViewMessage;
  webview: vscode.Webview;
}

export interface ViewBootConfig {
  mode?: "full" | "agent-only";
  lockedSessionId?: string | null;
}

export class CommandCenterViewProvider implements vscode.WebviewViewProvider {
  public static readonly boardViewType = "phoenixOps.commandCenter";
  public static readonly agentViewType = "phoenixOps.agentWorkspace";

  private view: vscode.WebviewView | null = null;
  private readonly messageEmitter = new vscode.EventEmitter<ViewMessageEnvelope>();

  readonly onMessage = this.messageEmitter.event;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly defaultMode: "full" | "agent-only"
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.extensionUri,
        vscode.Uri.joinPath(this.extensionUri, "media")
      ]
    };

    webviewView.webview.html = this.getHtml(webviewView.webview, { mode: this.defaultMode, lockedSessionId: null });
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = null;
      }
    });
    webviewView.webview.onDidReceiveMessage((message: ViewMessage) => {
      this.messageEmitter.fire({
        message,
        webview: webviewView.webview
      });
    });
  }

  async postMessage(type: string, payload: unknown): Promise<void> {
    if (!this.view) {
      return;
    }

    await this.view.webview.postMessage({ type, payload });
  }

  show(preserveFocus = false): boolean {
    if (!this.view) {
      return false;
    }
    this.view.show(preserveFocus);
    return true;
  }

  hasView(): boolean {
    return Boolean(this.view);
  }

  ownsWebview(webview: vscode.Webview | undefined): boolean {
    return Boolean(this.view && webview && this.view.webview === webview);
  }

  public getHtml(webview: vscode.Webview, boot: ViewBootConfig = { mode: "full", lockedSessionId: null }): string {
    const nonce = createNonce();
    const scriptUris = [
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "node_modules", "@xterm", "xterm", "lib", "xterm.js")),
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "node_modules", "@xterm", "addon-fit", "lib", "addon-fit.js")),
      "webview.js",
      "webview.issue-forms.js",
      "webview.actions.js",
      "webview.pull-requests.js",
      "webview.agent.js",
      "webview.events.js"
    ].map((entry) => {
      if (typeof entry === "string") {
        return webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", entry));
      }
      return entry;
    });
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "webview.css"));
    const xtermCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "node_modules", "@xterm", "xterm", "css", "xterm.css")
    );
    const bodyClass = boot.mode === "agent-only" ? "agent-only" : "full-mode";
    const bootJson = JSON.stringify({
      mode: boot.mode ?? "full",
      lockedSessionId: boot.lockedSessionId ?? null
    }).replace(/</g, "\\u003c");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; media-src ${webview.cspSource} data: blob:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${cssUri}" />
  <link rel="stylesheet" href="${xtermCssUri}" />
  <title>Phoenix Command Center</title>
</head>
<body class="${bodyClass}">
  <div class="topbar">
    <div class="statusline">
      <span id="connStatus" class="status-pill warn">Waiting</span>
      <span id="dataSource">Source: unknown</span>
      <span>Updated: <span id="updatedAt">--</span></span>
      <span id="jarvisStatus">Jarvis: initializing</span>
      <span id="jarvisFocus" class="meta-line"></span>
    </div>
    <details id="opsSettingsSection" class="topbar-settings foldout">
      <summary class="foldout-summary topbar-settings-summary">
        <span class="lane-title">Ops Settings and Tools</span>
        <span class="meta-line">Sign-in, supervisor, and model controls</span>
      </summary>
      <div class="foldout-body topbar-settings-body">
        <div class="topbar-actions">
          <button id="signInButton">Sign In</button>
          <button id="signInCodexButton">Codex CLI</button>
          <button id="signInCopilotButton">Copilot CLI</button>
          <button id="geminiSignInButton">Gemini Key Portal</button>
          <button id="geminiApiKeyButton">Set Gemini Key</button>
          <button id="pollinationsSignInButton">Pollinations Sign In</button>
          <button id="pollinationsApiKeyButton">Set Pollinations Key</button>
          <button id="configureSupervisorButton">Supervisor Mode</button>
          <button id="configureModelHubButton">Model Hub</button>
          <button id="openAgentWorkspacePanelButton">Open Right Agent Panel</button>
          <button id="refreshButton">Refresh</button>
        </div>
      </div>
    </details>
  </div>

  <details id="workspaceControlsSection" class="panel foldout controls-foldout" open>
    <summary class="foldout-summary">
      <span class="lane-title">Filters and Commands</span>
      <span class="meta-line">Workspace controls</span>
    </summary>
    <div class="foldout-body">
      <div class="controls">
        <div class="field">
          <label for="repoFilter">Repo</label>
          <select id="repoFilter"></select>
        </div>
        <div class="field">
          <label for="laneFilter">Status</label>
          <select id="laneFilter"></select>
        </div>
        <div class="field">
          <label for="workModeFilter">Work mode</label>
          <select id="workModeFilter"></select>
        </div>
        <div class="field">
          <label for="assigneeFilter">Assignee</label>
          <select id="assigneeFilter"></select>
        </div>
        <div class="field">
          <label for="backgroundModeSelect">Background</label>
          <select id="backgroundModeSelect">
            <option value="gradient">Animated Gradient</option>
            <option value="solid">Solid</option>
          </select>
        </div>
        <div class="field">
          <label for="colorSchemeSelect">Color Scheme</label>
          <select id="colorSchemeSelect"></select>
        </div>
        <div class="field color-input-field">
          <label>Theme Colors</label>
          <div class="color-input-row">
            <input id="themeColorOneInput" type="color" title="Color 1" />
            <input id="themeColorTwoInput" type="color" title="Color 2" />
            <input id="themeColorThreeInput" type="color" title="Color 3" />
          </div>
        </div>
        <div class="field">
          <label for="customSchemeNameInput">Custom Scheme</label>
          <div class="inline-actions compact">
            <input id="customSchemeNameInput" type="text" placeholder="My Scheme" />
            <button id="saveCustomSchemeButton">Save Scheme</button>
          </div>
        </div>
      </div>
    </div>
  </details>

  <div class="layout">
    <div id="leftWorkspacePane" class="workspace-pane">
      <section class="panel workspace-tabs-panel">
        <div class="workspace-tabs-header">
          <div class="inline-actions">
            <button id="collapseAllLeftSections">Collapse Sections</button>
            <button id="expandAllLeftSections">Expand Sections</button>
          </div>
        </div>
        <div class="workspace-tabs" role="tablist" aria-label="Command Center Sections">
          <button id="workspaceTabBoard" class="workspace-tab" type="button" role="tab" data-workspace-tab="board" aria-controls="boardSection">Ops Center</button>
          <button id="workspaceTabIssues" class="workspace-tab" type="button" role="tab" data-workspace-tab="issues" aria-controls="issuesSection">Issues</button>
          <button id="workspaceTabActions" class="workspace-tab" type="button" role="tab" data-workspace-tab="actions" aria-controls="actionsSection">Actions</button>
          <button id="workspaceTabPullRequests" class="workspace-tab" type="button" role="tab" data-workspace-tab="pullRequests" aria-controls="pullRequestsSection">PRs</button>
        </div>
      </section>

      <section id="boardSection" class="panel board-panel tab-panel active-tab" data-tab-panel="board">
        <div class="board-toolbar">
          <div class="lane-title">Ops Center</div>
          <div class="inline-actions">
            <button id="collapseAllLanes">Collapse All</button>
            <button id="expandAllLanes">Expand All</button>
          </div>
          <div id="boardCounts" class="meta-line"></div>
        </div>
        <section class="panel nested-panel">
          <div class="board-toolbar">
            <h3>Board</h3>
            <span id="boardCountsSummary" class="meta-line"></span>
          </div>
          <div id="boardLanes" class="board-lanes"></div>
        </section>
        <section class="panel nested-panel">
          <div class="board-toolbar">
            <h3>Pull Request Overview</h3>
            <div class="inline-actions">
              <button id="openPullRequestsTabFromOps" class="lane-action" type="button">Open PR Tab</button>
            </div>
          </div>
          <div id="opsPullRequestCounts" class="meta-line"></div>
          <div class="actions-grid ops-overview-grid">
            <div id="opsPullRequestsReview"></div>
            <div id="opsPullRequestsChanges"></div>
            <div id="opsPullRequestsReady"></div>
          </div>
        </section>
        <section class="panel nested-panel">
          <div class="board-toolbar">
            <h3>Actions Overview</h3>
            <div class="inline-actions">
              <button id="openActionsTabFromOps" class="lane-action" type="button">Open Actions Tab</button>
            </div>
          </div>
          <div id="opsActionCounts" class="meta-line"></div>
          <div class="actions-grid ops-overview-grid">
            <div id="opsActionsQueued"></div>
            <div id="opsActionsInProgress"></div>
            <div id="opsActionsNeedsAttention"></div>
          </div>
        </section>
      </section>

      <details id="issuesSection" class="panel foldout board-panel tab-panel" data-tab-panel="issues" open>
        <summary class="foldout-summary">
          <span class="lane-title">Issues</span>
          <span id="issueWorkbenchCountsSummary" class="meta-line"></span>
        </summary>
        <div class="foldout-body">
          <div class="board-toolbar">
            <div class="inline-actions">
              <button id="createIssueInIssuesButton">Create Issue</button>
              <button id="updateFieldInIssuesButton">Update Field</button>
              <button id="updateLabelsInIssuesButton">Update Labels</button>
            </div>
            <div id="issueWorkbenchCounts" class="meta-line"></div>
          </div>
          <section id="issueCreateFormPanel" class="panel nested-panel issue-create-panel">
            <h3>Create Issue</h3>
            <div class="form-grid issue-template-grid">
              <div class="field">
                <label for="issueCreateRepoSelect">Repository</label>
                <select id="issueCreateRepoSelect"></select>
              </div>
              <div class="field">
                <label for="issueCreateTypeSelect">Type</label>
                <select id="issueCreateTypeSelect">
                  <option value="Epic">Epic</option>
                  <option value="Feature">Feature</option>
                  <option value="Subfeature">Subfeature</option>
                </select>
              </div>
              <div class="field form-span-all">
                <label for="issueCreateTitleInput">Title</label>
                <input id="issueCreateTitleInput" type="text" placeholder="Task: ..." />
              </div>
              <div class="field form-span-all">
                <label for="issueCreateParentLinksInput">Parent Links</label>
                <textarea id="issueCreateParentLinksInput" rows="2" placeholder="Epic link for Feature, Feature link for Subfeature"></textarea>
              </div>
              <div class="field">
                <label for="issueCreateBaseBranchInput">Base Branch</label>
                <input id="issueCreateBaseBranchInput" type="text" placeholder="main" />
              </div>
              <div class="field">
                <label for="issueCreatePlannedBranchInput">Planned Branch Name</label>
                <input id="issueCreatePlannedBranchInput" type="text" placeholder="subfeat/area-short-slug" />
              </div>
              <div class="field form-span-all">
                <label for="issueCreateBranchReasonInput">Reason If Branch Convention Differs</label>
                <input id="issueCreateBranchReasonInput" type="text" placeholder="Optional" />
              </div>
              <div class="field form-span-all">
                <label for="issueCreateLabelSelect">Labels</label>
                <select id="issueCreateLabelSelect" multiple size="6"></select>
                <div id="issueCreateLabelMeta" class="meta-line secondary"></div>
              </div>
              <div class="field form-span-all">
                <label for="issueCreateCustomLabelsInput">Custom Labels</label>
                <input id="issueCreateCustomLabelsInput" type="text" placeholder="Comma-separated labels not listed above" />
              </div>
              <div class="field form-span-all">
                <label for="issueCreateProblemInput">Problem Statement</label>
                <textarea id="issueCreateProblemInput" rows="3" placeholder="What problem are we solving?"></textarea>
              </div>
              <div class="field form-span-all">
                <label for="issueCreateScopeInInput">Scope In</label>
                <textarea id="issueCreateScopeInInput" rows="3" placeholder="What is in scope?"></textarea>
              </div>
              <div class="field form-span-all">
                <label for="issueCreateScopeOutInput">Scope Out</label>
                <textarea id="issueCreateScopeOutInput" rows="2" placeholder="What is out of scope?"></textarea>
              </div>
              <div class="field form-span-all">
                <label for="issueCreateDoneInput">Definition of Done</label>
                <textarea id="issueCreateDoneInput" rows="3" placeholder="Objective completion criteria"></textarea>
              </div>
              <div class="field form-span-all">
                <label for="issueCreateDependenciesInput">Dependencies</label>
                <textarea id="issueCreateDependenciesInput" rows="2" placeholder="Blocking and blocked-by dependencies"></textarea>
              </div>
              <div class="field form-span-all">
                <label for="issueCreateRisksInput">Risks</label>
                <textarea id="issueCreateRisksInput" rows="2" placeholder="Technical, product, or delivery risks"></textarea>
              </div>
              <div class="field form-span-all">
                <label for="issueCreateValidationInput">Validation Plan</label>
                <textarea id="issueCreateValidationInput" rows="3" placeholder="How this will be verified (tests/manual/metrics)"></textarea>
              </div>
              <div class="field form-span-all">
                <label for="issueCreateAcceptanceInput">Acceptance Criteria / Requirements</label>
                <textarea id="issueCreateAcceptanceInput" rows="3" placeholder="Type-specific acceptance or requirements"></textarea>
              </div>
              <div class="field form-span-all">
                <label for="issueCreateArchitectureInput">Architecture / Impact Summary</label>
                <textarea id="issueCreateArchitectureInput" rows="3" placeholder="Architecture impact, modules, and cross-repo impact"></textarea>
              </div>
              <div class="field form-span-all">
                <label for="issueCreateRolloutInput">Rollout / PR Strategy</label>
                <textarea id="issueCreateRolloutInput" rows="3" placeholder="Rollout strategy, PR strategy, and sequencing"></textarea>
              </div>
              <div class="field form-span-all">
                <label for="issueCreateTaskChecklistInput">Task Checklist</label>
                <textarea id="issueCreateTaskChecklistInput" rows="3" placeholder="- [ ] Task 1"></textarea>
              </div>
              <div class="field">
                <label for="issueCreateStatusSelect">Board Status</label>
                <select id="issueCreateStatusSelect"></select>
              </div>
              <div class="field">
                <label for="issueCreateWorkModeSelect">Work Mode</label>
                <select id="issueCreateWorkModeSelect"></select>
              </div>
              <div class="field">
                <label for="issueCreatePrioritySelect">Priority</label>
                <select id="issueCreatePrioritySelect"></select>
              </div>
              <div class="field">
                <label for="issueCreateSizeSelect">Size</label>
                <select id="issueCreateSizeSelect"></select>
              </div>
              <div class="field">
                <label for="issueCreateAreaSelect">Area</label>
                <select id="issueCreateAreaSelect"></select>
              </div>
              <div class="field form-span-all">
                <label for="issueCreateSuccessMetricsInput">Success Metrics / Milestone Window</label>
                <textarea id="issueCreateSuccessMetricsInput" rows="2" placeholder="Epic-specific metrics and target window"></textarea>
              </div>
              <div class="field form-span-all">
                <label for="issueCreateSuspectedCauseInput">Suspected Cause</label>
                <textarea id="issueCreateSuspectedCauseInput" rows="3" placeholder="Known or suspected cause details"></textarea>
              </div>
              <div class="field form-span-all">
                <label for="issueCreateInvestigationInput">Investigation Notes</label>
                <textarea id="issueCreateInvestigationInput" rows="3" placeholder="Investigation notes and evidence"></textarea>
              </div>
              <div class="field form-span-all">
                <label>AI Assist</label>
                <div class="inline-actions">
                  <button id="issueCreateAiDraftButton" class="lane-action" type="button">AI Draft Issue</button>
                  <button id="issueCreateAiInvestigateButton" class="lane-action" type="button">AI Investigate Cause</button>
                </div>
                <div id="issueCreateAiStatus" class="meta-line secondary"></div>
              </div>
              <div class="field form-span-all">
                <label for="issueCreateBodyInput">Additional Notes</label>
                <textarea id="issueCreateBodyInput" rows="5" placeholder="Optional custom notes appended to the Phoenix template body"></textarea>
              </div>
            </div>
            <div class="inline-actions">
              <button id="submitIssueCreateButton" class="lane-action" type="button">Create Issue</button>
              <button id="cancelIssueCreateButton" class="lane-action" type="button">Cancel</button>
            </div>
            <div id="issueCreateFormStatus" class="meta-line secondary"></div>
          </section>
          <div class="issues-workbench">
            <section class="lane">
              <div class="lane-title">Issue List</div>
              <div id="issuesWorkbenchList" class="lane-cards"></div>
            </section>
            <section class="lane">
              <div class="lane-title">Issue Details</div>
              <div id="issueWorkbenchDetail" class="issue-detail-panel"></div>
            </section>
          </div>
        </div>
      </details>

      <details id="pullRequestsSection" class="panel foldout pr-panel tab-panel" data-tab-panel="pullRequests" open>
        <summary class="foldout-summary">
          <span class="lane-title">Pull Requests</span>
          <span id="pullRequestCountsSummary" class="meta-line"></span>
        </summary>
        <div class="foldout-body">
          <div class="board-toolbar">
            <div class="inline-actions">
              <button id="createPullRequestInPullRequestsButton">Create PR</button>
              <button id="refreshPullRequestsButton">Refresh PRs</button>
              <button id="collapseAllPullRequests">Collapse All</button>
              <button id="expandAllPullRequests">Expand All</button>
            </div>
            <div id="pullRequestCounts" class="meta-line"></div>
          </div>
          <section id="pullRequestCreateFormPanel" class="panel nested-panel pull-request-create-panel">
            <h3>Create Pull Request</h3>
            <div class="form-grid">
              <div class="field">
                <label for="pullRequestCreateRepoSelect">Repository</label>
                <select id="pullRequestCreateRepoSelect"></select>
              </div>
              <div class="field">
                <label for="pullRequestCreateTitleInput">Title</label>
                <input id="pullRequestCreateTitleInput" type="text" placeholder="feat: ..." />
              </div>
              <div class="field">
                <label for="pullRequestCreateHeadInput">Head Branch</label>
                <input id="pullRequestCreateHeadInput" type="text" placeholder="feature/branch-name" />
              </div>
              <div class="field">
                <label for="pullRequestCreateBaseInput">Base Branch</label>
                <input id="pullRequestCreateBaseInput" type="text" placeholder="main" />
              </div>
              <div class="field">
                <label class="toggle-label">
                  <input id="pullRequestCreateDraftInput" type="checkbox" />
                  Create as draft
                </label>
              </div>
              <div class="field form-span-all">
                <label for="pullRequestCreateBodyInput">Body</label>
                <textarea id="pullRequestCreateBodyInput" rows="5" placeholder="Markdown pull request details"></textarea>
              </div>
            </div>
            <div class="inline-actions">
              <button id="submitPullRequestCreateButton" class="lane-action" type="button">Create PR</button>
              <button id="cancelPullRequestCreateButton" class="lane-action" type="button">Cancel</button>
            </div>
            <div id="pullRequestCreateFormStatus" class="meta-line secondary"></div>
          </section>
          <div class="actions-grid">
            <div id="pullRequestsReview"></div>
            <div id="pullRequestsChanges"></div>
            <div id="pullRequestsReady"></div>
          </div>
          <section class="panel nested-panel">
            <h3>Review Insights</h3>
            <div id="pullRequestInsightPanel" class="insight-panel"></div>
          </section>
          <section class="panel nested-panel">
            <h3>Comment on Selected Pull Request</h3>
            <div id="pullRequestCommentPanel" class="insight-panel"></div>
          </section>
        </div>
      </details>

      <details id="actionsSection" class="panel foldout actions-panel tab-panel" data-tab-panel="actions" open>
        <summary class="foldout-summary">
          <span class="lane-title">Actions</span>
          <span id="actionsCountsSummary" class="meta-line"></span>
        </summary>
        <div class="foldout-body">
          <div class="board-toolbar">
            <div class="inline-actions">
              <label class="toggle-label" for="actionsStackMode">Stack</label>
              <select id="actionsStackMode" class="actions-select">
                <option value="workflow-branch-repo">Repo + Branch + Workflow</option>
                <option value="repo-branch">Repo + Branch</option>
                <option value="repo">Repo</option>
                <option value="none">No stacking</option>
              </select>
              <button id="collapseAllActions">Collapse All</button>
              <button id="expandAllActions">Expand All</button>
            </div>
            <div id="actionsCounts" class="meta-line"></div>
          </div>
          <div class="actions-grid">
            <div id="actionsQueued"></div>
            <div id="actionsInProgress"></div>
            <div id="actionsNeedsAttention"></div>
          </div>
          <section class="panel nested-panel">
            <h3>Logs and Retry</h3>
            <div id="actionRunInsightPanel" class="insight-panel"></div>
          </section>
        </div>
      </details>
    </div>
    <div id="rightAgentPane" class="agent-pane">
      <details id="agentSessionsSection" class="panel foldout sessions-foldout" open>
        <summary class="foldout-summary">
          <span class="lane-title">Sessions and Feed</span>
          <span id="sessionCounts" class="meta-line"></span>
        </summary>
        <div class="foldout-body">
          <div class="board-toolbar">
            <div class="inline-actions">
              <button id="collapseAllSessions">Collapse All</button>
              <button id="expandAllSessions">Expand All</button>
            </div>
            <label class="toggle-label">
              <input id="showArchivedSessions" type="checkbox" />
              Show archived
            </label>
            <label class="toggle-label">
              <input id="showOlderSessions" type="checkbox" />
              Show older than 24h
            </label>
          </div>
          <div id="agentSessions" class="agent-sessions"></div>
          <section class="panel nested-panel" style="margin-top: 10px;">
            <h3>Agent Feed</h3>
            <div id="agentFeed" class="agent-feed"></div>
          </section>
        </div>
      </details>
      <details id="agentJarvisSection" class="panel foldout jarvis-foldout" open>
        <summary class="foldout-summary">
          <span class="lane-title">Jarvis Supervisor</span>
          <span id="jarvisSectionMeta" class="meta-line">Meta supervisor status</span>
        </summary>
        <div class="foldout-body">
          <div id="jarvisHubStatus" class="feed-inline">Jarvis: initializing</div>
          <div id="jarvisHubFocus" class="meta-line secondary"></div>
          <div class="inline-actions">
            <button id="jarvisCallButtonHub" class="lane-action" type="button">Ask Jarvis</button>
            <button id="configureJarvisVoiceButtonHub" class="lane-action" type="button">Jarvis TTS</button>
            <button id="jarvisModeButtonHub" class="lane-action" type="button">Jarvis Auto: On</button>
            <button id="jarvisWakeButtonHub" class="lane-action" type="button">Wake Word: Off</button>
          </div>
          <section class="panel nested-panel">
            <h3>Jarvis Feed</h3>
            <div id="jarvisFeed" class="agent-feed"></div>
          </section>
        </div>
      </details>
      <details id="agentTerminalSection" class="panel foldout terminal-foldout" open>
        <summary class="foldout-summary">
          <span class="lane-title">Agent Terminal</span>
          <span id="agentTerminalMeta" class="meta-line">No active terminal session.</span>
        </summary>
        <div class="foldout-body">
          <div id="agentTerminalMount" class="agent-terminal-mount"></div>
        </div>
      </details>
    </div>
  </div>

  <script nonce="${nonce}">window.__PHOENIX_BOOT = ${bootJson};</script>
  ${scriptUris.map((uri) => `<script nonce="${nonce}" src="${uri}"></script>`).join("\n  ")}
</body>
</html>`;
  }
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
