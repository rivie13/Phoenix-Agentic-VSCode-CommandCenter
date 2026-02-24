import * as os from "node:os";
import * as path from "node:path";

function readFlagValue(args: string[], flag: string): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const current = String(args[index] ?? "").trim();
    if (!current) {
      continue;
    }

    if (current === flag) {
      const next = String(args[index + 1] ?? "").trim();
      return next || null;
    }

    if (current.startsWith(`${flag}=`)) {
      const [, value] = current.split("=", 2);
      const normalized = String(value ?? "").trim();
      return normalized || null;
    }
  }

  return null;
}

function normalizeLogin(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const entry = raw as { login?: unknown; username?: unknown; user?: unknown };
  const loginCandidate =
    typeof entry.login === "string"
      ? entry.login
      : typeof entry.username === "string"
        ? entry.username
        : typeof entry.user === "string"
          ? entry.user
          : null;
  if (typeof loginCandidate !== "string") {
    return null;
  }

  const normalized = loginCandidate.trim();
  return normalized.length > 0 ? normalized : null;
}

export function resolveCopilotConfigDir(
  baseArgs: string[],
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = os.homedir()
): string {
  const configured = readFlagValue(baseArgs, "--config-dir");
  if (configured) {
    return configured;
  }

  const xdgConfigHome = String(environment.XDG_CONFIG_HOME ?? "").trim();
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, "copilot");
  }

  return path.join(homeDirectory, ".copilot");
}

export function extractCopilotLoginFromConfig(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const config = raw as {
    last_logged_in_user?: unknown;
    logged_in_users?: unknown;
  };

  const direct = normalizeLogin(config.last_logged_in_user);
  if (direct) {
    return direct;
  }

  const users = Array.isArray(config.logged_in_users) ? config.logged_in_users : [];
  for (const entry of users) {
    const login = normalizeLogin(entry);
    if (login) {
      return login;
    }
  }

  if (config.logged_in_users && typeof config.logged_in_users === "object") {
    const usersByKey = config.logged_in_users as Record<string, unknown>;
    for (const entry of Object.values(usersByKey)) {
      const login = normalizeLogin(entry);
      if (login) {
        return login;
      }
    }
  }

  return null;
}