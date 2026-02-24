import * as vscode from "vscode";
import { CommandCenterController } from "./controller/CommandCenterController";
import { CommandCenterViewProvider } from "./providers/CommandCenterViewProvider";
import { DataService } from "./services/DataService";
import { GhClient } from "./services/GhClient";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const boardViewProvider = new CommandCenterViewProvider(context.extensionUri, "full");
  const agentViewProvider = new CommandCenterViewProvider(context.extensionUri, "agent-only");
  const dataService = new DataService(new GhClient(), context.globalStorageUri.fsPath);
  const controller = new CommandCenterController(boardViewProvider, agentViewProvider, dataService, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CommandCenterViewProvider.boardViewType, boardViewProvider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerWebviewViewProvider(CommandCenterViewProvider.agentViewType, agentViewProvider, { webviewOptions: { retainContextWhenHidden: true } }),
    controller,
    vscode.commands.registerCommand("phoenixOps.refresh", async () => controller.refreshCommand()),
    vscode.commands.registerCommand("phoenixOps.openAgentWorkspace", async () => controller.openAgentWorkspacePanelCommand()),
    vscode.commands.registerCommand("phoenixOps.signIn", async () => controller.signInCommand()),
    vscode.commands.registerCommand("phoenixOps.signInCodexCli", async () => controller.signInCodexCliCommand()),
    vscode.commands.registerCommand("phoenixOps.signInCopilotCli", async () => controller.signInCopilotCliCommand()),
    vscode.commands.registerCommand("phoenixOps.signInGeminiCli", async () => controller.signInGeminiCliCommand()),
    vscode.commands.registerCommand("phoenixOps.geminiSignIn", async () => controller.geminiSignInCommand()),
    vscode.commands.registerCommand("phoenixOps.geminiSetApiKey", async () => controller.geminiSetApiKeyCommand()),
    vscode.commands.registerCommand("phoenixOps.pollinationsSignIn", async () => controller.pollinationsSignInCommand()),
    vscode.commands.registerCommand("phoenixOps.pollinationsSetApiKey", async () => controller.pollinationsSetApiKeyCommand()),
    vscode.commands.registerCommand("phoenixOps.configureSupervisorMode", async () => controller.configureSupervisorModeCommand()),
    vscode.commands.registerCommand("phoenixOps.configureJarvisVoice", async () => controller.configureJarvisVoiceCommand()),
    vscode.commands.registerCommand("phoenixOps.configureModelHub", async () => controller.configureAgentModelHubCommand()),
    vscode.commands.registerCommand("phoenixOps.createIssue", async () => controller.createIssueCommand()),
    vscode.commands.registerCommand("phoenixOps.createPullRequest", async () => controller.createPullRequestCommand()),
    vscode.commands.registerCommand("phoenixOps.mergePullRequest", async () => controller.mergePullRequestCommand()),
    vscode.commands.registerCommand("phoenixOps.commentPullRequest", async () => controller.commentPullRequestCommand()),
    vscode.commands.registerCommand("phoenixOps.updateProjectField", async () => controller.updateProjectFieldCommand()),
    vscode.commands.registerCommand("phoenixOps.updateLabels", async () => controller.updateLabelsCommand()),
    vscode.commands.registerCommand("phoenixOps.openIssueInBrowser", async () => controller.openIssueCommand()),
    vscode.commands.registerCommand("phoenixOps.openRunInBrowser", async () => controller.openRunCommand()),
    vscode.commands.registerCommand("phoenixOps.openPullRequestInBrowser", async () => controller.openPullRequestCommand()),
    vscode.commands.registerCommand("phoenixOps.openSessionInEditor", async () => controller.openSessionInEditorCommand()),
    vscode.commands.registerCommand("phoenixOps.jarvisActivate", async () => controller.jarvisActivateCommand()),
    vscode.commands.registerCommand("phoenixOps.jarvisAuditionPersonalities", async () => controller.jarvisAuditionPersonalitiesCommand()),
    vscode.commands.registerCommand("phoenixOps.jarvisToggleManualMode", async () => controller.jarvisToggleManualModeCommand())
  );

  void controller.initialize().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Phoenix Command Center failed to initialize: ${message}`);
  });
}

export function deactivate(): void {
  // no-op
}
