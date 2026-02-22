import * as vscode from "vscode";

export interface ViewMessage {
  type: string;
  command?: string;
  url?: string;
}

export class CommandCenterViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "phoenixOps.commandCenter";

  private view: vscode.WebviewView | null = null;
  private readonly messageEmitter = new vscode.EventEmitter<ViewMessage>();

  readonly onMessage = this.messageEmitter.event;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "media")
      ]
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message: ViewMessage) => {
      this.messageEmitter.fire(message);
    });
  }

  async postMessage(type: string, payload: unknown): Promise<void> {
    if (!this.view) {
      return;
    }

    await this.view.webview.postMessage({ type, payload });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "webview.js"));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "webview.css"));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${cssUri}" />
  <title>Phoenix Command Center</title>
</head>
<body>
  <div class="topbar">
    <div class="statusline">
      <span id="connStatus" class="status-pill warn">Waiting</span>
      <span id="dataSource">Source: unknown</span>
      <span>Updated: <span id="updatedAt">--</span></span>
    </div>
    <div>
      <button id="refreshButton">Refresh</button>
    </div>
  </div>

  <div class="controls">
    <label>Repo <select id="repoFilter"></select></label>
    <label>Status <select id="laneFilter"></select></label>
    <label>Work mode <select id="workModeFilter"></select></label>
    <label>Assignee <select id="assigneeFilter"></select></label>
    <button id="createIssueButton">Create Issue</button>
    <button id="updateFieldButton">Update Field</button>
    <button id="updateLabelsButton">Update Labels</button>
  </div>

  <div class="layout">
    <div>
      <section class="panel">
        <h3>Board</h3>
        <div id="boardLanes" class="board-lanes"></div>
      </section>
      <section class="panel" style="margin-top: 10px;">
        <h3>Actions</h3>
        <div class="actions-grid">
          <div id="actionsQueued"></div>
          <div id="actionsInProgress"></div>
          <div id="actionsNeedsAttention"></div>
        </div>
      </section>
    </div>
    <div id="detailPanel"></div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
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
