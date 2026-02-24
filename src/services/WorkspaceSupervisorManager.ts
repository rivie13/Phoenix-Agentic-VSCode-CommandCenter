import * as fs from "node:fs";
import * as path from "node:path";
import { ChildProcess, spawn } from "node:child_process";
import * as vscode from "vscode";

export interface WorkspaceSupervisorConfig {
  baseUrl: string;
  apiToken: string;
  repoPath: string;
  startTimeoutMs: number;
  codexCliPath: string;
  copilotCliPath: string;
  claudeCliPath: string;
  geminiCliPath: string;
  jarvisApiBaseUrl: string;
  jarvisApiKey: string;
  jarvisTextModel: string;
  jarvisSpeechModel: string;
  jarvisVoice: string;
  jarvisTtsProvider: "gemini-with-fallback" | "gemini" | "pollinations";
  jarvisGeminiApiKey: string;
  jarvisGeminiModel: string;
  jarvisGeminiVoice: string;
  jarvisTtsDebug: boolean;
  jarvisHardCooldownSeconds: number;
  jarvisSoftCooldownSeconds: number;
}

interface SupervisorTarget {
  baseUrl: string;
  host: string;
  port: number;
}

interface ProbeResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

export class WorkspaceSupervisorManager implements vscode.Disposable {
  private readonly output: vscode.OutputChannel;
  private child: ChildProcess | null = null;
  private childRepoPath: string | null = null;

  constructor() {
    this.output = vscode.window.createOutputChannel("Phoenix Workspace Supervisor");
  }

  async ensureStarted(config: WorkspaceSupervisorConfig): Promise<string> {
    this.log(
      `ensureStarted requested (baseUrl=${config.baseUrl.trim()}, timeoutMs=${Math.min(120_000, Math.max(5_000, Math.floor(config.startTimeoutMs || 45_000)))}).`
    );
    const target = this.parseBaseUrl(config.baseUrl);
    if (!target) {
      throw new Error(`Invalid supervisorBaseUrl '${config.baseUrl}'.`);
    }
    if (!this.isLocalHost(target.host)) {
      this.log(`Skipping local supervisor startup for non-local host '${target.host}'.`);
      return target.baseUrl;
    }

    const existingHealth = await this.checkHealth(target.baseUrl, config.apiToken);
    if (existingHealth.ok) {
      this.log(`Existing workspace supervisor is healthy at ${target.baseUrl}.`);
      return target.baseUrl;
    }
    if (existingHealth.status !== null) {
      const existingSnapshot = await this.checkSnapshot(target.baseUrl, config.apiToken);
      if (existingSnapshot.ok) {
        this.log(
          `Existing workspace supervisor snapshot is available at ${target.baseUrl}; ` +
          `continuing despite /healthz readiness state` +
          `${existingHealth.error ? ` (${existingHealth.error})` : "."}`
        );
        return target.baseUrl;
      }
      this.log(
        `Existing workspace supervisor reachable but not ready at ${target.baseUrl}` +
        `${existingHealth.error ? `: ${existingHealth.error}` : "."} Waiting for readiness before spawning a new process.`
      );
      const timeoutMs = Math.min(120_000, Math.max(5_000, Math.floor(config.startTimeoutMs || 45_000)));
      await this.waitUntilReady(target.baseUrl, config.apiToken, timeoutMs);
      return target.baseUrl;
    }
    this.log(
      `Workspace supervisor health probe failed at ${target.baseUrl}` +
      `${existingHealth.status ? ` (HTTP ${existingHealth.status})` : ""}` +
      `${existingHealth.error ? `: ${existingHealth.error}` : "."}`
    );

    const repoPath = this.resolveRepoPath(config.repoPath);
    if (!repoPath) {
      throw new Error(
        "Could not locate Phoenix-Agentic-Workspace-Supervisor repo. Set phoenixOps.workspaceSupervisorRepoPath."
      );
    }
    this.log(`Resolved workspace supervisor repo path: ${repoPath}`);

    await this.startProcess(repoPath, target, config);
    const timeoutMs = Math.min(120_000, Math.max(5_000, Math.floor(config.startTimeoutMs || 45_000)));
    await this.waitUntilReady(target.baseUrl, config.apiToken, timeoutMs);
    return target.baseUrl;
  }

  dispose(): void {
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
    this.childRepoPath = null;
    this.output.dispose();
  }

