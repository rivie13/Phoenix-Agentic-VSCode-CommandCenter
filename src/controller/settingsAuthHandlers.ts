import * as vscode from "vscode";
import { spawnSync } from "node:child_process";

function isExecutableAvailable(executable: string): boolean {
  const checker = process.platform === "win32" ? "where" : "which";
  try {
    const result = spawnSync(checker, [executable], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function resolveAuthCommand(configured: string, fallbackCommands: string[]): string {
  const normalizedConfigured = configured.toLowerCase();
  const hasCopilotFallback = fallbackCommands.some((candidate) => candidate.toLowerCase().startsWith("copilot "));
  const legacyCodexCommand = normalizedConfigured === "codex auth login";
  const legacyCopilotCommand = hasCopilotFallback && normalizedConfigured === "gh auth login --web";

  if (configured && normalizedConfigured !== "auto" && !legacyCodexCommand && !legacyCopilotCommand) {
    return configured;
  }

  for (const candidate of fallbackCommands) {
    const executable = candidate.trim().split(/\s+/)[0];
    if (!executable) {
      continue;
    }
    if (isExecutableAvailable(executable)) {
      return candidate;
    }
  }

  return fallbackCommands[0] ?? "";
}

export async function runAuthCommandFromSetting(settingKey: string, fallbackCommands: string[], label: string): Promise<void> {
  const configured = vscode.workspace.getConfiguration("phoenixOps").get<string>(settingKey, "auto").trim();
  const command = resolveAuthCommand(configured, fallbackCommands);
  if (!command) {
    vscode.window.showErrorMessage(`No ${label} auth command configured.`);
    return;
  }

  const terminal = vscode.window.createTerminal({ name: `Phoenix Ops: ${label} Sign-In` });
  terminal.show(true);
  terminal.sendText(command, true);
  vscode.window.showInformationMessage(`${label} sign-in command sent to terminal.`);
}

export function resolveConfigTargetForKey(setting: string): vscode.ConfigurationTarget {
  const config = vscode.workspace.getConfiguration("phoenixOps");
  const inspected = config.inspect(setting);
  if (inspected && inspected.workspaceValue !== undefined) {
    return vscode.ConfigurationTarget.Workspace;
  }
  return vscode.ConfigurationTarget.Global;
}

export async function updatePhoenixSettings(entries: Array<[string, unknown]>): Promise<void> {
  if (!entries.length) {
    return;
  }
  const config = vscode.workspace.getConfiguration("phoenixOps");
  for (const [setting, value] of entries) {
    const target = resolveConfigTargetForKey(setting);
    await config.update(setting, value, target);
  }
}
