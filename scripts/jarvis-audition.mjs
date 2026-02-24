import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";

const PERSONALITIES = ["serene", "attentive", "alert", "escalating"];

function envNumber(name, fallback, min, max) {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parseArgs(argv) {
  const parsed = {
    baseUrl: (process.env.PHOENIX_JARVIS_AUDITION_BASE_URL ?? "").trim() || "http://127.0.0.1:8787",
    token: process.env.PHOENIX_JARVIS_AUDITION_AUTH_TOKEN ?? "",
    voice: (process.env.PHOENIX_JARVIS_AUDITION_VOICE ?? "").trim() || "onyx",
    script:
      (process.env.PHOENIX_JARVIS_AUDITION_SCRIPT ?? "").trim() ||
      "Phoenix operations check complete. Awaiting your next directive.",
    spacingMs: envNumber("PHOENIX_JARVIS_AUDITION_SPACING_MS", 600, 0, 10_000),
    timeoutMs: envNumber("PHOENIX_JARVIS_AUDITION_TIMEOUT_MS", 45_000, 5_000, 120_000),
    playback: true,
    outputRoot: path.join(process.cwd(), "artifacts", "jarvis-auditions")
  };

  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--base-url" && typeof next === "string") {
      parsed.baseUrl = next.trim() || parsed.baseUrl;
      index += 1;
      continue;
    }
    if (current === "--token" && typeof next === "string") {
      parsed.token = next;
      index += 1;
      continue;
    }
    if (current === "--script" && typeof next === "string") {
      parsed.script = next.trim() || parsed.script;
      index += 1;
      continue;
    }
    if (current === "--voice" && typeof next === "string") {
      parsed.voice = next.trim() || parsed.voice;
      index += 1;
      continue;
    }
    if (current === "--spacing-ms" && typeof next === "string") {
      const value = next.trim();
      const parsedNumber = Number(value);
      if (value.length > 0 && Number.isFinite(parsedNumber)) {
        parsed.spacingMs = Math.max(0, Math.min(10_000, Math.floor(parsedNumber)));
      }
      index += 1;
      continue;
    }
    if (current === "--timeout-ms" && typeof next === "string") {
      const value = next.trim();
      const parsedNumber = Number(value);
      if (value.length > 0 && Number.isFinite(parsedNumber)) {
        parsed.timeoutMs = Math.max(5_000, Math.min(120_000, Math.floor(parsedNumber)));
      }
      index += 1;
      continue;
    }
    if (current === "--output-root" && typeof next === "string") {
      parsed.outputRoot = path.resolve(next);
      index += 1;
      continue;
    }
    if (current === "--no-playback") {
      parsed.playback = false;
      continue;
    }
  }

  parsed.baseUrl = parsed.baseUrl.replace(/\/+$/, "");
  return parsed;
}

function normalizeAudioBase64(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) {
    return "";
  }
  const separator = trimmed.indexOf(",");
  const payload = separator >= 0 ? trimmed.slice(separator + 1) : trimmed;
  return payload.replace(/\s+/g, "");
}