  private parseBaseUrl(rawBaseUrl: string): SupervisorTarget | null {
    const trimmed = rawBaseUrl.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }
      const cleanPath = parsed.pathname.replace(/\/+$/, "");
      const baseUrl = `${parsed.protocol}//${parsed.host}${cleanPath}`;
      const port = parsed.port
        ? Number(parsed.port)
        : parsed.protocol === "https:"
          ? 443
          : 80;
      return {
        baseUrl,
        host: parsed.hostname.toLowerCase(),
        port
      };
    } catch {
      return null;
    }
  }

  private isLocalHost(host: string): boolean {
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "0.0.0.0";
  }

  private resolveRepoPath(explicitRepoPath: string): string | null {
    const candidates: string[] = [];
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

    if (explicitRepoPath.trim()) {
      const resolved = path.isAbsolute(explicitRepoPath)
        ? explicitRepoPath
        : path.resolve(workspaceFolders[0]?.uri.fsPath ?? process.cwd(), explicitRepoPath);
      this.addCandidate(candidates, resolved);
    }

    for (const folder of workspaceFolders) {
      this.addCandidate(candidates, folder.uri.fsPath);
      this.addCandidate(candidates, path.join(path.dirname(folder.uri.fsPath), "Phoenix-Agentic-Workspace-Supervisor"));
    }

    this.addCandidate(candidates, path.resolve(process.cwd(), "..", "Phoenix-Agentic-Workspace-Supervisor"));

    for (const candidate of candidates) {
      if (this.isSupervisorRepo(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private addCandidate(target: string[], candidate: string | null | undefined): void {
    if (!candidate) {
      return;
    }
    const normalized = path.normalize(candidate);
    if (!target.includes(normalized)) {
      target.push(normalized);
    }
  }

  private isSupervisorRepo(candidate: string): boolean {
    const packageJsonPath = path.join(candidate, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      return false;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { name?: unknown };
      if (parsed.name === "phoenix-agentic-workspace-supervisor") {
        return true;
      }
    } catch {
      // fallback below
    }

    return fs.existsSync(path.join(candidate, "src", "server.ts"));
  }

  private async startProcess(repoPath: string, target: SupervisorTarget, config: WorkspaceSupervisorConfig): Promise<void> {
    if (this.child && !this.child.killed) {
      if (this.childRepoPath === repoPath) {
        this.log(`Workspace supervisor process already running for ${repoPath}; reusing existing process.`);
        return;
      }
      this.log(`Stopping previous workspace supervisor process (${this.childRepoPath ?? "unknown repo"}).`);
      this.child.kill();
      this.child = null;
      this.childRepoPath = null;
    }

    const distServerPath = path.join(repoPath, "dist", "server.js");
    const useDist = fs.existsSync(distServerPath);
    const command = useDist ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
    const args = useDist ? [distServerPath] : ["run", "dev"];

    this.log(`Starting workspace supervisor (${useDist ? "dist" : "dev"}) at ${repoPath}`);
    this.log(`Launch command: ${command} ${args.join(" ")}`);
    this.log(
      `Jarvis env: baseUrl=${config.jarvisApiBaseUrl || "(auto)"} apiKeyConfigured=${Boolean(config.jarvisApiKey)} ` +
      `textModel=${config.jarvisTextModel || "(auto)"} speechModel=${config.jarvisSpeechModel || "(auto)"} voice=${config.jarvisVoice || "onyx"} ` +
      `ttsProvider=${config.jarvisTtsProvider} geminiKeyConfigured=${Boolean(config.jarvisGeminiApiKey)} ` +
      `geminiModel=${config.jarvisGeminiModel || "(auto)"} geminiVoice=${config.jarvisGeminiVoice || "Charon"}`
    );
    this.log(
      `CLI env: codex=${config.codexCliPath || "codex"} copilot=${config.copilotCliPath || "copilot"} ` +
      `claude=${config.claudeCliPath || "claude"} gemini=${config.geminiCliPath || "gemini"}`
    );

    this.child = spawn(command, args, {
      cwd: repoPath,
      env: {
        ...process.env,
        SUPERVISOR_HOST: target.host,
        SUPERVISOR_PORT: String(target.port),
        SUPERVISOR_API_TOKEN: config.apiToken,
        CODEX_CLI_CMD: config.codexCliPath,
        COPILOT_CLI_CMD: config.copilotCliPath,
        CLAUDE_CLI_CMD: config.claudeCliPath,
        GEMINI_CLI_CMD: config.geminiCliPath,
        SUPERVISOR_JARVIS_API_BASE_URL: config.jarvisApiBaseUrl,
        SUPERVISOR_JARVIS_API_KEY: config.jarvisApiKey,
        SUPERVISOR_JARVIS_TEXT_MODEL: config.jarvisTextModel,
        SUPERVISOR_JARVIS_SPEECH_MODEL: config.jarvisSpeechModel,
        SUPERVISOR_JARVIS_VOICE: config.jarvisVoice,
        SUPERVISOR_JARVIS_TTS_PROVIDER: config.jarvisTtsProvider,
        SUPERVISOR_JARVIS_GEMINI_API_KEY: config.jarvisGeminiApiKey,
        SUPERVISOR_JARVIS_GEMINI_MODEL: config.jarvisGeminiModel,
        SUPERVISOR_JARVIS_GEMINI_VOICE: config.jarvisGeminiVoice,
        SUPERVISOR_JARVIS_TTS_DEBUG: config.jarvisTtsDebug ? "1" : "0",
        SUPERVISOR_JARVIS_HARD_COOLDOWN_SECONDS: String(config.jarvisHardCooldownSeconds),
        SUPERVISOR_JARVIS_SOFT_COOLDOWN_SECONDS: String(config.jarvisSoftCooldownSeconds)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.childRepoPath = repoPath;

    this.child.stdout?.on("data", (chunk) => {
      this.output.appendLine(`[workspace-supervisor] ${String(chunk).trimEnd()}`);
    });
    this.child.stderr?.on("data", (chunk) => {
      this.output.appendLine(`[workspace-supervisor:error] ${String(chunk).trimEnd()}`);
    });
    this.child.on("error", (error) => {
      this.output.appendLine(`[workspace-supervisor:error] ${error.message}`);
    });
    this.child.on("exit", (code, signal) => {
      this.output.appendLine(`Workspace supervisor exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
      this.child = null;
      this.childRepoPath = null;
    });
  }

  private async waitUntilReady(baseUrl: string, token: string, timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    let attempts = 0;
    let lastFailure = "not ready";
    while (Date.now() - startedAt < timeoutMs) {
      attempts += 1;

      const health = await this.checkHealth(baseUrl, token);
      const snapshot = await this.checkSnapshot(baseUrl, token);
      if (snapshot.ok && health.ok) {
        this.log(`Workspace supervisor is ready at ${baseUrl} after ${attempts} checks (${Date.now() - startedAt}ms).`);
        return;
      }
      if (snapshot.ok && !health.ok) {
        this.log(
          `Workspace supervisor snapshot is available at ${baseUrl} before /healthz readiness; ` +
          `continuing in degraded-readiness mode after ${attempts} checks (${Date.now() - startedAt}ms).`
        );
        return;
      }
      if (!health.ok) {
        lastFailure = `health${health.status ? ` HTTP ${health.status}` : ""}${health.error ? `: ${health.error}` : ""}`;
      } else {
        lastFailure = `snapshot${snapshot.status ? ` HTTP ${snapshot.status}` : ""}${snapshot.error ? `: ${snapshot.error}` : ""}`;
      }

      if (attempts === 1 || attempts % 6 === 0) {
        this.log(`Waiting for workspace supervisor readiness (${attempts} checks, latest=${lastFailure}).`);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 350));
    }
    throw new Error(`Workspace supervisor did not become ready at ${baseUrl} within ${timeoutMs}ms (last failure: ${lastFailure}).`);
  }

  private async checkHealth(baseUrl: string, token: string): Promise<ProbeResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetch(`${baseUrl}/healthz`, {
        method: "GET",
        signal: controller.signal,
        headers: this.authHeaders(token)
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (response.ok) {
        const ready =
          payload &&
          typeof payload === "object" &&
          "ready" in payload &&
          typeof (payload as { ready?: unknown }).ready === "boolean"
            ? (payload as { ready: boolean }).ready
            : null;
        if (ready === false) {
          const readiness =
            payload &&
            typeof payload === "object" &&
            "readiness" in payload &&
            typeof (payload as { readiness?: unknown }).readiness === "object" &&
            (payload as { readiness: Record<string, unknown> }).readiness
              ? (payload as { readiness: Record<string, unknown> }).readiness
              : null;
          const phase =
            readiness && typeof readiness.phase === "string"
              ? readiness.phase
              : "unknown";
          const lastError =
            readiness && typeof readiness.lastError === "string" && readiness.lastError.trim()
              ? readiness.lastError
              : "";
          const detail = lastError ? ` phase=${phase} error=${lastError}` : ` phase=${phase}`;
          return {
            ok: false,
            status: response.status,
            error: `Supervisor reported not ready.${detail}`
          };
        }
      }
      return {
        ok: response.ok,
        status: response.status,
        error: null
      };
    } catch (error) {
      return {
        ok: false,
        status: null,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async checkSnapshot(baseUrl: string, token: string): Promise<ProbeResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_500);
    try {
      const response = await fetch(`${baseUrl}/snapshot`, {
        method: "GET",
        signal: controller.signal,
        headers: this.authHeaders(token)
      });
      return {
        ok: response.ok,
        status: response.status,
        error: null
      };
    } catch (error) {
      return {
        ok: false,
        status: null,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private authHeaders(token: string): Record<string, string> {
    if (!token) {
      return {};
    }
    return {
      Authorization: `Bearer ${token}`
    };
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}
