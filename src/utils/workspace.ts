import * as path from "path";
import * as vscode from "vscode";

const PHOENIX_REPO_NAMES = [
  "Phoenix-Agentic-Engine",
  "Phoenix-Agentic-Engine-Backend",
  "Phoenix-Agentic-Engine-Interface",
  "Phoenix-Agentic-Website-Frontend",
  "Phoenix-Agentic-Website-Backend"
];

export function inferPhoenixRepositories(owner: string): string[] {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const discovered = folders
    .map((folder) => path.basename(folder.uri.fsPath))
    .filter((name) => PHOENIX_REPO_NAMES.includes(name))
    .map((name) => `${owner}/${name}`);

  if (discovered.length > 0) {
    return Array.from(new Set(discovered));
  }

  return PHOENIX_REPO_NAMES.map((name) => `${owner}/${name}`);
}

export function repoUrlToSlug(repoUrlOrSlug: string): string {
  if (!repoUrlOrSlug.includes("github.com")) {
    return repoUrlOrSlug;
  }

  try {
    const parsed = new URL(repoUrlOrSlug);
    const cleanedPath = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
    return cleanedPath;
  } catch {
    return repoUrlOrSlug;
  }
}
