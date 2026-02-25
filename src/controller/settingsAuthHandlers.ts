import * as vscode from "vscode";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { formatCliInvocationForTerminal, parseCliInvocation } from "../utils/cliCommand";
import { extractCopilotLoginFromConfig, resolveCopilotConfigDir } from "../utils/cliAuthStatus";

const CLI_AUTH_TIMEOUT_MS = 5000;

export type CliAuthService = "codex" | "copilot";

export interface CliAuthStatus {
  service: CliAuthService;
  state: "unknown" | "checking" | "signed-in" | "signed-out" | "limited" | "unavailable";
  authenticated: boolean;
  available: boolean;
  limited: boolean;
  summary: string;
  detail: string;
  checkedAt: string;
}

interface CliProbeCommand {
  args: string[];
  authSignal: boolean;
}

interface CapturedCommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface CodexDeviceAuthPrompt {
  verificationUrl: string;
  userCode: string;
}

type CliAuthProbeLogger = (line: string) => void;

function isExecutableAvailable(executable: string): boolean {
  const normalized = executable.trim();
  if (!normalized) {
    return false;
  }
  if (normalized.includes("\\") || normalized.includes("/") || normalized.includes(":")) {
    return fs.existsSync(normalized);
  }

  const checker = process.platform === "win32" ? "where" : "which";
  try {
    const result = spawnSync(checker, [normalized], { stdio: "ignore" });
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
    return formatCliInvocationForTerminal(parseCliInvocation(configured, fallbackCommands[0] ?? ""));
  }

  for (const candidate of fallbackCommands) {
    const invocation = parseCliInvocation(candidate, candidate);
    const executable = invocation.command;
    if (!executable) {
      continue;
    }
    if (isExecutableAvailable(executable)) {
      return formatCliInvocationForTerminal(invocation);
    }
  }

  const fallback = fallbackCommands[0] ?? "";
  return formatCliInvocationForTerminal(parseCliInvocation(fallback, fallback));
}

export async function runAuthCommandFromSetting(
  settingKey: string,
  fallbackCommands: string[],
  label: string
): Promise<{ command: string; terminalName: string } | null> {
  const configured = vscode.workspace.getConfiguration("phoenixOps").get<string>(settingKey, "auto").trim();
  const command = resolveAuthCommand(configured, fallbackCommands);
  if (!command) {
    vscode.window.showErrorMessage(`No ${label} auth command configured.`);
    return null;
  }

  const terminalName = `Phoenix Ops: ${label} Sign-In`;
  const terminal = vscode.window.createTerminal({
    name: terminalName,
    isTransient: true
  });
  terminal.show(true);
  terminal.sendText(command, true);
  vscode.window.showInformationMessage(`${label} sign-in command sent to terminal.`);
  return {
    command,
    terminalName
  };
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

export function createUnknownCliAuthStatus(service: CliAuthService): CliAuthStatus {
  return {
    service,
    state: "unknown",
    authenticated: false,
    available: true,
    limited: false,
    summary: "Status unavailable.",
    detail: "",
    checkedAt: new Date().toISOString()
  };
}

function quoteForWindowsCmdSegment(segment: string): string {
  return `"${segment.replaceAll("\"", "\"\"")}"`;
}

function spawnWithShellCompatibility(command: string, args: string[], stdio: "pipe" | "ignore" = "pipe") {
  if (process.platform === "win32") {
    const commandLine = [command, ...args].map(quoteForWindowsCmdSegment).join(" ");
    return spawn("cmd.exe", ["/d", "/s", "/c", commandLine], {
      windowsHide: true,
      stdio
    });
  }
  return spawn(command, args, {
    windowsHide: true,
    stdio
  });
}

async function captureCommandOutput(command: string, args: string[], timeoutMs: number): Promise<CapturedCommandOutput> {
  return await new Promise((resolve, reject) => {
    const child = spawnWithShellCompatibility(command, args);
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });
  });
}

