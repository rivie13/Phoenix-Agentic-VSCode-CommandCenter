import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import type { JarvisIdentity } from "./jarvisPrompts";

/**
 * Manages Jarvis identity persistence.
 * Reads/writes user identity from VS Code workspace state or environment variables.
 * File-based fallback: ~/.phoenix-jarvis-identity.json
 */

const IDENTITY_CONFIG_FILENAME = ".phoenix-jarvis-identity.json";

function getIdentityConfigPath(): string {
  return path.join(os.homedir(), IDENTITY_CONFIG_FILENAME);
}

interface StoredIdentity {
  name?: string;
  preferredPronouns?: "he/him" | "she/her" | "they/them" | "other";
}

/**
 * Read Jarvis identity from disk (home directory).
 * Falls back to environment variables if disk read fails.
 */
export function readJarvisIdentityFromDisk(): JarvisIdentity | null {
  const configPath = getIdentityConfigPath();

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      const stored: StoredIdentity = JSON.parse(content);
      if (stored.name) {
        return {
          name: stored.name,
          preferredPronouns: stored.preferredPronouns,
          isIdentityComplete: !!stored.name
        };
      }
    }
  } catch (error) {
    // Silently fail and fall back to env vars
  }

  // Fallback to environment variables
  const envName = process.env.PHOENIX_JARVIS_NAME || process.env.USER || process.env.USERNAME || null;
  const envPronouns = (process.env.PHOENIX_JARVIS_PRONOUNS ||
    "they/them") as "he/him" | "she/her" | "they/them" | "other" | undefined;

  if (envName) {
    return {
      name: envName,
      preferredPronouns: envPronouns,
      isIdentityComplete: true
    };
  }

  return null;
}

/**
 * Write Jarvis identity to disk (~/.phoenix-jarvis-identity.json).
 * Also updates environment variables for supervisor scripts to pick up.
 */
export function writeJarvisIdentityToDisk(identity: JarvisIdentity): boolean {
  const configPath = getIdentityConfigPath();

  try {
    const stored: StoredIdentity = {
      name: identity.name || undefined,
      preferredPronouns: identity.preferredPronouns
    };

    fs.writeFileSync(configPath, JSON.stringify(stored, null, 2), "utf-8");

    // Also update environment for child processes (supervisor scripts, etc.)
    if (identity.name) {
      process.env.PHOENIX_JARVIS_NAME = identity.name;
    }
    if (identity.preferredPronouns) {
      process.env.PHOENIX_JARVIS_PRONOUNS = identity.preferredPronouns;
    }

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Create a default identity with missing name.
 * Used to prime the identity request before asking the user.
 */
export function createIncompleteIdentity(): JarvisIdentity {
  return {
    name: null,
    preferredPronouns: "they/them",
    isIdentityComplete: false
  };
}

/**
 * Build environment setup instructions for supervisor.
 * Returns shell commands to set identity env vars.
 */
export function buildSupervisorEnvScript(identity: JarvisIdentity): string {
  const name = identity.name ? `"${identity.name.replace(/"/g, '\\"')}"` : "";
  const pronouns = identity.preferredPronouns || "they/them";

  // PowerShell syntax for Windows compatibility
  return [
    `$env:PHOENIX_JARVIS_NAME = ${name}`,
    `$env:PHOENIX_JARVIS_PRONOUNS = "${pronouns}"`,
    "# Consider persisting these to your shell profile (.bashrc, .zshrc, $PROFILE, etc.)"
  ].join("\n");
}

/**
 * Log identity setup to console for debugging.
 */
export function logIdentitySetup(identity: JarvisIdentity): void {
  const status = identity.isIdentityComplete ? "✓ Complete" : "⚠ Incomplete";
  const name = identity.name || "(not set)";
  const pronouns = identity.preferredPronouns || "they/them";

  console.log(`[Jarvis Identity] ${status}`);
  console.log(`  Name: ${name}`);
  console.log(`  Pronouns: ${pronouns}`);
  console.log(`  Config: ${getIdentityConfigPath()}`);
}
