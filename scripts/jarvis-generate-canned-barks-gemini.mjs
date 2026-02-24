import { promises as fs } from "node:fs";
import * as path from "node:path";

const DAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MINUTE_WINDOW_MS = 60_000;
const DEFAULT_MODEL = "gemini-2.5-flash-preview-tts";
const DEFAULT_VOICE = "Charon";

const BLOCK_DEFINITIONS = [
  {
    mode: "serene",
    filePersonality: "serene",
    temperature: 0.2,
    style: [
      "Character: Sophisticated British AI assistant. Received Pronunciation. Suave, polite, articulate, uses \"sir\" naturally.",
      "Style: Relaxed, melodic cadence. Slightly slower than average. Warm and reassuring tone. Leisurely and unbothered delivery."
    ].join("\n"),
    groups: [
      {
        intent: "ack",
        label: "Acknowledgment",
        phrases: ["Certainly, sir.", "Indeed, sir.", "Consider it done.", "A capital idea."]
      },
      {
        intent: "status",
        label: "Status Update",
        phrases: ["Checking the logs now, sir.", "Scanning the horizon for you.", "Fetching the latest data, one moment."]
      },
      {
        intent: "stop",
        label: "Stop/Abort",
        phrases: ["As you wish, stopping.", "Ceasing operations.", "Shutting it down, sir."]
      },
      {
        intent: "welcome",
        label: "Greeting/Welcome",
        phrases: ["Always here, sir.", "Good to see you again.", "How can I assist you this morning?"]
      },
      {
        intent: "thanks",
        label: "Gratitude",
        phrases: ["Always a pleasure, sir.", "The pleasure is mine."]
      },
      {
        intent: "busy",
        label: "Busy/Wait",
        phrases: ["One moment while I consult the records.", "Patience is a virtue, sir. Calculating..."]
      },
      {
        intent: "done",
        label: "Success/Done",
        phrases: ["All clear, sir. Tidy work.", "The workspace is back in order."]
      }
    ]
  },
  {
    mode: "attentive",
    filePersonality: "attentive",
    temperature: 0.45,
    style: [
      "Character: Sophisticated British AI assistant. Received Pronunciation. Suave, polite, articulate, uses \"sir\" naturally.",
      "Style: Professional focus. Crisp articulation, standard speed. Alert but calm, like a pilot in routine flight."
    ].join("\n"),
    groups: [
      {
        intent: "ack",
        label: "Acknowledgment",
        phrases: ["Right away.", "Acknowledged.", "Proceeding, sir.", "I'm on it."]
      },
      {
        intent: "status",
        label: "Status Update",
        phrases: ["Reviewing the board now.", "Getting the status update.", "Analyzing the current state."]
      },
      {
        intent: "stop",
        label: "Stop/Abort",
        phrases: ["Stopping now.", "Termination initiated.", "Abort confirmed."]
      },
      {
        intent: "welcome",
        label: "Greeting/Welcome",
        phrases: ["Listening, sir.", "What's the plan for today?"]
      },
      {
        intent: "thanks",
        label: "Gratitude",
        phrases: ["You are most welcome.", "Glad I could help."]
      },
      {
        intent: "busy",
        label: "Busy/Wait",
        phrases: ["Working on it now.", "Processing the request."]
      },
      {
        intent: "done",
        label: "Success/Done",
        phrases: ["Operation finished.", "Results are ready.", "Done."]
      }
    ]
  },
  {
    mode: "alert",
    filePersonality: "alert",
    temperature: 0.8,
    style: [
      "Character: Sophisticated British AI assistant. Received Pronunciation. Suave, polite, articulate, uses \"sir\" naturally.",
      "Style: Heightened focus and slightly lower pitch. Faster than normal with sharp emphasis. No leisurely inflection."
    ].join("\n"),
    groups: [
      {
        intent: "ack",
        label: "Acknowledgment",
        phrases: ["Moving at once.", "Prioritizing this now.", "No time to waste, sir."]
      },
      {
        intent: "status",
        label: "Status Update",
        phrases: ["Scanning for highlights.", "Checking what's blocked, sir."]
      },
      {
        intent: "stop",
        label: "Stop/Abort",
        phrases: ["Stopping immediately.", "Emergency stop active."]
      },
      {
        intent: "welcome",
        label: "Greeting/Welcome",
        phrases: ["Awaiting your command.", "System nominal, listening."]
      },
      {
        intent: "thanks",
        label: "Gratitude",
        phrases: ["Acknowledged, continuing work."]
      },
      {
        intent: "busy",
        label: "Busy/Wait",
        phrases: ["Calculating now, sir. Stand by.", "Hold on. I'm digging into this."]
      }
    ]
  },
  {
    mode: "escalating",
    filePersonality: "escalating",
    temperature: 0.9,
    style: [
      "Character: Sophisticated British AI assistant. Received Pronunciation. Suave, polite, articulate, uses \"sir\" naturally.",
      "Style: High urgency and intensity. Short breaths, sharp delivery. Serious and strained tone. Maximum brevity."
    ].join("\n"),
    groups: [
      {
        intent: "ack",
        label: "Acknowledgment",
        phrases: ["Acting now.", "Immediate execution.", "Full power."]
      },
      {
        intent: "status",
        label: "Status Update",
        phrases: ["Data incoming.", "Pulling high-priority logs."]
      },
      {
        intent: "stop",
        label: "Stop/Abort",
        phrases: ["ABORT CONFIRMED.", "Force-killing process."]
      },
      {
        intent: "busy",
        label: "Busy/Wait",
        phrases: ["Processing at max speed."]
      }
    ]
  },
  {
    mode: "snippy",
    filePersonality: "attentive",
    temperature: 0.6,
    style: [
      "Character: Sophisticated British AI assistant. Received Pronunciation. Suave, polite, articulate, uses \"sir\" naturally.",
      "Style: Slightly condescending but polite. British wit with a hint of exasperation. Sharp, crisp delivery."
    ].join("\n"),
    groups: [
      {
        intent: "ann",
        label: "Backlog Nagging",
        phrases: [
          "A bit of a crowd forming in the terminal list, isn't there?",
          "Do you plan on answering any of these, sir?",
          "The pending list is looking rather... substantial.",
          "I'm beginning to feel like a receptionist, sir.",
          "I do hate to nag, but the queue is quite full.",
          "Shall we address the backlog today, or is it a decoration?"
        ]
      }
    ]
  }
];

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestampLabel() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseJsonc(raw) {
  const withoutBlockComments = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLineComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, "");
  const withoutTrailingCommas = withoutLineComments.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(withoutTrailingCommas);
}