function parseCodexDeviceAuthPrompt(output: string): CodexDeviceAuthPrompt | null {
  const normalized = output.replace(/\r/g, "");
  const urlMatch = normalized.match(/https:\/\/auth\.openai\.com\/codex\/device\S*/i);
  const codeMatch = normalized.match(/\b[A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+\b/);
  if (!urlMatch || !codeMatch) {
    return null;
  }

  const verificationUrl = urlMatch[0].trim();
  const userCode = codeMatch[0].trim().toUpperCase();
  if (!verificationUrl || !userCode) {
    return null;
  }

  return { verificationUrl, userCode };
}

function summarizeCodexDeviceAuthOutput(output: string, fallback: string): string {
  const signal = extractSignalLine(output, fallback);
  return signal || fallback;
}

export async function runCodexDeviceAuthSignIn(
  cliPath: string,
  onPromptDiscovered: (prompt: CodexDeviceAuthPrompt) => Promise<void>,
  logger?: CliAuthProbeLogger
): Promise<{ ok: boolean; output: string; prompt: CodexDeviceAuthPrompt | null }> {
  const invocation = parseCliInvocation(cliPath, "codex");
  const command = invocation.command || "codex";
  const args = [...invocation.baseArgs, "login", "--device-auth"];
  const timeoutMs = 16 * 60 * 1000;
  logger?.(`[codex-login] invoking ${command} ${args.join(" ")}`);

  return await new Promise((resolve, reject) => {
    const child = spawnWithShellCompatibility(command, args);
    let stdout = "";
    let stderr = "";
    let prompt: CodexDeviceAuthPrompt | null = null;
    let promptPosted = false;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGKILL");
      const combined = `${stdout}\n${stderr}`;
      const detail = summarizeCodexDeviceAuthOutput(combined, "Codex web sign-in timed out.");
      logger?.(`[codex-login] timeout after ${timeoutMs}ms: ${detail}`);
      resolve({ ok: false, output: detail, prompt });
    }, timeoutMs);

    const maybeEmitPrompt = async (): Promise<void> => {
      if (promptPosted) {
        return;
      }
      const combined = `${stdout}\n${stderr}`;
      const nextPrompt = parseCodexDeviceAuthPrompt(combined);
      if (!nextPrompt) {
        return;
      }
      prompt = nextPrompt;
      promptPosted = true;
      logger?.(`[codex-login] prompt discovered url=${nextPrompt.verificationUrl} code=${nextPrompt.userCode}`);
      try {
        await onPromptDiscovered(nextPrompt);
      } catch {
        // Keep login flow running even if notification/open-browser helpers fail.
      }
    };

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      logger?.(`[codex-login] process error: ${error instanceof Error ? error.message : String(error)}`);
      reject(error);
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      void maybeEmitPrompt();
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
      void maybeEmitPrompt();
    });

    child.once("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const combined = `${stdout}\n${stderr}`;

      if (outputLooksUnavailable(combined)) {
        logger?.("[codex-login] CLI unavailable during sign-in flow.");
        resolve({
          ok: false,
          output: summarizeCodexDeviceAuthOutput(combined, "Codex CLI is unavailable."),
          prompt
        });
        return;
      }

      const successSignal =
        outputLooksSignedIn(combined) ||
        /logged in/i.test(combined) ||
        /authentication complete/i.test(combined);
      const ok = exitCode === 0 || successSignal;
      logger?.(`[codex-login] completed exit=${String(exitCode)} ok=${String(ok)} signal=${summarizeCodexDeviceAuthOutput(combined, "")}`);
      resolve({
        ok,
        output: summarizeCodexDeviceAuthOutput(
          combined,
          ok ? "Codex sign-in complete." : "Codex sign-in did not complete."
        ),
        prompt
      });
    });
  });
}

function outputLooksUnavailable(output: string): boolean {
  const lowered = output.toLowerCase();
  return (
    lowered.includes("is not recognized as an internal or external command") ||
    lowered.includes("command not found") ||
    lowered.includes("no such file or directory") ||
    lowered.includes("enoent")
  );
}

function outputLooksSignedOut(output: string): boolean {
  const lowered = output.toLowerCase();
  return (
    lowered.includes('"authenticated": false') ||
    lowered.includes('"authenticated":false') ||
    lowered.includes('"isauthenticated": false') ||
    lowered.includes('"isauthenticated":false') ||
    lowered.includes('"loggedin": false') ||
    lowered.includes('"loggedin":false') ||
    lowered.includes("not logged in") ||
    lowered.includes("not signed in") ||
    lowered.includes("login required") ||
    lowered.includes("please log in") ||
    lowered.includes("please login") ||
    lowered.includes("please sign in") ||
    lowered.includes("unauthorized") ||
    lowered.includes("forbidden") ||
    lowered.includes("authentication required") ||
    lowered.includes("invalid api key") ||
    lowered.includes("missing api key")
  );
}

