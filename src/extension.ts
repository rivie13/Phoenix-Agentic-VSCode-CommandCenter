import * as vscode from "vscode";
import { CommandCenterViewProvider } from "./providers/CommandCenterViewProvider";
import { DataService } from "./services/DataService";
import { GhClient } from "./services/GhClient";
import { SupervisorStreamClient } from "./services/SupervisorStreamClient";
import { ActionRun, BoardItem, DashboardSnapshot, ProjectFieldName, StreamEnvelope } from "./types";
import { applyStreamEnvelope } from "./utils/transform";

const PROJECT_FIELD_NAMES: ProjectFieldName[] = ["Status", "Work mode", "Priority", "Size", "Area"];

class CommandCenterController implements vscode.Disposable {
  private readonly viewProvider: CommandCenterViewProvider;
  private readonly dataService: DataService;
  private readonly streamClient: SupervisorStreamClient;

  private snapshot: DashboardSnapshot | null = null;
  private sequence = 0;
  private pollingTimer: NodeJS.Timeout | null = null;
  private staleTimer: NodeJS.Timeout | null = null;
  private lastUpdatedMs = 0;
  private streamConnected = false;
  private disposed = false;

  constructor(viewProvider: CommandCenterViewProvider, dataService: DataService) {
    this.viewProvider = viewProvider;
    this.dataService = dataService;
    this.streamClient = new SupervisorStreamClient();
  }

  async initialize(): Promise<void> {
    const auth = await this.dataService.checkGhAuth();
    if (!auth.ok) {
      vscode.window.showErrorMessage(`Phoenix Command Center: gh auth is unavailable. ${auth.output}`);
    }

    this.viewProvider.onMessage(async (message) => {
      if (message.type === "ready") {
        if (this.snapshot) {
          await this.pushSnapshot();
        } else {
          await this.refreshNow("startup");
        }
        return;
      }

      if (message.type === "command" && message.command) {
        await vscode.commands.executeCommand(message.command);
        return;
      }

      if (message.type === "openIssue" && message.url) {
        await this.openUrl(message.url);
      }

      if (message.type === "openRun" && message.url) {
        await this.openUrl(message.url);
      }
    });

    await this.refreshNow("startup");
    await this.startDataFlow();
    this.startStaleMonitor();
  }

  async refreshCommand(): Promise<void> {
    await this.refreshNow("manual");
  }

  async createIssueCommand(): Promise<void> {
    const settings = this.dataService.getSettings();
    const repo = await vscode.window.showQuickPick(
      settings.repositories,
      { title: "Create Issue", placeHolder: "Select repository" }
    );
    if (!repo) {
      return;
    }

    const title = await vscode.window.showInputBox({
      title: "Issue Title",
      placeHolder: "Task: ...",
      validateInput: (value) => value.trim().length === 0 ? "Title is required." : undefined
    });
    if (!title) {
      return;
    }

    const body = await vscode.window.showInputBox({
      title: "Issue Body",
      placeHolder: "Markdown body (optional)",
      value: ""
    });
    if (body === undefined) {
      return;
    }

    const labelsCsv = await vscode.window.showInputBox({
      title: "Issue Labels",
      placeHolder: "Comma-separated labels (optional)",
      value: ""
    });
    if (labelsCsv === undefined) {
      return;
    }

    const labels = labelsCsv
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const confirm = await vscode.window.showWarningMessage(
      `Create issue in ${repo}?`,
      { modal: true },
      "Create"
    );
    if (confirm !== "Create") {
      return;
    }

    await this.runWrite(async () => {
      await this.dataService.createIssue(repo, title.trim(), body, labels);
      vscode.window.showInformationMessage(`Issue created in ${repo}.`);
    });
  }

  async updateProjectFieldCommand(): Promise<void> {
    const item = await this.pickBoardItem("Select issue to update project field");
    if (!item) {
      return;
    }

    const selectedField = await vscode.window.showQuickPick(PROJECT_FIELD_NAMES, {
      title: "Update Project Field",
      placeHolder: "Select field"
    });
    if (!selectedField) {
      return;
    }
    const fieldName = selectedField as ProjectFieldName;

    const options = await this.dataService.getFieldOptions(fieldName);
    if (options.length === 0) {
      vscode.window.showWarningMessage(`No options were returned for field '${fieldName}'.`);
      return;
    }

    const selectedOption = await vscode.window.showQuickPick(options, {
      title: `Set ${fieldName}`,
      placeHolder: "Select option"
    });
    if (!selectedOption) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Set ${fieldName} to '${selectedOption}' for #${item.issueNumber}?`,
      { modal: true },
      "Update"
    );
    if (confirm !== "Update") {
      return;
    }