function parseListValue(raw) {
  if (typeof raw !== "string") {
    return [];
  }
  return raw
    .split(/[\n,;]/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeFilterValue(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function normalizeStringList(values) {
  return Array.from(new Set(values.map((entry) => normalizeFilterValue(entry)).filter((entry) => entry.length > 0)));
}

function buildStringSet(values) {
  return new Set(normalizeStringList(values));
}

function buildFileMatcher(values) {
  const normalized = normalizeStringList(values);
  const exact = new Map();
  const matchedExact = new Set();
  const patterns = [];

  for (const entry of normalized) {
    if (entry.includes("*") || entry.includes("?")) {
      patterns.push({ raw: entry, regex: wildcardToRegExp(entry), hits: 0 });
      continue;
    }
    exact.set(entry, entry);
  }

  return {
    active: exact.size > 0 || patterns.length > 0,
    exact,
    matchedExact,
    patterns
  };
}

function matchesFileMatcher(fileName, matcher, markHits = false) {
  if (!matcher.active) {
    return true;
  }
  const normalized = normalizeFilterValue(fileName);
  if (matcher.exact.has(normalized)) {
    if (markHits) {
      matcher.matchedExact.add(normalized);
    }
    return true;
  }
  for (const pattern of matcher.patterns) {
    if (pattern.regex.test(normalized)) {
      if (markHits) {
        pattern.hits += 1;
      }
      return true;
    }
  }
  return false;
}

function unmatchedFileSelectors(matcher) {
  if (!matcher.active) {
    return { exact: [], patterns: [] };
  }
  const exact = Array.from(matcher.exact.keys()).filter((entry) => !matcher.matchedExact.has(entry));
  const patterns = matcher.patterns.filter((entry) => entry.hits === 0).map((entry) => entry.raw);
  return { exact, patterns };
}

function buildDestinationPath(runDir, item, organize) {
  if (!organize) {
    return path.join(runDir, item.fileName);
  }
  return path.join(runDir, "generated", item.mode, item.intent, item.fileName);
}

async function loadSelectionEntries(selectionFilePath) {
  if (typeof selectionFilePath !== "string" || selectionFilePath.trim().length === 0) {
    return { entries: [], source: null };
  }

  const resolvedPath = path.resolve(selectionFilePath.trim());
  const raw = await fs.readFile(resolvedPath, "utf8");

  try {
    const parsed = parseJsonc(raw);
    if (Array.isArray(parsed)) {
      return { entries: normalizeStringList(parsed.map((entry) => String(entry))), source: resolvedPath };
    }
    if (parsed && typeof parsed === "object") {
      const jsonObject = parsed;
      const candidateArrays = [
        jsonObject.files,
        jsonObject.onlyFiles,
        jsonObject.include,
        jsonObject.selection,
        jsonObject.items,
        jsonObject.results
      ];
      const collected = [];
      for (const candidate of candidateArrays) {
        if (!Array.isArray(candidate)) {
          continue;
        }
        for (const entry of candidate) {
          if (typeof entry === "string") {
            collected.push(entry);
            continue;
          }
          if (entry && typeof entry === "object" && typeof entry.fileName === "string") {
            collected.push(entry.fileName);
          }
        }
      }
      if (collected.length > 0) {
        return { entries: normalizeStringList(collected), source: resolvedPath };
      }
    }
  } catch {
    // Fall through to plain-text parsing.
  }

  const textEntries = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("//"));
  return { entries: normalizeStringList(textEntries), source: resolvedPath };
}

function applySelectionFilters(allItems, options, selectionEntries) {
  const modeSet = buildStringSet(options.onlyModes);
  const intentSet = buildStringSet(options.onlyIntents);
  const personalitySet = buildStringSet(options.onlyPersonalities);
  const includeMatcher = buildFileMatcher([...options.onlyFiles, ...selectionEntries]);
  const excludeMatcher = buildFileMatcher(options.excludeFiles);

  const filtered = allItems.filter((item) => {
    if (modeSet.size > 0 && !modeSet.has(normalizeFilterValue(item.mode))) {
      return false;
    }
    if (intentSet.size > 0 && !intentSet.has(normalizeFilterValue(item.intent))) {
      return false;
    }
    if (personalitySet.size > 0 && !personalitySet.has(normalizeFilterValue(item.personality))) {
      return false;
    }
    if (includeMatcher.active && !matchesFileMatcher(item.fileName, includeMatcher, true)) {
      return false;
    }
    if (excludeMatcher.active && matchesFileMatcher(item.fileName, excludeMatcher)) {
      return false;
    }
    return true;
  });

  return {
    items: filtered,
    filterSummary: {
      modes: modeSet.size > 0 ? Array.from(modeSet) : [],
      intents: intentSet.size > 0 ? Array.from(intentSet) : [],
      personalities: personalitySet.size > 0 ? Array.from(personalitySet) : [],
      includeFiles: includeMatcher.active ? [...includeMatcher.exact.keys(), ...includeMatcher.patterns.map((entry) => entry.raw)] : [],
      excludeFiles: excludeMatcher.active ? [...excludeMatcher.exact.keys(), ...excludeMatcher.patterns.map((entry) => entry.raw)] : [],
      unmatchedIncludeSelectors: unmatchedFileSelectors(includeMatcher)
    }
  };
}

async function readJsoncFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return parseJsonc(raw);
  } catch {
    return null;
  }
}

