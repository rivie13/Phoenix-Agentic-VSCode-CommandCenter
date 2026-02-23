import * as fs from "node:fs";
import * as path from "node:path";
import { ChildProcess, spawn } from "node:child_process";
import * as vscode from "vscode";

export interface EmbeddedSupervisorConfig {
  host: string;
  port: number;
  apiToken: string;
  jarvisApiBaseUrl: string;
  jarvisApiKey: string;
  jarvisTextModel: string;
  jarvisSpeechModel: string;
  jarvisVoice: string;
  jarvisHardCooldownSeconds: number;
  jarvisSoftCooldownSeconds: number;
}

export class EmbeddedSupervisorManager implements vscode.Disposable {
  private readonly output: vscode.OutputChannel;
  private child: ChildProcess | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel("Phoenix Embedded Supervisor");
  }

  async ensureStarted(config: EmbeddedSupervisorConfig): Promise<string> {
    const baseUrl = `http://${config.host}:${config.port}`;

    if (await this.checkHealth(baseUrl, config.apiToken)) {
      return baseUrl;
    }

    await this.startProcess(config);
    await this.waitUntilHealthy(baseUrl, config.apiToken, 15_000);
    return baseUrl;
  }

  dispose(): void {
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
    this.output.dispose();
  }

  private async startProcess(config: EmbeddedSupervisorConfig): Promise<void> {
    if (this.child && !this.child.killed) {
      return;
    }

    const scriptPath = this.context.asAbsolutePath(path.join("out", "embeddedSupervisor", "server.js"));
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Embedded supervisor script not found at ${scriptPath}`);
    }

    this.output.appendLine(`Starting embedded supervisor from ${scriptPath}`);

    this.child = spawn(process.execPath, [scriptPath], {
      cwd: this.context.extensionPath,
      env: {
        ...process.env,
        PHOENIX_EMBEDDED_SUPERVISOR_HOST: config.host,
        PHOENIX_EMBEDDED_SUPERVISOR_PORT: String(config.port),
        PHOENIX_EMBEDDED_SUPERVISOR_API_TOKEN: config.apiToken,
        PHOENIX_EMBEDDED_JARVIS_API_BASE_URL: config.jarvisApiBaseUrl,
        PHOENIX_EMBEDDED_JARVIS_API_KEY: config.jarvisApiKey,
        PHOENIX_EMBEDDED_JARVIS_TEXT_MODEL: config.jarvisTextModel,
        PHOENIX_EMBEDDED_JARVIS_SPEECH_MODEL: config.jarvisSpeechModel,
        PHOENIX_EMBEDDED_JARVIS_VOICE: config.jarvisVoice,
        PHOENIX_EMBEDDED_JARVIS_HARD_COOLDOWN_SECONDS: String(config.jarvisHardCooldownSeconds),
        PHOENIX_EMBEDDED_JARVIS_SOFT_COOLDOWN_SECONDS: String(config.jarvisSoftCooldownSeconds)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    this.child.stdout?.on("data", (chunk) => {
      this.output.appendLine(`[embedded-supervisor] ${String(chunk).trimEnd()}`);
    });
    this.child.stderr?.on("data", (chunk) => {
      this.output.appendLine(`[embedded-supervisor:error] ${String(chunk).trimEnd()}`);
    });
    this.child.on("exit", (code, signal) => {
      this.output.appendLine(`Embedded supervisor exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
      this.child = null;
    });
  }

  private async waitUntilHealthy(baseUrl: string, token: string, timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.checkHealth(baseUrl, token)) {
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 350));
    }
    throw new Error(`Embedded supervisor did not become healthy at ${baseUrl} within ${timeoutMs}ms.`);
  }

  private async checkHealth(baseUrl: string, token: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(`${baseUrl}/healthz`, {
        method: "GET",
        signal: controller.signal,
        headers
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
