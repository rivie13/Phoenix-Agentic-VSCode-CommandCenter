import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface JarvisHostAudioPlaybackRequest {
  audioBase64: string;
  mimeType: string | null;
  reason: string;
  auto: boolean;
  spacingAfterMs?: number;
}

interface JarvisHostAudioPlayerLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

export class JarvisHostAudioPlayer {
  private readonly queue: JarvisHostAudioPlaybackRequest[] = [];
  private processing = false;
  private disposed = false;
  private activeChild: ChildProcess | null = null;
  private warnedUnsupportedPlatform = false;

  constructor(private readonly logger: JarvisHostAudioPlayerLogger) {}

  enqueue(request: JarvisHostAudioPlaybackRequest): boolean {
    if (this.disposed) {
      return false;
    }

    const normalizedAudio = normalizeAudioBase64(request.audioBase64);
    if (!normalizedAudio) {
      this.logger.warn(`[jarvis-audio-host] rejected empty payload (reason=${request.reason}, auto=${request.auto}).`);
      return false;
    }

    if (!this.canPlayOnHost()) {
      if (!this.warnedUnsupportedPlatform) {
        this.warnedUnsupportedPlatform = true;
        this.logger.warn(
          `[jarvis-audio-host] host playback is not configured for platform=${process.platform}; using webview playback.`
        );
      }
      return false;
    }

    this.queue.push({
      ...request,
      audioBase64: normalizedAudio
    });
    if (!this.processing) {
      void this.drainQueue();
    }
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    if (this.activeChild) {
      try {
        this.activeChild.kill();
      } catch {
        // no-op
      }
      this.activeChild = null;
    }
  }

  private canPlayOnHost(): boolean {
    return process.platform === "win32" || process.platform === "darwin" || process.platform === "linux";
  }

  private async drainQueue(): Promise<void> {
    if (this.processing || this.disposed) {
      return;
    }
    this.processing = true;
    try {
      while (!this.disposed) {
        const next = this.queue.shift();
        if (!next) {
          break;
        }
        try {
          await this.playRequest(next);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `[jarvis-audio-host] playback failed (reason=${next.reason}, auto=${next.auto}): ${message}`
          );
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async playRequest(request: JarvisHostAudioPlaybackRequest): Promise<void> {
    const bytes = decodeAudioBase64(request.audioBase64);
    if (!bytes) {
      throw new Error("invalid base64 audio payload");
    }

    const extension = extensionForMimeType(request.mimeType);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "phoenix-jarvis-audio-"));
    const filePath = path.join(tempDir, `jarvis-${Date.now()}.${extension}`);
    try {
      await fs.writeFile(filePath, bytes);
      await this.playFile(filePath, request.mimeType);
      this.logger.info(`[jarvis-audio-host] playback completed (reason=${request.reason}, auto=${request.auto}).`);
      const spacingAfterMs = Math.max(0, Math.min(10_000, Number(request.spacingAfterMs ?? 0)));
      if (spacingAfterMs > 0) {
        await this.sleep(spacingAfterMs);
      }
    } finally {
      await fs.rm(filePath, { force: true }).catch(() => {
        // no-op
      });
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {
        // no-op
      });
    }
  }

  private async playFile(filePath: string, mimeType: string | null): Promise<void> {
    if (process.platform === "win32") {
      await this.playFileWindows(filePath);
      return;
    }
    if (process.platform === "darwin") {
      await this.runProcess("afplay", [filePath], 90_000);
      return;
    }
    if (process.platform === "linux") {
      await this.playFileLinux(filePath, mimeType);
      return;
    }
    throw new Error(`unsupported platform: ${process.platform}`);
  }

  private async playFileWindows(filePath: string): Promise<void> {
    const escapedPath = filePath.replace(/'/g, "''");
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "Add-Type -AssemblyName presentationCore",
      `$path = '${escapedPath}'`,
      "$resolved = (Resolve-Path -LiteralPath $path).Path",
      "$uri = New-Object System.Uri($resolved)",
      "$player = New-Object System.Windows.Media.MediaPlayer",
      "$player.Open($uri)",
      "$waitUntil = [DateTime]::UtcNow.AddSeconds(10)",
      "while (-not $player.NaturalDuration.HasTimeSpan -and [DateTime]::UtcNow -lt $waitUntil) { Start-Sleep -Milliseconds 50 }",
      "$durationMs = 20000",
      "if ($player.NaturalDuration.HasTimeSpan) { $durationMs = [Math]::Min([Math]::Ceiling($player.NaturalDuration.TimeSpan.TotalMilliseconds) + 300, 120000) }",
      "$player.Play()",
      "Start-Sleep -Milliseconds $durationMs",
      "$player.Stop()",
      "$player.Close()"
    ].join("; ");

    await this.runProcess(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-Command", script],
      150_000
    );
  }

  private async playFileLinux(filePath: string, mimeType: string | null): Promise<void> {
    const attempts: Array<{ command: string; args: string[] }> = [];
    const isWave = Boolean(mimeType && /wav/i.test(mimeType));
    if (isWave) {
      attempts.push({ command: "aplay", args: [filePath] });
      attempts.push({ command: "paplay", args: [filePath] });
    } else {
      attempts.push({ command: "mpg123", args: [filePath] });
      attempts.push({ command: "ffplay", args: ["-nodisp", "-autoexit", "-loglevel", "error", filePath] });
      attempts.push({ command: "paplay", args: [filePath] });
    }

    let lastError: Error | null = null;
    for (const attempt of attempts) {
      try {
        await this.runProcess(attempt.command, attempt.args, 90_000);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastError = new Error(`${attempt.command}: ${message}`);
      }
    }

    throw lastError ?? new Error("no supported Linux audio player command found");
  }

  private async runProcess(command: string, args: string[], timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (this.activeChild === child) {
          this.activeChild = null;
        }
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const child = spawn(command, args, {
        stdio: "ignore",
        windowsHide: true
      });
      this.activeChild = child;

      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // no-op
        }
        finish(new Error(`process timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      child.once("error", (error) => {
        const message = error instanceof Error ? error.message : String(error);
        finish(new Error(message));
      });

      child.once("close", (code, signal) => {
        if (code === 0) {
          finish();
          return;
        }
        finish(new Error(`exitCode=${String(code)} signal=${String(signal ?? "")}`));
      });
    });
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

function normalizeAudioBase64(base64: string): string {
  const trimmed = String(base64 || "").trim();
  if (!trimmed) {
    return "";
  }
  const commaIndex = trimmed.indexOf(",");
  const payload = commaIndex >= 0 ? trimmed.slice(commaIndex + 1) : trimmed;
  return payload.replace(/\s+/g, "");
}

function decodeAudioBase64(base64: string): Buffer | null {
  if (!base64) {
    return null;
  }
  try {
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  }
}

function extensionForMimeType(mimeType: string | null): string {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("wav")) {
    return "wav";
  }
  if (normalized.includes("ogg")) {
    return "ogg";
  }
  if (normalized.includes("aac") || normalized.includes("mp4") || normalized.includes("m4a")) {
    return "m4a";
  }
  return "mp3";
}