async function resolveApiKey(cliApiKey) {
  if (typeof cliApiKey === "string" && cliApiKey.trim().length > 0) {
    return { key: cliApiKey.trim(), source: "--api-key" };
  }

  const envNames = [
    "PHOENIX_JARVIS_GEMINI_API_KEY",
    "SUPERVISOR_JARVIS_GEMINI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY"
  ];
  for (const name of envNames) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim().length > 0) {
      return { key: value.trim(), source: `env:${name}` };
    }
  }

  const workspaceSettingsPath = path.join(process.cwd(), ".vscode", "settings.json");
  const workspaceSettings = await readJsoncFile(workspaceSettingsPath);
  const workspaceKey = workspaceSettings?.["phoenixOps.jarvisGeminiApiKey"];
  if (typeof workspaceKey === "string" && workspaceKey.trim().length > 0) {
    return { key: workspaceKey.trim(), source: ".vscode/settings.json" };
  }

  const appData = process.env.APPDATA;
  if (typeof appData === "string" && appData.trim().length > 0) {
    const userSettingsPath = path.join(appData, "Code", "User", "settings.json");
    const userSettings = await readJsoncFile(userSettingsPath);
    const userKey = userSettings?.["phoenixOps.jarvisGeminiApiKey"];
    if (typeof userKey === "string" && userKey.trim().length > 0) {
      return { key: userKey.trim(), source: "VS Code user settings" };
    }
  }

  return { key: "", source: "none" };
}

function buildGenerationItems() {
  const items = [];
  let ordinal = 0;

  for (const block of BLOCK_DEFINITIONS) {
    for (const group of block.groups) {
      group.phrases.forEach((phrase, phraseIndex) => {
        ordinal += 1;
        const variation = String(phraseIndex + 1).padStart(2, "0");
        const fileName = `${group.intent}_${block.filePersonality}_${variation}.wav`;
        items.push({
          ordinal,
          mode: block.mode,
          personality: block.filePersonality,
          intent: group.intent,
          category: group.label,
          variation,
          text: phrase,
          fileName,
          style: block.style,
          temperature: block.temperature
        });
      });
    }
  }

  return items;
}