    await this.runWrite(async () => {
      await this.dataService.updateProjectField(item, fieldName, selectedOption);
      vscode.window.showInformationMessage(`Updated ${fieldName} for #${item.issueNumber}.`);
    });
  }

  async updateLabelsCommand(): Promise<void> {
    const item = await this.pickBoardItem("Select issue to update labels");
    if (!item) {
      return;
    }

    const mode = await vscode.window.showQuickPick(["Add labels", "Remove labels"], {
      title: `Update Labels for #${item.issueNumber}`,
      placeHolder: "Choose action"
    });
    if (!mode) {
      return;
    }

    const rawLabels = await vscode.window.showInputBox({
      title: mode,
      placeHolder: "Comma-separated label names",
      validateInput: (value) => value.trim().length === 0 ? "At least one label is required." : undefined
    });
    if (!rawLabels) {
      return;
    }

    const labels = rawLabels
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (labels.length === 0) {
      return;
    }

    const addLabels = mode === "Add labels" ? labels : [];
    const removeLabels = mode === "Remove labels" ? labels : [];

    const confirm = await vscode.window.showWarningMessage(
      `${mode} on #${item.issueNumber}? (${labels.join(", ")})`,
      { modal: true },
      "Apply"
    );
    if (confirm !== "Apply") {
      return;
    }

    await this.runWrite(async () => {
      await this.dataService.updateLabels(item, addLabels, removeLabels);
      vscode.window.showInformationMessage(`Updated labels on #${item.issueNumber}.`);
    });
  }

  async openIssueCommand(): Promise<void> {
    const item = await this.pickBoardItem("Select issue to open");
    if (!item?.url) {
      vscode.window.showWarningMessage("No issue URL found on the selected item.");
      return;
    }

    await this.openUrl(item.url);
  }

  async openRunCommand(): Promise<void> {
    const run = await this.pickRun("Select workflow run to open");
    if (!run?.url) {
      vscode.window.showWarningMessage("No run URL found for the selected run.");
      return;
    }

    await this.openUrl(run.url);
  }

  async openUrl(url: string): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  dispose(): void {
    this.disposed = true;
    this.streamClient.dispose();
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
  }

  private async runWrite(action: () => Promise<void>): Promise<void> {
    try {
      await action();
      await this.refreshNow("write");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Phoenix Command Center write failed: ${message}`);
    }
  }

  private async startDataFlow(): Promise<void> {
    const settings = this.dataService.getSettings();
    if (!settings.useSupervisorStream) {
      this.startPolling();
      return;
    }

    const connected = await this.tryStartSupervisorStream();
    if (!connected) {
      this.startPolling();
    }
  }

  private async tryStartSupervisorStream(): Promise<boolean> {
    const settings = this.dataService.getSettings();
    const snapshotUrl = `${settings.supervisorBaseUrl.replace(/\/$/, "")}/snapshot`;

    try {
      const initial = await this.fetchSnapshot(snapshotUrl);
      this.acceptSnapshot({
        ...initial,
        meta: {
          ...initial.meta,
          source: "supervisor",
          streamConnected: true,
          stale: false
        }
      });

      this.streamClient.connect(
        settings.supervisorBaseUrl,
        (envelope) => this.onStreamEnvelope(envelope),
        () => {
          this.streamConnected = false;
          void this.postStatus("Stream disconnected, using polling", "warn");
          this.startPolling();
        },
        () => {
          this.streamConnected = true;
          void this.postStatus("Live stream connected", "ok");
        }
      );

      await this.postStatus("Live stream connected", "ok");
      return true;
    } catch {
      this.streamConnected = false;
      await this.postStatus("Supervisor unavailable, using polling", "warn");
      return false;
    }
  }

  private startPolling(): void {
    if (this.pollingTimer) {
      return;
    }

    const settings = this.dataService.getSettings();
    const intervalMs = settings.refreshSeconds * 1000;

    this.pollingTimer = setInterval(() => {
      void this.refreshNow("poll");
    }, intervalMs);

    void this.postStatus("Polling", "warn");
  }

  private startStaleMonitor(): void {
    if (this.staleTimer) {
      return;
    }

    this.staleTimer = setInterval(() => {
      if (!this.snapshot) {
        return;
      }

      const refreshWindowMs = this.dataService.getSettings().refreshSeconds * 2000;
      const stale = Date.now() - this.lastUpdatedMs > refreshWindowMs;
      if (stale !== this.snapshot.meta.stale) {
        this.snapshot.meta.stale = stale;
        void this.pushSnapshot();
      }
    }, 5000);
  }

  private async refreshNow(reason: "startup" | "manual" | "poll" | "write"): Promise<void> {
    try {
      this.sequence += 1;
      const snapshot = await this.dataService.fetchLocalSnapshot(this.sequence, this.streamConnected, false);
      this.acceptSnapshot(snapshot);

      if (reason === "manual") {
        void this.postStatus("Manual refresh complete", "ok");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void this.postStatus(`Refresh failed: ${message}`, "err");
    }
  }

  private onStreamEnvelope(envelope: StreamEnvelope): void {
    if (!this.snapshot) {
      if (envelope.eventType === "snapshot") {
        const payload = envelope.payload as DashboardSnapshot;
        this.acceptSnapshot({
          ...payload,
          meta: {
            ...payload.meta,
            source: "supervisor",
            streamConnected: true,
            stale: false,
            sequence: envelope.sequence
          }
        });
      }
      return;
    }

    const next = applyStreamEnvelope(this.snapshot, envelope);
    this.acceptSnapshot(next);
  }

  private acceptSnapshot(snapshot: DashboardSnapshot): void {
    this.snapshot = snapshot;
    this.lastUpdatedMs = Date.now();
    this.streamConnected = snapshot.meta.streamConnected;
    void this.pushSnapshot();
  }

  private async pushSnapshot(): Promise<void> {
    if (!this.snapshot) {
      return;
    }

    await this.viewProvider.postMessage("snapshot", this.snapshot);
  }

  private async postStatus(text: string, level: "ok" | "warn" | "err"): Promise<void> {
    await this.viewProvider.postMessage("status", { text, level });
  }

  private async fetchSnapshot(url: string): Promise<DashboardSnapshot> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return (await response.json()) as DashboardSnapshot;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async pickBoardItem(title: string): Promise<BoardItem | undefined> {
    if (!this.snapshot || this.snapshot.board.items.length === 0) {
      await this.refreshNow("manual");
    }

    if (!this.snapshot || this.snapshot.board.items.length === 0) {
      vscode.window.showWarningMessage("No board items are available.");
      return undefined;
    }

    return await vscode.window.showQuickPick(
      this.snapshot.board.items.map((item) => ({
        label: `#${item.issueNumber ?? "?"} ${item.title}`,
        description: `${item.repo} • ${item.status}`,
        detail: item.workMode ?? "",
        item
      })),
      { title, placeHolder: "Select board item" }
    ).then((selected) => selected?.item);
  }

  private async pickRun(title: string): Promise<ActionRun | undefined> {
    if (!this.snapshot || this.snapshot.actions.runs.length === 0) {
      await this.refreshNow("manual");
    }

    if (!this.snapshot || this.snapshot.actions.runs.length === 0) {
      vscode.window.showWarningMessage("No workflow runs are available.");
      return undefined;
    }

    return await vscode.window.showQuickPick(
      this.snapshot.actions.runs.map((run) => ({
        label: run.workflowName || run.name,
        description: `${run.repo} • ${run.status}${run.conclusion ? `/${run.conclusion}` : ""}`,
        detail: run.displayTitle,
        run
      })),
      { title, placeHolder: "Select workflow run" }
    ).then((selected) => selected?.run);
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const viewProvider = new CommandCenterViewProvider(context.extensionUri);
  const dataService = new DataService(new GhClient());
  const controller = new CommandCenterController(viewProvider, dataService);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CommandCenterViewProvider.viewType, viewProvider),
    controller,
    vscode.commands.registerCommand("phoenixOps.refresh", async () => controller.refreshCommand()),
    vscode.commands.registerCommand("phoenixOps.createIssue", async () => controller.createIssueCommand()),
    vscode.commands.registerCommand("phoenixOps.updateProjectField", async () => controller.updateProjectFieldCommand()),
    vscode.commands.registerCommand("phoenixOps.updateLabels", async () => controller.updateLabelsCommand()),
    vscode.commands.registerCommand("phoenixOps.openIssueInBrowser", async () => controller.openIssueCommand()),
    vscode.commands.registerCommand("phoenixOps.openRunInBrowser", async () => controller.openRunCommand())
  );

  void controller.initialize().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Phoenix Command Center failed to initialize: ${message}`);
  });
}

export function deactivate(): void {
  // no-op
}