function extensionFromMimeType(mimeType) {
  const normalized = String(mimeType ?? "").toLowerCase();
  if (normalized.includes("wav")) {
    return "wav";
  }
  if (normalized.includes("ogg")) {
    return "ogg";
  }
  if (normalized.includes("aac") || normalized.includes("m4a") || normalized.includes("mp4")) {
    return "m4a";
  }
  return "mp3";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runProcess(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      stdio: "ignore",
      windowsHide: true
    });

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // no-op
      }
      finish(new Error(`process timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    function finish(error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    child.once("error", (error) => {
      finish(error instanceof Error ? error : new Error(String(error)));
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

async function playFileWindows(filePath) {
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
    "$naturalMs = 0",
    "if ($player.NaturalDuration.HasTimeSpan) { $naturalMs = [Math]::Ceiling($player.NaturalDuration.TimeSpan.TotalMilliseconds) }",
    "if ($naturalMs -gt 0) { $durationMs = [Math]::Min($naturalMs + 300, 120000) }",
    "$player.Play()",
    "Start-Sleep -Milliseconds $durationMs",
    "$player.Stop()",
    "$player.Close()"
  ].join("; ");

  await runProcess(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-Command", script],
    150_000
  );
}

async function playFileLinux(filePath) {
  const attempts = [
    { command: "mpg123", args: [filePath] },
    { command: "ffplay", args: ["-nodisp", "-autoexit", "-loglevel", "error", filePath] },
    { command: "paplay", args: [filePath] },
    { command: "aplay", args: [filePath] }
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      await runProcess(attempt.command, attempt.args, 90_000);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("no supported Linux audio player command found");
}

async function playFile(filePath) {
  if (process.platform === "win32") {
    await playFileWindows(filePath);
    return;
  }
  if (process.platform === "darwin") {
    await runProcess("afplay", [filePath], 90_000);
    return;
  }
  if (process.platform === "linux") {
    await playFileLinux(filePath);
    return;
  }
  throw new Error(`unsupported platform: ${process.platform}`);
}

async function requestAudition(baseUrl, token, scriptText, personality, timeoutMs, voice) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (token.trim().length > 0) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/jarvis/respond`, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        sessionId: "jarvis-voice",
        agentId: "Jarvis",
        transport: "local",
        prompt: `Voice audition. Return exactly this text with no extra words: \"${scriptText}\"`,
        reason: `task-personality-audition-${personality}`,
        auto: false,
        includeAudio: true,
        personality,
        voice,
        service: "jarvis",
        mode: "voice",
        occurredAt: new Date().toISOString()
      })
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`HTTP ${response.status}${details ? `: ${details}` : ""}`);
    }

    const payload = await response.json();
    if (payload && payload.accepted === false) {
      throw new Error("Supervisor rejected the jarvis/respond request.");
    }

    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    const mimeType = typeof payload?.mimeType === "string" ? payload.mimeType : null;
    const audioBase64 = typeof payload?.audioBase64 === "string" ? payload.audioBase64 : null;
    const source = typeof payload?.source === "string" ? payload.source : "unknown";

    if (!text) {
      throw new Error("Response did not include summary text.");
    }

    return { text, mimeType, audioBase64, source };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(options.outputRoot, runStamp);

  await fs.mkdir(runDir, { recursive: true });

  console.log(`[jarvis-audition] baseUrl=${options.baseUrl}`);
  console.log(`[jarvis-audition] output=${runDir}`);
  console.log(`[jarvis-audition] script=${options.script}`);
  console.log(`[jarvis-audition] voice=${options.voice}`);
  console.log(`[jarvis-audition] playback=${options.playback} spacingMs=${options.spacingMs}`);

  const results = [];
  const audioFiles = [];

  for (let index = 0; index < PERSONALITIES.length; index += 1) {
    const personality = PERSONALITIES[index];
    process.stdout.write(`[jarvis-audition] ${index + 1}/${PERSONALITIES.length} ${personality} ... `);
    try {
      const response = await requestAudition(
        options.baseUrl,
        options.token,
        options.script,
        personality,
        options.timeoutMs,
        options.voice
      );

      let savedPath = null;
      if (response.audioBase64) {
        const normalized = normalizeAudioBase64(response.audioBase64);
        const bytes = Buffer.from(normalized, "base64");
        if (bytes.length > 0) {
          const extension = extensionFromMimeType(response.mimeType);
          const fileName = `${String(index + 1).padStart(2, "0")}-${personality}.${extension}`;
          savedPath = path.join(runDir, fileName);
          await fs.writeFile(savedPath, bytes);
          audioFiles.push(savedPath);
        }
      }

      results.push({
        personality,
        source: response.source,
        text: response.text,
        mimeType: response.mimeType,
        audioFilePath: savedPath,
        error: null
      });
      process.stdout.write("ok\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        personality,
        source: "error",
        text: "",
        mimeType: null,
        audioFilePath: null,
        error: message
      });
      process.stdout.write(`failed (${message})\n`);
    }

    await sleep(120);
  }

  const manifestPath = path.join(runDir, "manifest.json");
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        script: options.script,
        voice: options.voice,
        baseUrl: options.baseUrl,
        playbackEnabled: options.playback,
        spacingMs: options.spacingMs,
        results
      },
      null,
      2
    ),
    "utf8"
  );

  if (options.playback && audioFiles.length > 0) {
    console.log(`[jarvis-audition] playing ${audioFiles.length} saved clips in queue...`);
    for (let index = 0; index < audioFiles.length; index += 1) {
      const filePath = audioFiles[index];
      const label = path.basename(filePath);
      try {
        await playFile(filePath);
        console.log(`[jarvis-audition] played ${label}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[jarvis-audition] playback failed for ${label}: ${message}`);
      }

      if (index < audioFiles.length - 1 && options.spacingMs > 0) {
        await sleep(options.spacingMs);
      }
    }
  }

  const successful = results.filter((item) => !item.error).length;
  console.log(`[jarvis-audition] complete ${successful}/${results.length} personalities succeeded.`);
  console.log(`[jarvis-audition] manifest: ${manifestPath}`);

  if (successful === 0) {
    process.exitCode = 1;
  }
}

void main();
