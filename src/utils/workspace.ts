import * as fs from "node:fs";
import * as path from "path";
import * as vscode from "vscode";

export type RepositoryDiscoveryMode = "phoenixWorkspace" | "workspaceGitRemotes";

const PHOENIX_REPO_NAMES = [
  "Phoenix-Agentic-Engine",
  "Phoenix-Agentic-Engine-Backend",
  "Phoenix-Agentic-Engine-Interface",
  "Phoenix-Agentic-Website-Frontend",
  "Phoenix-Agentic-Website-Backend"
];

export function inferRepositories(owner: string, mode: RepositoryDiscoveryMode): string[] {
  if (mode === "workspaceGitRemotes") {
    const discovered = inferWorkspaceGithubRemotes();
    if (discovered.length > 0) {
      return discovered;
    }
  }

  return inferPhoenixRepositories(owner);
}

function inferPhoenixRepositories(owner: string): string[] {
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

function inferWorkspaceGithubRemotes(): string[] {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const slugs = new Set<string>();

  for (const folder of folders) {
    const slug = readOriginSlugFromGitConfig(folder.uri.fsPath);
    if (slug) {
      slugs.add(slug);
    }
  }

  return Array.from(slugs).sort((a, b) => a.localeCompare(b));
}

function readOriginSlugFromGitConfig(folderPath: string): string | null {
  const configPath = path.join(folderPath, ".git", "config");
  if (!fs.existsSync(configPath)) {
    return null;
  }

  let content = "";
  try {
    content = fs.readFileSync(configPath, "utf8");
  } catch {
    return null;
  }

  const lines = content.split(/\r?\n/);
  let inOrigin = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      inOrigin = line.toLowerCase() === '[remote "origin"]';
      continue;
    }

    if (!inOrigin || !line.startsWith("url")) {
      continue;
    }

    const parts = line.split("=", 2);
    const url = (parts[1] ?? "").trim();
    const slug = remoteUrlToSlug(url);
    if (slug) {
      return slug;
    }
  }

  return null;
}

function remoteUrlToSlug(url: string): string | null {
  if (!url) {
    return null;
  }

  const normalized = url.replace(/\.git$/i, "");
  const httpsMatch = normalized.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/]+)$/i);
  if (!httpsMatch?.groups) {
    return null;
  }

  const owner = httpsMatch.groups.owner;
  const repo = httpsMatch.groups.repo;
  if (!owner || !repo) {
    return null;
  }

  return `${owner}/${repo}`;
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