function outputLooksSignedIn(output: string): boolean {
  const lowered = output.toLowerCase();
  return (
    lowered.includes('"authenticated": true') ||
    lowered.includes('"authenticated":true') ||
    lowered.includes('"isauthenticated": true') ||
    lowered.includes('"isauthenticated":true') ||
    lowered.includes('"loggedin": true') ||
    lowered.includes('"loggedin":true') ||
    lowered.includes("logged in as") ||
    lowered.includes("logged in") ||
    lowered.includes("signed in") ||
    lowered.includes("authenticated") ||
    lowered.includes("account:") ||
    lowered.includes("active account") ||
    lowered.includes("token:")
  );
}

function outputLooksLimited(output: string): boolean {
  const lowered = output.toLowerCase();
  return (
    lowered.includes("quota") ||
    lowered.includes("weekly limit") ||
    lowered.includes("rate limit") ||
    lowered.includes("limit reached") ||
    lowered.includes("quota exhausted") ||
    lowered.includes("out of credits") ||
    lowered.includes("usage limit")
  );
}

function extractSignalLine(output: string, fallback: string): string {
  const lines = output
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return fallback;
  }

  const signal = lines.find((line) => /(quota|limit|auth|login|signed|logged|account|token)/i.test(line));
  const picked = signal ?? lines[0];
  return picked.length > 220 ? `${picked.slice(0, 217)}...` : picked;
}

function buildProbeCommands(service: CliAuthService): CliProbeCommand[] {
  if (service === "codex") {
    return [
      { args: ["login", "status", "--json"], authSignal: true },
      { args: ["auth", "status", "--json"], authSignal: true },
      { args: ["login", "status"], authSignal: true },
      { args: ["auth", "status"], authSignal: true },
      { args: ["whoami"], authSignal: true },
      { args: ["status"], authSignal: true }
    ];
  }

  return [
    { args: ["--version"], authSignal: false }
  ];
}

function buildStatus(
  service: CliAuthService,
  state: CliAuthStatus["state"],
  summary: string,
  detail: string,
  options?: { authenticated?: boolean; available?: boolean; limited?: boolean }
): CliAuthStatus {
  return {
    service,
    state,
    authenticated: options?.authenticated ?? false,
    available: options?.available ?? true,
    limited: options?.limited ?? false,
    summary,
    detail,
    checkedAt: new Date().toISOString()
  };
}

function resolveCopilotTokenAuthDetail(): string | null {
  const ghToken = String(process.env.GH_TOKEN ?? "").trim();
  if (ghToken.length > 0) {
    return "Authenticated via GH_TOKEN environment variable.";
  }

  const githubToken = String(process.env.GITHUB_TOKEN ?? "").trim();
  if (githubToken.length > 0) {
    return "Authenticated via GITHUB_TOKEN environment variable.";
  }

  return null;
}

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

function resolveCopilotConfigDirFromAuthSetting(): string | null {
  const configured = vscode.workspace
    .getConfiguration("phoenixOps")
    .get<string>("copilotCliAuthCommand", "auto")
    .trim();
  if (!configured || configured.toLowerCase() === "auto") {
    return null;
  }

  const invocation = parseCliInvocation(configured, configured);
  return readFlagValue(invocation.baseArgs, "--config-dir");
}