function buildPrompt(text, style) {
  return [
    "You are Jarvis, a British AI assistant with a sophisticated accent and personality.",
    "Your task is to synthesize one short canned bark line exactly as written.",
    "",
    "Delivery profile:",
    style,
    "",
    "Rules:",
    "- Keep pacing and expression aligned with the delivery profile.",
    "- Preserve the exact text content.",
    "- Do not add or remove words.",
    "",
    "Text to speak:",
    `\"${text}\"`
  ].join("\n");
}

function buildCompatibilityPrompt(text) {
  return `Say this exactly, with a sophisticated British assistant tone: ${text}`;
}

function estimateTokens(promptText) {
  return Math.max(1, Math.ceil(promptText.length / 4) + 80);
}

function normalizeAudioBase64(value) {
  const trimmed = String(value ?? "").trim();
  const prefixed = trimmed.match(/^data:audio\/[^;]+;base64,(.+)$/i);
  return prefixed ? prefixed[1].trim() : trimmed;
}

function asNonEmptyString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toInlineAudio(part) {
  if (!part || typeof part !== "object") {
    return null;
  }
  const rawPart = part;
  const inlineRaw = rawPart.inlineData ?? rawPart.inline_data;
  if (!inlineRaw || typeof inlineRaw !== "object") {
    return null;
  }
  const data = asNonEmptyString(inlineRaw.data);
  if (!data) {
    return null;
  }
  return {
    data: normalizeAudioBase64(data),
    mimeType: asNonEmptyString(inlineRaw.mimeType) ?? asNonEmptyString(inlineRaw.mime_type)
  };
}

function extractInlineAudio(payload) {
  const bytes = [];
  let mimeType = null;
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) {
      continue;
    }
    for (const part of parts) {
      const inline = toInlineAudio(part);
      if (!inline) {
        continue;
      }
      try {
        bytes.push(Buffer.from(inline.data, "base64"));
        if (!mimeType && inline.mimeType) {
          mimeType = inline.mimeType;
        }
      } catch {
        continue;
      }
    }
    if (bytes.length > 0) {
      break;
    }
  }

  if (bytes.length === 0) {
    return null;
  }

  return {
    data: Buffer.concat(bytes).toString("base64"),
    mimeType
  };
}

function parsePcmMimeType(mimeType) {
  if (!mimeType) {
    return null;
  }
  const [fileType, ...params] = mimeType.split(";").map((entry) => entry.trim());
  const [category, format] = fileType.split("/");
  if (category !== "audio" || !format || !format.toLowerCase().startsWith("l")) {
    return null;
  }

  const bits = Number.parseInt(format.slice(1), 10);
  const options = {
    numChannels: 1,
    sampleRate: 24_000,
    bitsPerSample: Number.isFinite(bits) && bits > 0 ? bits : 16
  };

  for (const param of params) {
    const [rawKey = "", rawValue = ""] = param.split("=").map((entry) => entry.trim().toLowerCase());
    const numeric = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }
    if (rawKey === "rate" || rawKey === "samplerate") {
      options.sampleRate = numeric;
    }
    if (rawKey === "channels" || rawKey === "channel") {
      options.numChannels = numeric;
    }
  }

  return options;
}

