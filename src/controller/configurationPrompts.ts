import * as vscode from "vscode";

interface SupervisorModeSettings {
  workspaceSupervisorAutoStart: boolean;
  embeddedSupervisorEnabled: boolean;
  supervisorBaseUrl: string;
  supervisorAuthToken: string;
}

interface AgentModelHubSettings {
  agentModelCatalogUrl: string;
  agentModelCatalogAuthToken: string;
}

export async function pickSupervisorModeConfig(
  settings: SupervisorModeSettings
): Promise<{ updates: Array<[string, unknown]>; label: string } | null> {
  const currentMode = settings.workspaceSupervisorAutoStart
    ? "workspace"
    : (settings.embeddedSupervisorEnabled ? "embedded" : "custom");
  const selected = await vscode.window.showQuickPick(
    [
      {
        mode: "workspace",
        label: "Workspace Supervisor (Auto-start)",
        description: "Use Phoenix-Agentic-Workspace-Supervisor as control plane.",
        detail: "Recommended for local multi-repo orchestration."
      },
      {
        mode: "embedded",
        label: "Embedded Supervisor Sidecar",
        description: "Use bundled supervisor process in this extension.",
        detail: "Keeps everything inside Command Center."
      },
      {
        mode: "custom",
        label: "Custom Supervisor URL",
        description: "Use your own hosted supervisor/hub endpoint.",
        detail: `Current: ${settings.supervisorBaseUrl}`
      }
    ] as Array<vscode.QuickPickItem & { mode: "workspace" | "embedded" | "custom" }>,
    {
      title: "Supervisor Mode",
      placeHolder: `Current mode: ${currentMode}`
    }
  );
  if (!selected) {
    return null;
  }

  const updates: Array<[string, unknown]> = [];
  if (selected.mode === "workspace") {
    updates.push(["workspaceSupervisorAutoStart", true]);
    updates.push(["embeddedSupervisorEnabled", false]);
  }
  if (selected.mode === "embedded") {
    updates.push(["workspaceSupervisorAutoStart", false]);
    updates.push(["embeddedSupervisorEnabled", true]);
  }
  if (selected.mode === "custom") {
    const enteredBaseUrl = await vscode.window.showInputBox({
      title: "Custom Supervisor Base URL",
      prompt: "Set your external supervisor/hub base URL.",
      value: settings.supervisorBaseUrl,
      ignoreFocusOut: true
    });
    if (enteredBaseUrl === undefined) {
      return null;
    }
    const normalizedBaseUrl = enteredBaseUrl.trim().replace(/\/$/, "");
    if (!normalizedBaseUrl) {
      vscode.window.showErrorMessage("Supervisor URL is required for custom mode.");
      return null;
    }
    try {
      const parsed = new URL(normalizedBaseUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Unsupported protocol");
      }
    } catch {
      vscode.window.showErrorMessage(`Invalid supervisor URL: ${normalizedBaseUrl}`);
      return null;
    }

    updates.push(["workspaceSupervisorAutoStart", false]);
    updates.push(["embeddedSupervisorEnabled", false]);
    updates.push(["supervisorBaseUrl", normalizedBaseUrl]);

    const tokenAction = await vscode.window.showQuickPick(
      [
        { id: "keep", label: "Keep current auth token", description: "No change" },
        { id: "set", label: "Set or replace auth token", description: "Update phoenixOps.supervisorAuthToken" },
        { id: "clear", label: "Clear auth token", description: "Use no bearer token" }
      ],
      {
        title: "Custom Supervisor Auth Token",
        placeHolder: "Optional token handling"
      }
    );
    if (!tokenAction) {
      return null;
    }
    if (tokenAction.id === "set") {
      const enteredToken = await vscode.window.showInputBox({
        title: "Supervisor Auth Token",
        prompt: "Paste bearer token for your custom supervisor.",
        value: settings.supervisorAuthToken,
        password: true,
        ignoreFocusOut: true
      });
      if (enteredToken === undefined) {
        return null;
      }
      updates.push(["supervisorAuthToken", enteredToken.trim()]);
    }
    if (tokenAction.id === "clear") {
      updates.push(["supervisorAuthToken", ""]);
    }
  }

  return { updates, label: selected.label };
}

export async function pickAgentModelHubConfig(
  settings: AgentModelHubSettings
): Promise<{ updates: Array<[string, unknown]>; statusMessage: string } | null> {
  const enteredUrl = await vscode.window.showInputBox({
    title: "Agent Model Catalog Hub URL",
    prompt: "Optional URL that returns Codex/Copilot model lists for the composer. Leave empty to disable hub lookup.",
    value: settings.agentModelCatalogUrl,
    ignoreFocusOut: true
  });
  if (enteredUrl === undefined) {
    return null;
  }

  const normalizedUrl = enteredUrl.trim().replace(/\/$/, "");
  if (normalizedUrl) {
    try {
      const parsed = new URL(normalizedUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Unsupported protocol");
      }
    } catch {
      vscode.window.showErrorMessage(`Invalid model catalog hub URL: ${normalizedUrl}`);
      return null;
    }
  }

  const tokenAction = await vscode.window.showQuickPick(
    [
      { id: "keep", label: "Keep current model hub token", description: "No change" },
      { id: "set", label: "Set or replace model hub token", description: "Update phoenixOps.agentModelCatalogAuthToken" },
      { id: "clear", label: "Clear model hub token", description: "Use no bearer token" }
    ],
    {
      title: "Model Hub Auth Token",
      placeHolder: "Optional token handling"
    }
  );
  if (!tokenAction) {
    return null;
  }

  const updates: Array<[string, unknown]> = [
    ["agentModelCatalogUrl", normalizedUrl]
  ];
  if (tokenAction.id === "set") {
    const enteredToken = await vscode.window.showInputBox({
      title: "Model Hub Bearer Token",
      prompt: "Paste bearer token for model catalog endpoint.",
      value: settings.agentModelCatalogAuthToken,
      password: true,
      ignoreFocusOut: true
    });
    if (enteredToken === undefined) {
      return null;
    }
    updates.push(["agentModelCatalogAuthToken", enteredToken.trim()]);
  }
  if (tokenAction.id === "clear") {
    updates.push(["agentModelCatalogAuthToken", ""]);
  }

  const statusMessage = normalizedUrl
    ? `Model hub configured: ${normalizedUrl}`
    : "Model hub disabled; using local model settings.";
  return { updates, statusMessage };
}