function resolveCopilotLoginFromOutput(output: string): string | null {
  const normalized = output.replace(/\r/g, "");
  const matchers: RegExp[] = [
    /logged\s+in\s+as\s+([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)/i,
    /\blogin\s*:\s*([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)/i,
    /\buser\s*:\s*([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)/i,
    /\baccount\s*:\s*([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)/i
  ];

  for (const matcher of matchers) {
    const match = normalized.match(matcher);
    const login = String(match?.[1] ?? "").trim();
    if (login.length > 0) {
      return login;
    }
  }

  return null;
}

function buildCopilotConfigDirs(baseArgs: string[]): string[] {
  const homeDirectory = os.homedir();
  const dirs: string[] = [];

  const primaryFromPath = resolveCopilotConfigDir(baseArgs, process.env, homeDirectory);
  if (primaryFromPath) {
    dirs.push(primaryFromPath);
  }

  const explicitFromPath = readFlagValue(baseArgs, "--config-dir");
  if (explicitFromPath) {
    dirs.push(explicitFromPath);
  }

  const explicitFromAuth = resolveCopilotConfigDirFromAuthSetting();
  if (explicitFromAuth) {
    dirs.push(explicitFromAuth);
  }

  const envOverride = String(process.env.COPILOT_CONFIG_DIR ?? "").trim();
  if (envOverride) {
    dirs.push(envOverride);
  }

  const xdgConfigHome = String(process.env.XDG_CONFIG_HOME ?? "").trim();
  if (xdgConfigHome) {
    dirs.push(path.join(xdgConfigHome, "copilot"));
  }

  const appData = String(process.env.APPDATA ?? "").trim();
  if (appData) {
    dirs.push(path.join(appData, "copilot"));
  }

  if (homeDirectory) {
    dirs.push(path.join(homeDirectory, ".copilot"));
    dirs.push(path.join(homeDirectory, ".config", "copilot"));
  }

  const deduped = new Set<string>();
  for (const candidate of dirs) {
    const normalized = String(candidate ?? "").trim();
    if (!normalized) {
      continue;
    }
    deduped.add(path.normalize(normalized));
  }

  return Array.from(deduped.values());
}

async function probeCopilotAuthStatus(
  command: string,
  baseArgs: string[],
  logger?: CliAuthProbeLogger
): Promise<CliAuthStatus> {
  let availabilitySignal = "Copilot CLI is installed.";
  try {
    const versionResult = await captureCommandOutput(command, [...baseArgs, "--version"], CLI_AUTH_TIMEOUT_MS);
    const combined = `${versionResult.stdout}\n${versionResult.stderr}`;
    logger?.(`[copilot-probe] command=--version exit=${String(versionResult.exitCode)} signal=${extractSignalLine(combined, "")}`);
    if (outputLooksUnavailable(combined)) {
      return buildStatus("copilot", "unavailable", "CLI not available.", extractSignalLine(combined, "CLI unavailable."), {
        authenticated: false,
        available: false,
        limited: false
      });
    }
    availabilitySignal = extractSignalLine(combined, availabilitySignal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.(`[copilot-probe] command=--version failed: ${message}`);
    if (outputLooksUnavailable(message)) {
      return buildStatus("copilot", "unavailable", "CLI not available.", message, {
        authenticated: false,
        available: false,
        limited: false
      });
    }

    return buildStatus("copilot", "unknown", "Installed; auth status unavailable.", message, {
      authenticated: false,
      available: true,
      limited: false
    });
  }

  const tokenAuthDetail = resolveCopilotTokenAuthDetail();
  if (tokenAuthDetail) {
    logger?.(`[copilot-probe] authenticated by environment token: ${tokenAuthDetail}`);
    return buildStatus("copilot", "signed-in", "Signed in.", tokenAuthDetail, {
      authenticated: true,
      available: true,
      limited: false
    });
  }

  const authProbeCommands: CliProbeCommand[] = [
    { args: ["auth", "status"], authSignal: true },
    { args: ["whoami"], authSignal: true },
    { args: ["status"], authSignal: true }
  ];

  for (const probe of authProbeCommands) {
    try {
      const result = await captureCommandOutput(command, [...baseArgs, ...probe.args], CLI_AUTH_TIMEOUT_MS);
      const combined = `${result.stdout}\n${result.stderr}`;
      const detail = extractSignalLine(combined, availabilitySignal);
      logger?.(
        `[copilot-probe] command=${probe.args.join(" ")} exit=${String(result.exitCode)} ` +
          `signedIn=${String(outputLooksSignedIn(combined))} signedOut=${String(outputLooksSignedOut(combined))} ` +
          `limited=${String(outputLooksLimited(combined))} signal=${detail}`
      );

      if (outputLooksUnavailable(combined)) {
        return buildStatus("copilot", "unavailable", "CLI not available.", detail, {
          authenticated: false,
          available: false,
          limited: false
        });
      }

      const limited = outputLooksLimited(combined);
      if (outputLooksSignedOut(combined)) {
        return buildStatus("copilot", "signed-out", "Not signed in.", detail, {
          authenticated: false,
          available: true,
          limited
        });
      }

      const signedIn = outputLooksSignedIn(combined) || (probe.authSignal && result.exitCode === 0);
      if (signedIn) {
        const login = resolveCopilotLoginFromOutput(combined);
        const signedInDetail = login ? `Logged in as ${login}.` : detail;
        return buildStatus(
          "copilot",
          limited ? "limited" : "signed-in",
          limited ? "Signed in (limited)." : "Signed in.",
          signedInDetail,
          {
            authenticated: true,
            available: true,
            limited
          }
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.(`[copilot-probe] command=${probe.args.join(" ")} failed: ${message}`);
    }
  }

  const configDirs = buildCopilotConfigDirs(baseArgs);
  logger?.(`[copilot-probe] config-dirs=${configDirs.join(" | ")}`);
  for (const configDir of configDirs) {
    const configPath = path.join(configDir, "config.json");
    if (!fs.existsSync(configPath)) {
      continue;
    }

    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const login = extractCopilotLoginFromConfig(parsed);
      if (login) {
        logger?.(`[copilot-probe] config auth found in ${configPath} for login=${login}`);
        return buildStatus("copilot", "signed-in", "Signed in.", `Logged in as ${login}.`, {
          authenticated: true,
          available: true,
          limited: false
        });
      }

      logger?.(`[copilot-probe] config exists without login entries at ${configPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.(`[copilot-probe] config parse failed at ${configPath}: ${message}`);
      return buildStatus(
        "copilot",
        "unknown",
        "Installed; auth status unavailable.",
        extractSignalLine(message, availabilitySignal),
        {
          authenticated: false,
          available: true,
          limited: false
        }
      );
    }
  }

  return buildStatus("copilot", "signed-out", "Not signed in.", availabilitySignal, {
    authenticated: false,
    available: true,
    limited: false
  });
}

export async function probeCliAuthStatus(
  service: CliAuthService,
  cliPath: string,
  logger?: CliAuthProbeLogger
): Promise<CliAuthStatus> {
  const defaultCommand = service === "codex" ? "codex" : "copilot";
  const invocation = parseCliInvocation(cliPath, defaultCommand);
  const command = invocation.command || defaultCommand;
  const baseArgs = invocation.baseArgs;
  logger?.(`[${service}-probe] start command=${command} baseArgs=${baseArgs.join(" ") || "(none)"}`);

  if (service === "copilot") {
    const status = await probeCopilotAuthStatus(command, baseArgs, logger);
    logger?.(`[copilot-probe] final state=${status.state} summary=${status.summary} detail=${status.detail}`);
    return status;
  }

  const probes = buildProbeCommands(service);
  let unknownFallback = createUnknownCliAuthStatus(service);

  for (const probe of probes) {
    let result: CapturedCommandOutput;
    try {
      result = await captureCommandOutput(command, [...baseArgs, ...probe.args], CLI_AUTH_TIMEOUT_MS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.(`[${service}-probe] command=${probe.args.join(" ")} failed: ${message}`);
      if (outputLooksUnavailable(message)) {
        return buildStatus(service, "unavailable", "CLI not available.", message, {
          authenticated: false,
          available: false,
          limited: false
        });
      }
      continue;
    }

    const combined = `${result.stdout}\n${result.stderr}`;
    if (outputLooksUnavailable(combined)) {
      const detail = extractSignalLine(combined, "CLI unavailable.");
      logger?.(`[${service}-probe] command=${probe.args.join(" ")} unavailable signal=${detail}`);
      return buildStatus(service, "unavailable", "CLI not available.", detail, {
        authenticated: false,
        available: false,
        limited: false
      });
    }

    const detail = extractSignalLine(combined, "Status unavailable.");
    const limited = outputLooksLimited(combined);
    logger?.(
      `[${service}-probe] command=${probe.args.join(" ")} exit=${String(result.exitCode)} ` +
        `signedIn=${String(outputLooksSignedIn(combined))} signedOut=${String(outputLooksSignedOut(combined))} ` +
        `limited=${String(limited)} signal=${detail}`
    );

    if (outputLooksSignedOut(combined)) {
      return buildStatus(service, "signed-out", "Not signed in.", detail, {
        authenticated: false,
        available: true,
        limited
      });
    }

    const signedIn = outputLooksSignedIn(combined) || (probe.authSignal && result.exitCode === 0);
    if (signedIn) {
      if (limited) {
        return buildStatus(service, "limited", "Signed in (limited).", detail, {
          authenticated: true,
          available: true,
          limited: true
        });
      }

      return buildStatus(service, "signed-in", "Signed in.", detail, {
        authenticated: true,
        available: true,
        limited: false
      });
    }

    unknownFallback = buildStatus(service, "unknown", "Status unavailable.", detail, {
      authenticated: false,
      available: true,
      limited
    });
  }

  try {
    const help = await captureCommandOutput(command, [...baseArgs, "--help"], CLI_AUTH_TIMEOUT_MS);
    const combined = `${help.stdout}\n${help.stderr}`;
    if (outputLooksUnavailable(combined)) {
      const detail = extractSignalLine(combined, "CLI unavailable.");
      logger?.(`[${service}-probe] command=--help unavailable signal=${detail}`);
      return buildStatus(service, "unavailable", "CLI not available.", detail, {
        authenticated: false,
        available: false,
        limited: false
      });
    }

    const detail = extractSignalLine(combined, "No auth status output.");
    logger?.(`[${service}-probe] fallback --help signal=${detail}`);
    return buildStatus(service, "unknown", "Installed; auth status unavailable.", detail, {
      authenticated: false,
      available: true,
      limited: false
    });
  } catch {
    return unknownFallback;
  }
}