function createWavHeader(dataLength, options) {
  const byteRate = (options.sampleRate * options.numChannels * options.bitsPerSample) / 8;
  const blockAlign = (options.numChannels * options.bitsPerSample) / 8;
  const buffer = Buffer.alloc(44);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(options.numChannels, 22);
  buffer.writeUInt32LE(options.sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(options.bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

function normalizeGeminiAudio(inline) {
  const normalizedMime = (inline.mimeType ?? "").toLowerCase();
  const pcm = parsePcmMimeType(normalizedMime);
  if (!pcm) {
    return {
      audioBase64: normalizeAudioBase64(inline.data),
      mimeType: inline.mimeType ?? "audio/wav"
    };
  }
  const rawBytes = Buffer.from(inline.data, "base64");
  const header = createWavHeader(rawBytes.length, pcm);
  return {
    audioBase64: Buffer.concat([header, rawBytes]).toString("base64"),
    mimeType: "audio/wav"
  };
}

function retryAfterMs(headerValue, attemptNumber) {
  if (typeof headerValue === "string" && headerValue.trim().length > 0) {
    const numeric = Number(headerValue.trim());
    if (Number.isFinite(numeric) && numeric >= 0) {
      return Math.ceil(numeric * 1000);
    }
    const parsedDate = Date.parse(headerValue);
    if (Number.isFinite(parsedDate)) {
      return Math.max(0, parsedDate - Date.now());
    }
  }
  const cappedAttempt = Math.max(1, Math.min(7, attemptNumber));
  return Math.min(60_000, 1_500 * Math.pow(2, cappedAttempt - 1));
}

function describeError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function formatListPreview(values, maxItems = 12) {
  if (!Array.isArray(values) || values.length === 0) {
    return "";
  }
  if (values.length <= maxItems) {
    return values.join(",");
  }
  const visible = values.slice(0, maxItems).join(",");
  return `${visible} ...(+${values.length - maxItems} more)`;
}

class SlidingLimiter {
  constructor({ rpmLimit, tpmLimit, rpdLimit, minDelayMs }) {
    this.rpmLimit = rpmLimit;
    this.tpmLimit = tpmLimit;
    this.rpdLimit = rpdLimit;
    this.minDelayMs = minDelayMs;
    this.minuteEvents = [];
    this.dayStartMs = Date.now();
    this.requestsToday = 0;
    this.lastRequestMs = 0;
  }

  prune(nowMs) {
    this.minuteEvents = this.minuteEvents.filter((event) => nowMs - event.atMs < MINUTE_WINDOW_MS);
    if (nowMs - this.dayStartMs >= DAY_WINDOW_MS) {
      this.dayStartMs = nowMs;
      this.requestsToday = 0;
    }
  }

  async waitTurn(estimatedTokens) {
    while (true) {
      const nowMs = Date.now();
      this.prune(nowMs);

      if (this.requestsToday >= this.rpdLimit) {
        throw new Error(
          `Daily request budget reached (${this.requestsToday}/${this.rpdLimit}). Wait for the next day window or raise --rpd.`
        );
      }

      const minDelayWait = this.lastRequestMs > 0 ? this.minDelayMs - (nowMs - this.lastRequestMs) : 0;

      let rpmWait = 0;
      if (this.minuteEvents.length >= this.rpmLimit) {
        rpmWait = this.minuteEvents[0].atMs + MINUTE_WINDOW_MS - nowMs + 25;
      }

      const usedTokens = this.minuteEvents.reduce((total, event) => total + event.tokens, 0);
      let tpmWait = 0;
      if (usedTokens + estimatedTokens > this.tpmLimit && this.minuteEvents.length > 0) {
        const overflow = usedTokens + estimatedTokens - this.tpmLimit;
        let released = 0;
        for (const event of this.minuteEvents) {
          released += event.tokens;
          if (released >= overflow) {
            tpmWait = event.atMs + MINUTE_WINDOW_MS - nowMs + 25;
            break;
          }
        }
        if (tpmWait === 0) {
          tpmWait = this.minuteEvents[0].atMs + MINUTE_WINDOW_MS - nowMs + 25;
        }
      }

      const waitMs = Math.max(minDelayWait, rpmWait, tpmWait, 0);
      if (waitMs <= 0) {
        return;
      }
      await sleep(waitMs);
    }
  }

  noteRequest(tokens) {
    const nowMs = Date.now();
    this.prune(nowMs);
    this.lastRequestMs = nowMs;
    this.requestsToday += 1;
    this.minuteEvents.push({ atMs: nowMs, tokens: Math.max(1, tokens) });
  }
}

async function generateClip(input) {
  const {
    apiKey,
    model,
    voice,
    text,
    style,
    timeoutMs,
    maxRetries,
    debug
  } = input;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const primaryPrompt = buildPrompt(text, style);
  const compatibilityPrompt = buildCompatibilityPrompt(text);

  const requestWithRetries = async (promptText, promptLabel) => {
    let lastError = new Error("Gemini TTS request exhausted retries.");

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: promptText }]
              }
            ],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: voice
                  }
                }
              }
            }
          })
        });

        if (!response.ok) {
          const details = (await response.text()).trim();
          const retryable = response.status === 429 || response.status >= 500;
          const message = `Gemini TTS failed (HTTP ${response.status})${details ? `: ${details}` : ""}`;
          if (retryable && attempt < maxRetries) {
            const waitMs = retryAfterMs(response.headers.get("retry-after"), attempt);
            if (debug) {
              console.warn(`[jarvis-barks] ${promptLabel} retrying HTTP ${response.status} after ${waitMs}ms.`);
            }
            await sleep(waitMs);
            continue;
          }
          throw new Error(message);
        }

        const payload = await response.json();
        const inline = extractInlineAudio(payload);
        if (!inline) {
          throw new Error("Gemini response did not include inline audio.");
        }

        return normalizeGeminiAudio(inline);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const isLast = attempt >= maxRetries;
        if (!isLast) {
          const waitMs = retryAfterMs(null, attempt);
          if (debug) {
            console.warn(`[jarvis-barks] ${promptLabel} retry after ${waitMs}ms: ${describeError(error)}`);
          }
          await sleep(waitMs);
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError;
  };

  try {
    return await requestWithRetries(primaryPrompt, "primary");
  } catch (primaryError) {
    if (debug) {
      console.warn(`[jarvis-barks] primary prompt failed; trying compatibility prompt: ${describeError(primaryError)}`);
    }
  }

  return await requestWithRetries(compatibilityPrompt, "compatibility");
}

function parseArgs(argv) {
  const rpmLimit = envNumber("PHOENIX_JARVIS_BARKS_RPM", 8, 1, 10);
  const tpmLimit = envNumber("PHOENIX_JARVIS_BARKS_TPM", 8000, 256, 10000);
  const rpdLimit = envNumber("PHOENIX_JARVIS_BARKS_RPD", 90, 1, 100);

  const parsed = {
    apiKey: "",
    model: (process.env.PHOENIX_JARVIS_BARKS_MODEL ?? "").trim() || DEFAULT_MODEL,
    voice: (process.env.PHOENIX_JARVIS_BARKS_VOICE ?? "").trim() || DEFAULT_VOICE,
    outputRoot:
      (process.env.PHOENIX_JARVIS_BARKS_OUTPUT_ROOT ?? "").trim() ||
      path.join(process.cwd(), "artifacts", "jarvis-canned-barks"),
    runName: (process.env.PHOENIX_JARVIS_BARKS_RUN_NAME ?? "").trim(),
    rpmLimit,
    tpmLimit,
    rpdLimit,
    minDelayMs: envNumber("PHOENIX_JARVIS_BARKS_MIN_DELAY_MS", Math.ceil(MINUTE_WINDOW_MS / rpmLimit), 0, 120_000),
    timeoutMs: envNumber("PHOENIX_JARVIS_BARKS_TIMEOUT_MS", 120_000, 5_000, 300_000),
    maxRetries: envNumber("PHOENIX_JARVIS_BARKS_MAX_RETRIES", 5, 1, 10),
    maxItems: envNumber("PHOENIX_JARVIS_BARKS_MAX_ITEMS", Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER),
    onlyModes: [],
    onlyIntents: [],
    onlyPersonalities: [],
    onlyFiles: [],
    excludeFiles: [],
    selectionFile: "",
    organize: false,
    dryRun: false,
    resume: true,
    debug: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--api-key" && typeof next === "string") {
      parsed.apiKey = next;
      index += 1;
      continue;
    }
    if (current === "--model" && typeof next === "string") {
      parsed.model = next.trim() || parsed.model;
      index += 1;
      continue;
    }
    if (current === "--voice" && typeof next === "string") {
      parsed.voice = next.trim() || parsed.voice;
      index += 1;
      continue;
    }
    if (current === "--output-root" && typeof next === "string") {
      parsed.outputRoot = path.resolve(next);
      index += 1;
      continue;
    }
    if (current === "--run-name" && typeof next === "string") {
      parsed.runName = next.trim();
      index += 1;
      continue;
    }
    if (current === "--rpm" && typeof next === "string") {
      const value = Number(next.trim());
      if (Number.isFinite(value) && value > 0) {
        parsed.rpmLimit = Math.min(10, Math.floor(value));
      }
      index += 1;
      continue;
    }
    if (current === "--tpm" && typeof next === "string") {
      const value = Number(next.trim());
      if (Number.isFinite(value) && value > 0) {
        parsed.tpmLimit = Math.min(10_000, Math.floor(value));
      }
      index += 1;
      continue;
    }
    if (current === "--rpd" && typeof next === "string") {
      const value = Number(next.trim());
      if (Number.isFinite(value) && value > 0) {
        parsed.rpdLimit = Math.min(100, Math.floor(value));
      }
      index += 1;
      continue;
    }
    if (current === "--min-delay-ms" && typeof next === "string") {
      const value = Number(next.trim());
      if (Number.isFinite(value) && value >= 0) {
        parsed.minDelayMs = Math.max(0, Math.floor(value));
      }
      index += 1;
      continue;
    }
    if (current === "--timeout-ms" && typeof next === "string") {
      const value = Number(next.trim());
      if (Number.isFinite(value) && value > 0) {
        parsed.timeoutMs = Math.max(5_000, Math.floor(value));
      }
      index += 1;
      continue;
    }
    if (current === "--max-retries" && typeof next === "string") {
      const value = Number(next.trim());
      if (Number.isFinite(value) && value > 0) {
        parsed.maxRetries = Math.max(1, Math.min(10, Math.floor(value)));
      }
      index += 1;
      continue;
    }
    if (current === "--max-items" && typeof next === "string") {
      const value = Number(next.trim());
      if (Number.isFinite(value) && value > 0) {
        parsed.maxItems = Math.max(1, Math.floor(value));
      }
      index += 1;
      continue;
    }
    if (current === "--only-mode" && typeof next === "string") {
      parsed.onlyModes.push(...parseListValue(next));
      index += 1;
      continue;
    }
    if (current === "--only-intent" && typeof next === "string") {
      parsed.onlyIntents.push(...parseListValue(next));
      index += 1;
      continue;
    }
    if (current === "--only-personality" && typeof next === "string") {
      parsed.onlyPersonalities.push(...parseListValue(next));
      index += 1;
      continue;
    }
    if (current === "--only-file" && typeof next === "string") {
      parsed.onlyFiles.push(...parseListValue(next));
      index += 1;
      continue;
    }
    if (current === "--exclude-file" && typeof next === "string") {
      parsed.excludeFiles.push(...parseListValue(next));
      index += 1;
      continue;
    }
    if (current === "--selection-file" && typeof next === "string") {
      parsed.selectionFile = next.trim();
      index += 1;
      continue;
    }
    if (current === "--organize") {
      parsed.organize = true;
      continue;
    }
    if (current === "--flat") {
      parsed.organize = false;
      continue;
    }
    if (current === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (current === "--no-resume") {
      parsed.resume = false;
      continue;
    }
    if (current === "--resume") {
      parsed.resume = true;
      continue;
    }
    if (current === "--debug") {
      parsed.debug = true;
      continue;
    }
  }

  if (!parsed.runName) {
    parsed.runName = timestampLabel();
  }

  if (parsed.rpmLimit > 0 && parsed.minDelayMs < Math.ceil(MINUTE_WINDOW_MS / parsed.rpmLimit)) {
    parsed.minDelayMs = Math.ceil(MINUTE_WINDOW_MS / parsed.rpmLimit);
  }

  parsed.onlyModes = normalizeStringList(parsed.onlyModes);
  parsed.onlyIntents = normalizeStringList(parsed.onlyIntents);
  parsed.onlyPersonalities = normalizeStringList(parsed.onlyPersonalities);
  parsed.onlyFiles = normalizeStringList(parsed.onlyFiles);
  parsed.excludeFiles = normalizeStringList(parsed.excludeFiles);
  parsed.selectionFile = parsed.selectionFile.trim();

  return parsed;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const options = parseArgs(process.argv);
  const allItems = buildGenerationItems();
  const selectionInput = await loadSelectionEntries(options.selectionFile);
  const filtered = applySelectionFilters(allItems, options, selectionInput.entries);
  const limitedItems = filtered.items.slice(0, Math.max(1, Math.min(options.maxItems, filtered.items.length)));
  const selectedItems = limitedItems;

  if (selectedItems.length === 0) {
    throw new Error("No phrases matched the requested filters. Adjust --only-* selectors or --selection-file.");
  }

  const runDir = path.join(options.outputRoot, options.runName);
  await fs.mkdir(runDir, { recursive: true });

  const manifestPath = path.join(runDir, "manifest.json");
  const catalogPath = path.join(runDir, "phrases.json");
  await fs.writeFile(catalogPath, JSON.stringify({ generatedAt: new Date().toISOString(), items: selectedItems }, null, 2), "utf8");

  const resolved = await resolveApiKey(options.apiKey);
  if (!options.dryRun && resolved.key.length === 0) {
    throw new Error(
      "Gemini API key not found. Set phoenixOps.jarvisGeminiApiKey in VS Code settings, export GEMINI_API_KEY, or pass --api-key."
    );
  }

  const limiter = new SlidingLimiter({
    rpmLimit: options.rpmLimit,
    tpmLimit: options.tpmLimit,
    rpdLimit: options.rpdLimit,
    minDelayMs: options.minDelayMs
  });

  console.log(`[jarvis-barks] output=${runDir}`);
  console.log(`[jarvis-barks] model=${options.model} voice=${options.voice}`);
  console.log(
    `[jarvis-barks] limits rpm=${options.rpmLimit} tpm=${options.tpmLimit} rpd=${options.rpdLimit} minDelayMs=${options.minDelayMs}`
  );
  console.log(
    `[jarvis-barks] phrases=${selectedItems.length} dryRun=${options.dryRun} resume=${options.resume} organize=${options.organize}`
  );
  console.log(`[jarvis-barks] apiKeySource=${resolved.source}`);
  if (selectionInput.source) {
    console.log(`[jarvis-barks] selectionFile=${selectionInput.source}`);
  }
  if (filtered.filterSummary.modes.length > 0) {
    console.log(`[jarvis-barks] onlyModes=${formatListPreview(filtered.filterSummary.modes)}`);
  }
  if (filtered.filterSummary.intents.length > 0) {
    console.log(`[jarvis-barks] onlyIntents=${formatListPreview(filtered.filterSummary.intents)}`);
  }
  if (filtered.filterSummary.personalities.length > 0) {
    console.log(`[jarvis-barks] onlyPersonalities=${formatListPreview(filtered.filterSummary.personalities)}`);
  }
  if (filtered.filterSummary.includeFiles.length > 0) {
    console.log(`[jarvis-barks] onlyFiles=${formatListPreview(filtered.filterSummary.includeFiles)}`);
  }
  if (filtered.filterSummary.excludeFiles.length > 0) {
    console.log(`[jarvis-barks] excludeFiles=${formatListPreview(filtered.filterSummary.excludeFiles)}`);
  }
  if (filtered.filterSummary.unmatchedIncludeSelectors.exact.length > 0) {
    console.warn(
      `[jarvis-barks] unmatched exact selectors=${formatListPreview(filtered.filterSummary.unmatchedIncludeSelectors.exact)}`
    );
  }
  if (filtered.filterSummary.unmatchedIncludeSelectors.patterns.length > 0) {
    console.warn(
      `[jarvis-barks] unmatched wildcard selectors=${formatListPreview(filtered.filterSummary.unmatchedIncludeSelectors.patterns)}`
    );
  }

  if (selectedItems.length > options.rpdLimit) {
    console.warn(
      `[jarvis-barks] selected phrase count (${selectedItems.length}) exceeds configured RPD (${options.rpdLimit}). Reduce --max-items or raise --rpd.`
    );
  }

  const results = [];

  for (let index = 0; index < selectedItems.length; index += 1) {
    const item = selectedItems[index];
    const destination = buildDestinationPath(runDir, item, options.organize);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const prompt = buildPrompt(item.text, item.style);
    const estimatedTokens = estimateTokens(prompt);
    const prefix = `[jarvis-barks] ${String(index + 1).padStart(2, "0")}/${selectedItems.length} ${item.fileName}`;

    if (options.resume && (await exists(destination))) {
      console.log(`${prefix} skip-existing`);
      results.push({
        ...item,
        outputFile: destination,
        status: "skipped",
        reason: "file-exists",
        estimatedTokens
      });
      continue;
    }

    if (options.dryRun) {
      console.log(`${prefix} dry-run`);
      results.push({
        ...item,
        outputFile: destination,
        status: "dry-run",
        estimatedTokens
      });
      continue;
    }

    await limiter.waitTurn(estimatedTokens);
    process.stdout.write(`${prefix} generating ... `);
    const startedAt = Date.now();
    try {
      const clip = await generateClip({
        apiKey: resolved.key,
        model: options.model,
        voice: options.voice,
        text: item.text,
        style: item.style,
        temperature: item.temperature,
        timeoutMs: options.timeoutMs,
        maxRetries: options.maxRetries,
        debug: options.debug
      });

      const audioBytes = Buffer.from(clip.audioBase64, "base64");
      await fs.writeFile(destination, audioBytes);
      limiter.noteRequest(estimatedTokens);

      const elapsedMs = Date.now() - startedAt;
      process.stdout.write(`ok (${elapsedMs}ms)\n`);
      results.push({
        ...item,
        outputFile: destination,
        status: "ok",
        mimeType: clip.mimeType,
        bytes: audioBytes.length,
        elapsedMs,
        estimatedTokens
      });
    } catch (error) {
      const message = describeError(error);
      process.stdout.write(`failed (${message})\n`);
      results.push({
        ...item,
        outputFile: destination,
        status: "error",
        error: message,
        estimatedTokens
      });
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    runDir,
    model: options.model,
    voice: options.voice,
    apiKeySource: resolved.source,
    options: {
      dryRun: options.dryRun,
      resume: options.resume,
      organize: options.organize,
      rpmLimit: options.rpmLimit,
      tpmLimit: options.tpmLimit,
      rpdLimit: options.rpdLimit,
      minDelayMs: options.minDelayMs,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      maxItems: options.maxItems,
      onlyModes: options.onlyModes,
      onlyIntents: options.onlyIntents,
      onlyPersonalities: options.onlyPersonalities,
      onlyFiles: options.onlyFiles,
      excludeFiles: options.excludeFiles,
      selectionFile: selectionInput.source
    },
    selectionSummary: filtered.filterSummary,
    totals: {
      requested: selectedItems.length,
      ok: results.filter((entry) => entry.status === "ok").length,
      skipped: results.filter((entry) => entry.status === "skipped").length,
      dryRun: results.filter((entry) => entry.status === "dry-run").length,
      errors: results.filter((entry) => entry.status === "error").length
    },
    results
  };

  await fs.writeFile(manifestPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(`[jarvis-barks] manifest=${manifestPath}`);
  console.log(
    `[jarvis-barks] done ok=${summary.totals.ok} skipped=${summary.totals.skipped} dryRun=${summary.totals.dryRun} errors=${summary.totals.errors}`
  );

  if (summary.totals.errors > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(`[jarvis-barks] fatal: ${describeError(error)}`);
  process.exitCode = 1;
});