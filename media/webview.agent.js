const SESSION_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

function sessionActivityMs(session) {
  return Math.max(
    parseMs(session?.updatedAt) || 0,
    parseMs(session?.lastHeartbeat) || 0,
    parseMs(session?.startedAt) || 0
  );
}

function isSessionRecent(session, nowMs = Date.now()) {
  const activityMs = sessionActivityMs(session);
  return activityMs > 0 && (nowMs - activityMs) <= SESSION_RECENT_WINDOW_MS;
}

function classifySession(session) {
  if (session.archived) return "archived";
  const status = String(session.status || "").toLowerCase();
  if (status === "error") return "attention";
  if (status === "offline") return "offline";
  const stale = (Date.now() - (parseMs(session.lastHeartbeat) || 0)) > 120000;
  if (stale) return "attention";
  if (status === "busy" || status === "online") return "active";
  return "waiting";
}

function isJarvisActor(entry) {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const agentId = String(entry.agentId || "").trim().toLowerCase();
  if (agentId.includes("jarvis")) {
    return true;
  }
  const service = String(entry.service || "").trim().toLowerCase();
  if (service === "jarvis") {
    return true;
  }
  const mode = String(entry.mode || "").trim().toLowerCase();
  if (mode === "jarvis") {
    return true;
  }
  return false;
}

function listInteractiveSessions() {
  return (state.snapshot?.agents?.sessions || []).filter((session) => !isJarvisActor(session));
}

function isTerminalEligibleSession(session) {
  if (!session || typeof session !== "object") {
    return false;
  }
  const transport = String(session.transport || "").toLowerCase();
  if (transport !== "local" && transport !== "cli") {
    return false;
  }
  const status = String(session.status || "").toLowerCase();
  return status === "online" || status === "busy" || status === "waiting";
}

function listTerminalSessions() {
  return listInteractiveSessions().filter((session) => isTerminalEligibleSession(session));
}

function selectedSession() {
  if (!state.snapshot) return null;
  if (state.sessionLockId) {
    return listInteractiveSessions().find((session) => session.sessionId === state.sessionLockId) || null;
  }
  if (state.selected?.kind !== "session") return null;
  return listInteractiveSessions().find((session) => session.sessionId === state.selected.id) || null;
}

const terminalInstances = new Map();
const MAX_TERMINAL_BUFFER_CHARS = 240000;
const TERMINAL_VISUAL_REFRESH_INTERVAL_MS = 900;
const terminalWriteQueues = new Map();
const terminalWriteRafHandles = new Map();
const terminalMetaUpdateRafHandles = new Map();
const terminalFitRafHandles = new Map();
const terminalReportedSizes = new Map();
let previousTerminalSectionOpen = true;
let lastTerminalVisualRefreshAt = 0;

function resolveTerminalConstructor() {
  if (typeof window.Terminal === "function") {
    return window.Terminal;
  }
  return null;
}

function resolveFitAddonConstructor() {
  if (window.FitAddon && typeof window.FitAddon.FitAddon === "function") {
    return window.FitAddon.FitAddon;
  }
  return null;
}

function resolveCanvasAddonConstructor() {
  if (window.CanvasAddon && typeof window.CanvasAddon.CanvasAddon === "function") {
    return window.CanvasAddon.CanvasAddon;
  }
  return null;
}

function resolveCssVariable(name, fallback) {
  const style = window.getComputedStyle(document.documentElement);
  const value = style.getPropertyValue(name);
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

function resolveTerminalTheme() {
  return {
    foreground: resolveCssVariable("--vscode-terminal-foreground", "#d4d4d4"),
    background: resolveCssVariable("--vscode-terminal-background", "#1e1e1e"),
    cursor: resolveCssVariable("--vscode-terminal-cursorForeground", "#aeafad"),
    selectionBackground: resolveCssVariable("--vscode-terminal-selectionBackground", "#264f78"),
    black: resolveCssVariable("--vscode-terminal-ansiBlack", "#000000"),
    red: resolveCssVariable("--vscode-terminal-ansiRed", "#cd3131"),
    green: resolveCssVariable("--vscode-terminal-ansiGreen", "#0dbc79"),
    yellow: resolveCssVariable("--vscode-terminal-ansiYellow", "#e5e510"),
    blue: resolveCssVariable("--vscode-terminal-ansiBlue", "#2472c8"),
    magenta: resolveCssVariable("--vscode-terminal-ansiMagenta", "#bc3fbc"),
    cyan: resolveCssVariable("--vscode-terminal-ansiCyan", "#11a8cd"),
    white: resolveCssVariable("--vscode-terminal-ansiWhite", "#e5e5e5"),
    brightBlack: resolveCssVariable("--vscode-terminal-ansiBrightBlack", "#666666"),
    brightRed: resolveCssVariable("--vscode-terminal-ansiBrightRed", "#f14c4c"),
    brightGreen: resolveCssVariable("--vscode-terminal-ansiBrightGreen", "#23d18b"),
    brightYellow: resolveCssVariable("--vscode-terminal-ansiBrightYellow", "#f5f543"),
    brightBlue: resolveCssVariable("--vscode-terminal-ansiBrightBlue", "#3b8eea"),
    brightMagenta: resolveCssVariable("--vscode-terminal-ansiBrightMagenta", "#d670d6"),
    brightCyan: resolveCssVariable("--vscode-terminal-ansiBrightCyan", "#29b8db"),
    brightWhite: resolveCssVariable("--vscode-terminal-ansiBrightWhite", "#e5e5e5")
  };
}

function resolveTerminalFontFamily() {
  return resolveCssVariable("--vscode-editor-font-family", "Consolas, 'Courier New', monospace");
}

function resolveCssNumberVariable(name, fallback, min, max) {
  const raw = resolveCssVariable(name, String(fallback));
  const parsed = Number.parseFloat(String(raw).replace(/px$/i, "").trim());
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function resolveTerminalFontSize() {
  return resolveCssNumberVariable("--vscode-editor-font-size", 13, 11, 20);
}

function resolveTerminalLineHeight() {
  const fontSize = resolveTerminalFontSize();
  const lineHeightPx = resolveCssNumberVariable("--vscode-editor-line-height", fontSize * 1.45, fontSize, fontSize * 2.2);
  const ratio = lineHeightPx / fontSize;
  return Math.max(1.1, Math.min(1.8, ratio));
}

function resolveTerminalFontWeight() {
  const raw = resolveCssVariable("--vscode-editor-font-weight", "400").trim();
  return raw.length > 0 ? raw : "400";
}

function applyTerminalVisualOptions(terminal) {
  if (!terminal) {
    return;
  }
  terminal.options.theme = resolveTerminalTheme();
  terminal.options.fontFamily = resolveTerminalFontFamily();
  terminal.options.fontSize = resolveTerminalFontSize();
  terminal.options.lineHeight = resolveTerminalLineHeight();
  terminal.options.fontWeight = resolveTerminalFontWeight();
  terminal.options.fontWeightBold = "700";
  terminal.options.cursorStyle = "block";
  terminal.options.cursorInactiveStyle = "outline";
  terminal.options.minimumContrastRatio = 4.5;
}

function postTerminalSizeIfNeeded(sessionId, cols, rows) {
  if (!sessionId || state.terminal?.attachedSessionId !== sessionId) {
    return;
  }
  const normalizedCols = Number.isFinite(cols) ? Math.max(20, Math.floor(cols)) : null;
  const normalizedRows = Number.isFinite(rows) ? Math.max(8, Math.floor(rows)) : null;
  if (normalizedCols === null || normalizedRows === null) {
    return;
  }
  const previous = terminalReportedSizes.get(sessionId);
  if (previous && previous.cols === normalizedCols && previous.rows === normalizedRows) {
    return;
  }
  terminalReportedSizes.set(sessionId, { cols: normalizedCols, rows: normalizedRows });
  vscode.postMessage({
    type: "agentTerminalInput",
    sessionId,
    data: "",
    cols: normalizedCols,
    rows: normalizedRows
  });
}

function syncTerminalSizeFromInstance(sessionId, instance) {
  if (!sessionId || !instance?.terminal) {
    return;
  }
  postTerminalSizeIfNeeded(sessionId, instance.terminal.cols, instance.terminal.rows);
}

function fitTerminalInstance(instance) {
  if (!instance?.wrapper || !instance?.terminal) {
    return;
  }

  // Skip fit when the wrapper is not laid out (hidden via display:none).
  // The fit will happen again via requestAnimationFrame once the wrapper is shown.
  if (instance.wrapper.style.display === "none") {
    return;
  }

  if (instance.fitAddon && typeof instance.fitAddon.fit === "function") {
    try {
      instance.fitAddon.fit();
      return;
    } catch {
      // Fall through to approximate resize.
    }
  }

  const rect = instance.wrapper.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || typeof instance.terminal.resize !== "function") {
    return;
  }
  const estimatedCols = Math.max(40, Math.floor(rect.width / 9));
  const estimatedRows = Math.max(8, Math.floor(rect.height / 18));
  try {
    instance.terminal.resize(estimatedCols, estimatedRows);
  } catch {
    // No-op
  }
}

function scheduleTerminalFit(sessionId, instance) {
  if (!sessionId || !instance?.terminal || !instance?.wrapper) {
    return;
  }
  if (terminalFitRafHandles.has(sessionId)) {
    return;
  }
  const handle = requestAnimationFrame(() => {
    terminalFitRafHandles.delete(sessionId);
    fitTerminalInstance(instance);
    syncTerminalSizeFromInstance(sessionId, instance);
  });
  terminalFitRafHandles.set(sessionId, handle);
}

function enqueueTerminalWrite(sessionId, chunk) {
  if (!sessionId || typeof chunk !== "string" || chunk.length === 0) {
    return;
  }

  const queue = terminalWriteQueues.get(sessionId) || [];
  queue.push(chunk);
  terminalWriteQueues.set(sessionId, queue);

  if (terminalWriteRafHandles.has(sessionId)) {
    return;
  }

  const handle = requestAnimationFrame(() => {
    terminalWriteRafHandles.delete(sessionId);
    const pending = terminalWriteQueues.get(sessionId) || [];
    if (!pending.length) {
      terminalWriteQueues.delete(sessionId);
      return;
    }
    terminalWriteQueues.delete(sessionId);
    const instance = terminalInstances.get(sessionId);
    if (instance?.terminal) {
      instance.terminal.write(pending.join(""));
    }
  });

  terminalWriteRafHandles.set(sessionId, handle);
}

function scheduleTerminalMetaRefresh(sessionId) {
  if (!sessionId || state.terminal?.attachedSessionId !== sessionId) {
    return;
  }
  if (terminalMetaUpdateRafHandles.has(sessionId)) {
    return;
  }

  const handle = requestAnimationFrame(() => {
    terminalMetaUpdateRafHandles.delete(sessionId);
    if (state.terminal?.attachedSessionId !== sessionId) {
      return;
    }
    const meta = byId("agentTerminalMeta");
    if (meta) {
      meta.textContent = terminalStatusText(sessionId);
    }
  });

  terminalMetaUpdateRafHandles.set(sessionId, handle);
}

function readTerminalBuffer(sessionId) {
  if (!sessionId) {
    return "";
  }
  const raw = state.terminal?.buffers?.[sessionId];
  return typeof raw === "string" ? raw : "";
}

function writeTerminalBuffer(sessionId, nextValue) {
  if (!sessionId) {
    return;
  }
  if (!state.terminal || typeof state.terminal !== "object") {
    state.terminal = { buffers: {}, states: {}, attachedSessionId: null };
  }
  const text = String(nextValue || "");
  state.terminal.buffers[sessionId] = text.length > MAX_TERMINAL_BUFFER_CHARS
    ? text.slice(text.length - MAX_TERMINAL_BUFFER_CHARS)
    : text;
}

function appendTerminalBuffer(sessionId, chunk) {
  if (!sessionId || typeof chunk !== "string" || chunk.length === 0) {
    return;
  }

  if (!state.terminal || typeof state.terminal !== "object") {
    state.terminal = { buffers: {}, states: {}, attachedSessionId: null };
  }

  if (chunk.length >= MAX_TERMINAL_BUFFER_CHARS) {
    state.terminal.buffers[sessionId] = chunk.slice(chunk.length - MAX_TERMINAL_BUFFER_CHARS);
    return;
  }

  const current = readTerminalBuffer(sessionId);
  const keep = Math.max(0, MAX_TERMINAL_BUFFER_CHARS - chunk.length);
  const prefix = keep > 0 ? current.slice(-keep) : "";
  state.terminal.buffers[sessionId] = prefix + chunk;
}

function terminalStatusText(sessionId) {
  if (!sessionId) {
    return "No active terminal session.";
  }
  const session = listTerminalSessions().find((candidate) => candidate.sessionId === sessionId) || null;
  const stateLabel = state.terminal?.states?.[sessionId] || "unavailable";
  if (!session) {
    return `Session ${sessionId} | ${stateLabel}`;
  }
  return `${session.agentId} | ${session.transport} | ${session.status} | terminal ${stateLabel}`;
}

function ensureTerminalInstance(sessionId, mount) {
  const existing = terminalInstances.get(sessionId);
  if (existing) {
    return existing;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "agent-terminal-shell";
  wrapper.dataset.sessionId = sessionId;
  wrapper.style.display = "none";
  wrapper.tabIndex = -1;
  mount.appendChild(wrapper);

  const TerminalCtor = resolveTerminalConstructor();
  if (!TerminalCtor) {
    wrapper.classList.add("agent-terminal-shell--fallback");
    wrapper.textContent = "xterm.js unavailable in this webview session.";
    const fallback = {
      terminal: null,
      wrapper,
      inputSubscription: null,
      fitAddon: null,
      resizeObserver: null,
      focusListener: null,
      terminalFocusSubscription: null,
      terminalBlurSubscription: null,
      resizeSubscription: null
    };
    terminalInstances.set(sessionId, fallback);
    return fallback;
  }

  const FitAddonCtor = resolveFitAddonConstructor();
  const fitAddon = FitAddonCtor ? new FitAddonCtor() : null;

  const terminal = new TerminalCtor({
    cursorBlink: true,
    cursorStyle: "block",
    cursorInactiveStyle: "outline",
    convertEol: false,
    scrollback: 6000,
    fontSize: resolveTerminalFontSize(),
    fontFamily: resolveTerminalFontFamily(),
    lineHeight: resolveTerminalLineHeight(),
    fontWeight: resolveTerminalFontWeight(),
    fontWeightBold: "700",
    letterSpacing: 0,
    allowTransparency: true,
    minimumContrastRatio: 4.5,
    theme: resolveTerminalTheme()
  });

  if (fitAddon && typeof terminal.loadAddon === "function") {
    try {
      terminal.loadAddon(fitAddon);
    } catch {
      // No-op
    }
  }

  // Temporarily reveal the wrapper so xterm.js can measure container dimensions
  // during open(). Opening while display:none yields a 0×0 canvas which breaks
  // keyboard event capture and prevents proper initial sizing.
  wrapper.style.display = "block";
  terminal.open(wrapper);

  // Load canvas addon AFTER open() — it replaces the DOM renderer with a
  // hardware-accelerated canvas, which needs the terminal attached to the DOM.
  const CanvasAddonCtor = resolveCanvasAddonConstructor();
  if (CanvasAddonCtor && typeof terminal.loadAddon === "function") {
    try {
      terminal.loadAddon(new CanvasAddonCtor());
    } catch {
      // Canvas addon failed — DOM renderer fallback is fine.
    }
  }

  wrapper.style.display = "none";
  const focusListener = () => {
    state.terminal.attachedSessionId = sessionId;
    terminal.focus();
  };
  wrapper.addEventListener("pointerdown", focusListener);
  terminal.write(readTerminalBuffer(sessionId));

  const inputSubscription = terminal.onData((data) => {
    if (state.terminal.attachedSessionId !== sessionId) {
      return;
    }
    vscode.postMessage({
      type: "agentTerminalInput",
      sessionId,
      data
    });
  });

  // Sync PTY dimensions to the server whenever xterm.js is resized (via fit or manual resize).
  // Without this the PTY on the server retains its original size, causing output wrapping mismatches.
  const resizeSubscription = typeof terminal.onResize === "function"
    ? terminal.onResize(({ cols, rows }) => {
        postTerminalSizeIfNeeded(sessionId, cols, rows);
      })
    : null;

  const terminalFocusSubscription = typeof terminal.onFocus === "function"
    ? terminal.onFocus(() => {
        wrapper.classList.add("agent-terminal-shell--active");
      })
    : null;

  const terminalBlurSubscription = typeof terminal.onBlur === "function"
    ? terminal.onBlur(() => {
        wrapper.classList.remove("agent-terminal-shell--active");
      })
    : null;

  const instance = {
    terminal,
    wrapper,
    inputSubscription,
    resizeSubscription,
    terminalFocusSubscription,
    terminalBlurSubscription,
    fitAddon,
    resizeObserver: null,
    focusListener
  };

  if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(() => {
      if (state.terminal.attachedSessionId === sessionId) {
        scheduleTerminalFit(sessionId, instance);
      }
    });
    resizeObserver.observe(wrapper);
    instance.resizeObserver = resizeObserver;
  }

  scheduleTerminalFit(sessionId, instance);
  terminalInstances.set(sessionId, instance);
  return instance;
}

function cleanupTerminalInstances(activeSessionIds) {
  Array.from(terminalInstances.keys()).forEach((sessionId) => {
    if (activeSessionIds.has(sessionId)) {
      return;
    }

    const writeHandle = terminalWriteRafHandles.get(sessionId);
    if (typeof writeHandle === "number") {
      cancelAnimationFrame(writeHandle);
    }
    terminalWriteRafHandles.delete(sessionId);
    terminalWriteQueues.delete(sessionId);
    terminalReportedSizes.delete(sessionId);

    const metaHandle = terminalMetaUpdateRafHandles.get(sessionId);
    if (typeof metaHandle === "number") {
      cancelAnimationFrame(metaHandle);
    }
    terminalMetaUpdateRafHandles.delete(sessionId);

    const fitHandle = terminalFitRafHandles.get(sessionId);
    if (typeof fitHandle === "number") {
      cancelAnimationFrame(fitHandle);
    }
    terminalFitRafHandles.delete(sessionId);

    const instance = terminalInstances.get(sessionId);
    if (!instance) {
      return;
    }
    try {
      instance.inputSubscription?.dispose?.();
    } catch {
      // No-op
    }
    try {
      instance.resizeSubscription?.dispose?.();
    } catch {
      // No-op
    }
    try {
      instance.terminalFocusSubscription?.dispose?.();
    } catch {
      // No-op
    }
    try {
      instance.terminalBlurSubscription?.dispose?.();
    } catch {
      // No-op
    }
    try {
      instance.resizeObserver?.disconnect?.();
    } catch {
      // No-op
    }
    try {
      if (instance.focusListener) {
        instance.wrapper?.removeEventListener?.("pointerdown", instance.focusListener);
      }
    } catch {
      // No-op
    }
    try {
      instance.terminal?.dispose?.();
    } catch {
      // No-op
    }
    try {
      instance.wrapper?.remove?.();
    } catch {
      // No-op
    }
    terminalInstances.delete(sessionId);
  });
}

function chooseTerminalSession() {
  const selected = selectedSession();
  if (selected?.sessionId && isTerminalEligibleSession(selected)) {
    return selected.sessionId;
  }
  const first = listTerminalSessions()[0] || null;
  return first?.sessionId || null;
}

function isTextEntryElement(node) {
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
    return true;
  }
  return node instanceof HTMLElement && node.isContentEditable;
}

function renderTerminalPanel() {
  const mount = byId("agentTerminalMount");
  const meta = byId("agentTerminalMeta");
  const section = byId("agentTerminalSection");
  if (section instanceof HTMLDetailsElement) {
    section.open = state.ui.terminalSectionOpen;
  }
  const sectionIsOpen = !(section instanceof HTMLDetailsElement) || section.open;
  const sectionReopened = sectionIsOpen && previousTerminalSectionOpen !== sectionIsOpen;
  previousTerminalSectionOpen = sectionIsOpen;

  if (!mount || !meta) {
    return;
  }

  const activeSessionIds = new Set(listTerminalSessions().map((session) => session.sessionId));
  cleanupTerminalInstances(activeSessionIds);

  if (activeSessionIds.size === 0) {
    mount.innerHTML = "";
    mount.appendChild(emptyText("No interactive sessions available."));
    state.terminal.attachedSessionId = null;
    meta.textContent = "No active terminal session.";
    return;
  }

  const sessionId = chooseTerminalSession();
  if (!sessionId) {
    return;
  }

  // Remove any stale empty-state nodes (e.g. "No interactive sessions available.")
  // left from a previous render cycle when there were no active sessions.
  Array.from(mount.childNodes).forEach((node) => {
    if (!(node instanceof HTMLElement) || !node.classList.contains("agent-terminal-shell")) {
      mount.removeChild(node);
    }
  });

  const previousAttachedSessionId = state.terminal.attachedSessionId;
  const instance = ensureTerminalInstance(sessionId, mount);
  for (const [candidateSessionId, candidate] of terminalInstances.entries()) {
    if (!candidate?.wrapper) {
      continue;
    }
    candidate.wrapper.style.display = candidateSessionId === sessionId ? "block" : "none";
  }

  if (instance?.terminal) {
    const now = Date.now();
    const shouldRefreshVisuals =
      previousAttachedSessionId !== sessionId
      || (now - lastTerminalVisualRefreshAt) >= TERMINAL_VISUAL_REFRESH_INTERVAL_MS;

    if (shouldRefreshVisuals) {
      applyTerminalVisualOptions(instance.terminal);
      lastTerminalVisualRefreshAt = now;
    }

    if (previousAttachedSessionId !== sessionId || sectionReopened) {
      scheduleTerminalFit(sessionId, instance);
    }
  }

  state.terminal.attachedSessionId = sessionId;
  syncTerminalSizeFromInstance(sessionId, instance);
  meta.textContent = terminalStatusText(sessionId);
  const shouldAutoFocusTerminal =
    previousAttachedSessionId !== sessionId
    && sectionIsOpen
    && !isTextEntryElement(document.activeElement);

  if (shouldAutoFocusTerminal && instance?.terminal?.focus) {
    instance.terminal.focus();
  }
}

function handleTerminalChunkPayload(payload) {
  const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : "";
  const data = typeof payload?.data === "string" ? payload.data : "";
  if (!sessionId || !data) {
    return;
  }

  appendTerminalBuffer(sessionId, data);
  enqueueTerminalWrite(sessionId, data);
  scheduleTerminalMetaRefresh(sessionId);
}

function handleTerminalStatePayload(payload) {
  const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : "";
  if (!sessionId) {
    return;
  }
  const nextState = typeof payload?.state === "string" ? payload.state : "connected";
  state.terminal.states[sessionId] = nextState;
  scheduleTerminalMetaRefresh(sessionId);
}

function syncSelectedSessionFromSnapshot() {
  if (!state.snapshot) {
    return;
  }

  const sessions = [...listInteractiveSessions()]
    .sort((a, b) => (parseMs(b.updatedAt) || 0) - (parseMs(a.updatedAt) || 0));

  if (state.sessionLockId) {
    const locked = sessions.find((session) => session.sessionId === state.sessionLockId);
    if (locked) {
      state.selected = { kind: "session", id: locked.sessionId };
    }
    return;
  }

  if (state.selected?.kind === "session") {
    const exists = sessions.some((session) => session.sessionId === state.selected.id);
    if (exists) {
      return;
    }
    state.selected = null;
  }

  if (!state.selected && sessions.length) {
    const preferred = sessions.find((session) => !session.archived) || sessions[0];
    state.selected = { kind: "session", id: preferred.sessionId };
  }
}

function approximateTokenCount(text) {
  return Math.ceil(String(text || "").length / 4);
}

function asNonNegativeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.round(parsed);
    }
  }
  return null;
}

function readPathValue(record, path) {
  if (!record || typeof record !== "object") {
    return undefined;
  }
  const segments = String(path || "")
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  let current = record;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function firstNumberFromPaths(record, paths) {
  for (const path of paths) {
    const numeric = asNonNegativeNumber(readPathValue(record, path));
    if (numeric !== null) {
      return numeric;
    }
  }
  return null;
}

function firstStringFromPaths(record, paths) {
  for (const path of paths) {
    const value = readPathValue(record, path);
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function extractUsageStatsFromRecord(record) {
  const continues = firstNumberFromPaths(record, [
    "continues",
    "continueCount",
    "continue_count",
    "turns.user",
    "turn_counts.user",
    "stats.continues",
    "stats.continueCount",
    "stats.turns.user",
    "usage.continues",
    "usage.continueCount",
    "usage.turns.user",
    "metrics.continues",
    "metrics.continueCount",
    "metrics.turns.user"
  ]);

  const chatMessages = firstNumberFromPaths(record, [
    "chats",
    "chatCount",
    "chat_count",
    "messageCount",
    "message_count",
    "turns.total",
    "turn_counts.total",
    "stats.chats",
    "stats.chatCount",
    "stats.messageCount",
    "stats.turns.total",
    "usage.chats",
    "usage.chatCount",
    "usage.messageCount",
    "usage.turns.total",
    "metrics.chats",
    "metrics.chatCount",
    "metrics.messageCount",
    "metrics.turns.total"
  ]);

  const contextTokens = firstNumberFromPaths(record, [
    "contextTokens",
    "context_tokens",
    "tokenCount",
    "token_count",
    "usage.contextTokens",
    "usage.context_tokens",
    "usage.totalTokens",
    "usage.total_tokens",
    "usage.promptTokens",
    "usage.prompt_tokens",
    "stats.contextTokens",
    "stats.context_tokens",
    "stats.totalTokens",
    "stats.total_tokens",
    "metrics.contextTokens",
    "metrics.context_tokens",
    "metrics.totalTokens",
    "metrics.total_tokens"
  ]);

  const contextWindow = firstNumberFromPaths(record, [
    "contextWindow",
    "context_window",
    "maxContextTokens",
    "max_context_tokens",
    "usage.contextWindow",
    "usage.context_window",
    "usage.maxContextTokens",
    "usage.max_context_tokens",
    "stats.contextWindow",
    "stats.context_window",
    "stats.maxContextTokens",
    "stats.max_context_tokens",
    "metrics.contextWindow",
    "metrics.context_window",
    "metrics.maxContextTokens",
    "metrics.max_context_tokens"
  ]);

  const modelName = firstStringFromPaths(record, [
    "model",
    "modelName",
    "model_name",
    "usage.model",
    "usage.modelName",
    "usage.model_name",
    "stats.model",
    "stats.modelName",
    "stats.model_name",
    "metrics.model",
    "metrics.modelName",
    "metrics.model_name"
  ]);

  if (
    continues === null &&
    chatMessages === null &&
    contextTokens === null &&
    contextWindow === null &&
    modelName === null
  ) {
    return null;
  }

  return {
    continues,
    chatMessages,
    contextTokens,
    contextWindow,
    modelName
  };
}

function latestSessionFeedEntry(session) {
  if (!session?.sessionId) {
    return null;
  }
  const entries = (state.snapshot?.agents?.feed || [])
    .filter((entry) => !isJarvisFeedEntry(entry))
    .filter((entry) => entry.sessionId === session.sessionId)
    .sort((a, b) => (parseMs(b.occurredAt) || 0) - (parseMs(a.occurredAt) || 0));
  return entries[0] || null;
}

function buildSessionConversationRows(session) {
  const sessionId = session?.sessionId || null;
  const feedRows = (state.snapshot?.agents?.feed || [])
    .filter((entry) => !isJarvisFeedEntry(entry))
    .filter((entry) => !sessionId || entry.sessionId === sessionId)
    .map((entry) => {
      const parsed = parseFeedEntryForChat(entry);
      if (!parsed) {
        return null;
      }
      return {
        role: parsed.role,
        text: parsed.displayText,
        occurredAt: entry.occurredAt
      };
    })
    .filter(Boolean);

  const localRows = (state.chatLog || [])
    .filter((entry) => {
      if (!sessionId) {
        return true;
      }
      return !entry.sessionId || entry.sessionId === sessionId;
    })
    .map((entry) => ({
      role: entry.role || "system",
      text: entry.text || "",
      occurredAt: entry.occurredAt
    }));

  return [...feedRows, ...localRows];
}

function computeSessionStats(session) {
  if (!session) {
    return null;
  }
  const conversationRows = buildSessionConversationRows(session);
  const chatRows = conversationRows.filter((entry) => entry.role === "user" || entry.role === "agent");
  const estimatedContinues = chatRows.filter((entry) => entry.role === "user").length;
  const estimatedChatMessages = chatRows.length;
  const estimatedContextTokens = chatRows.reduce((total, entry) => total + approximateTokenCount(entry.text), 0);

  const sessionUsage = extractUsageStatsFromRecord(session);
  const feedUsage = extractUsageStatsFromRecord(latestSessionFeedEntry(session));
  const model = selectedModelInfo();
  const continues = sessionUsage?.continues ?? feedUsage?.continues ?? estimatedContinues;
  const chatMessages = sessionUsage?.chatMessages ?? feedUsage?.chatMessages ?? estimatedChatMessages;
  const contextTokens = sessionUsage?.contextTokens ?? feedUsage?.contextTokens ?? estimatedContextTokens;
  const contextWindow = sessionUsage?.contextWindow ?? feedUsage?.contextWindow ?? model?.contextWindow ?? null;
  const modelName = sessionUsage?.modelName ?? feedUsage?.modelName ?? model?.label ?? null;
  const contextPercent = contextWindow
    ? Math.min(100, Math.round((contextTokens / contextWindow) * 100))
    : null;
  const hasExactContinues = Boolean((sessionUsage && sessionUsage.continues !== null) || (feedUsage && feedUsage.continues !== null));
  const hasExactChats = Boolean((sessionUsage && sessionUsage.chatMessages !== null) || (feedUsage && feedUsage.chatMessages !== null));
  const hasExactContext = Boolean((sessionUsage && sessionUsage.contextTokens !== null) || (feedUsage && feedUsage.contextTokens !== null));
  const continuesSource = hasExactContinues ? "exact" : "estimate";
  const chatsSource = hasExactChats ? "exact" : "estimate";
  const contextSource = hasExactContext ? "exact" : "estimate";

  return {
    continues,
    chatMessages,
    contextTokens,
    contextWindow,
    contextPercent,
    modelName,
    continuesSource,
    chatsSource,
    contextSource
  };
}

function formatSessionStats(stats) {
  if (!stats) {
    return "No active session stats.";
  }
  const continuesLabel = stats.continuesSource === "exact" ? "Continues" : "Continues~";
  const chatsLabel = stats.chatsSource === "exact" ? "Chats" : "Chats~";
  const contextPrefix = stats.contextSource === "exact" ? "Ctx" : "Ctx est";
  const contextLine = stats.contextWindow
    ? `${contextPrefix} ${stats.contextTokens.toLocaleString()}/${stats.contextWindow.toLocaleString()} (${stats.contextPercent}%)`
    : `${contextPrefix} ${stats.contextTokens.toLocaleString()} tokens`;
  const modelLine = stats.modelName ? ` | Model ${stats.modelName}` : "";
  return `${continuesLabel} ${stats.continues} | ${chatsLabel} ${stats.chatMessages} | ${contextLine}${modelLine}`;
}

function resolveSessionServiceKey(session) {
  const explicitService = String(session?.service || "").trim().toLowerCase();
  if (explicitService === "codex" || explicitService === "copilot" || explicitService === "gemini") {
    return explicitService;
  }

  const agentId = String(session?.agentId || "").trim().toLowerCase();
  if (agentId.includes("copilot")) {
    return "copilot";
  }
  if (agentId.includes("gemini")) {
    return "gemini";
  }
  return "codex";
}

function resolveSessionRateLimitText(session) {
  const serviceKey = resolveSessionServiceKey(session);
  const serviceLabel = serviceKey.charAt(0).toUpperCase() + serviceKey.slice(1);
  const authState = normalizeCliAuthClientState(state.auth?.[serviceKey], serviceKey);

  if (authState.state === "limited") {
    const detail = authState.detail ? ` (${authState.detail})` : "";
    return `${serviceLabel}: limited${detail}`;
  }
  if (authState.state === "signed-in") {
    return `${serviceLabel}: ok`;
  }
  if (authState.state === "checking") {
    return `${serviceLabel}: checking`;
  }
  if (authState.state === "unavailable") {
    return `${serviceLabel}: unavailable`;
  }
  if (authState.state === "signed-out") {
    return `${serviceLabel}: signed out`;
  }
  return `${serviceLabel}: unknown`;
}

function buildSessionHoverTitle(session) {
  const stats = computeSessionStats(session);
  const contextLine = stats?.contextWindow
    ? `Context: ${stats.contextTokens.toLocaleString()}/${stats.contextWindow.toLocaleString()} (${stats.contextPercent}%)`
    : `Context: ${(stats?.contextTokens ?? 0).toLocaleString()} tokens`;
  const modelLine = stats?.modelName
    ? `Model: ${stats.modelName}`
    : `Model: ${String(session?.model || "unknown")}`;
  const repoLine = `Repo: ${session?.repository || "(none)"} | Branch: ${session?.branch || "(none)"}`;
  const workspaceLabel = session?.workspace ? session.workspace.replace(/.*[\\/]/, "") : "(none)";
  const workspaceLine = `Workspace: ${workspaceLabel}`;
  const activityLine = `Updated: ${formatTime(session?.updatedAt)} | Heartbeat: ${formatAge(session?.lastHeartbeat)}`;
  const usageLine = stats
    ? `${stats.continuesSource === "exact" ? "Continues" : "Continues~"}: ${stats.continues} | ${stats.chatsSource === "exact" ? "Chats" : "Chats~"}: ${stats.chatMessages}`
    : "Continues: 0 | Chats: 0";
  const rateLimitLine = `Rate limit: ${resolveSessionRateLimitText(session)}`;

  return [
    `${session?.agentId || "Agent"} (${session?.status || "unknown"})`,
    modelLine,
    contextLine,
    usageLine,
    rateLimitLine,
    repoLine,
    workspaceLine,
    activityLine
  ].join("\n");
}

function sessionIsRunning(session) {
  if (!session) {
    return false;
  }
  const status = String(session.status || "").toLowerCase();
  return status === "busy" || status === "online";
}

function requestStopSession() {
  const session = selectedSession();
  if (!session || !sessionIsRunning(session)) {
    return;
  }
  vscode.postMessage({
    type: "agentStop",
    sessionId: session.sessionId,
    agentId: session.agentId,
    transport: session.transport
  });
  appendChatRow("system", `Stop requested for ${session.agentId}.`, session.sessionId);
}

function renderStopButtons() {
  const fromChat = byId("stopSessionFromChatButton");
  const fromComposer = byId("stopSessionFromComposerButton");
  const session = selectedSession();
  const canStop = sessionIsRunning(session);
  const label = canStop ? `Stop ${session.agentId}` : "Stop";

  [fromChat, fromComposer].forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    button.disabled = !canStop;
    button.textContent = label;
  });
}

function autoResizeComposerInput() {
  const input = byId("agentMessageInput");
  if (!(input instanceof HTMLTextAreaElement)) {
    return;
  }
  const maxHeight = 260;
  input.style.height = "auto";
  const nextHeight = Math.min(maxHeight, input.scrollHeight);
  input.style.height = `${Math.max(110, nextHeight)}px`;
  input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
}

function createSessionCard(session) {
  const cls = classifySession(session);
  const collapsed = Boolean(state.sessionCollapse[session.sessionId]);

  const row = document.createElement("div");
  row.className = `session-row session-row--${cls}`;
  row.title = buildSessionHoverTitle(session);
  if (state.selected?.kind === "session" && state.selected.id === session.sessionId) row.classList.add("selected");
  if (session.pinned) row.classList.add("session-row--pinned");

  // Header: dot + name + transport badge + hover actions
  const header = document.createElement("div");
  header.className = "session-row-header";

  const dot = document.createElement("span");
  dot.className = "session-status-dot";
  dot.title = cls;
  header.appendChild(dot);

  const titleWrap = document.createElement("div");
  titleWrap.className = "session-row-title";
  const nameSpan = document.createElement("span");
  nameSpan.className = "session-row-name";
  nameSpan.textContent = session.agentId;
  titleWrap.appendChild(nameSpan);
  const badge = document.createElement("span");
  badge.className = "session-transport-badge";
  badge.textContent = session.transport;
  titleWrap.appendChild(badge);
  header.appendChild(titleWrap);

  // Compact action buttons (visible on hover / selection)
  const actions = document.createElement("div");
  actions.className = "session-row-actions";

  const pin = document.createElement("button");
  pin.className = "session-row-btn";
  pin.type = "button";
  pin.textContent = session.pinned ? "Unpin" : "Pin";
  pin.title = session.pinned ? "Unpin session" : "Pin session";
  pin.onclick = (e) => { e.stopPropagation(); vscode.postMessage({ type: "sessionPin", sessionId: session.sessionId, pinned: !session.pinned }); };
  actions.appendChild(pin);

  const archive = document.createElement("button");
  archive.className = "session-row-btn";
  archive.type = "button";
  archive.textContent = session.archived ? "Restore" : "Archive";
  archive.title = session.archived ? "Restore session" : "Archive session";
  archive.onclick = (e) => { e.stopPropagation(); vscode.postMessage({ type: session.archived ? "sessionRestore" : "sessionArchive", sessionId: session.sessionId }); };
  actions.appendChild(archive);

  const openEditor = document.createElement("button");
  openEditor.className = "session-row-btn session-row-btn--primary";
  openEditor.type = "button";
  openEditor.textContent = "Open";
  openEditor.title = "Open in editor";
  openEditor.onclick = (e) => { e.stopPropagation(); vscode.postMessage({ type: "openSessionEditor", sessionId: session.sessionId }); };
  actions.appendChild(openEditor);

  header.appendChild(actions);
  row.appendChild(header);

  // Status meta line
  const meta = document.createElement("div");
  meta.className = "session-row-meta";
  const metaParts = [session.status, `heartbeat ${formatAge(session.lastHeartbeat)}`];
  if (session.summary) metaParts.push(session.summary);
  meta.textContent = metaParts.join(" · ");
  row.appendChild(meta);

  // Expanded detail (repo / workspace)
  if (!collapsed) {
    const detail = document.createElement("div");
    detail.className = "session-row-detail";
    const repo = session.repository || "(none)";
    const branch = session.branch || "(none)";
    const ws = session.workspace ? session.workspace.replace(/.*[\\/]/, "") : "(none)";
    detail.textContent = `${repo} / ${branch} · ${ws} · ${formatTime(session.updatedAt)}`;
    row.appendChild(detail);
  }

  row.onclick = (e) => {
    if (state.sessionLockId || e.target.closest(".session-row-actions")) return;
    state.selected = { kind: "session", id: session.sessionId };
    state.sessionCollapse[session.sessionId] = !collapsed;
    render();
  };
  return row;
}

function renderSessionBucket(root, heading, sessions) {
  if (!sessions.length) return;
  const bucket = document.createElement("div");
  bucket.className = "session-bucket";
  const title = document.createElement("div");
  title.className = "session-bucket-heading";
  title.textContent = `${heading} (${sessions.length})`;
  bucket.appendChild(title);
  const list = document.createElement("div");
  list.className = "session-list";
  sessions.forEach((session) => list.appendChild(createSessionCard(session)));
  bucket.appendChild(list);
  root.appendChild(bucket);
}

function renderSessions() {
  const root = byId("agentSessions");
  const counts = byId("sessionCounts");
  const showArchived = byId("showArchivedSessions");
  const showOlder = byId("showOlderSessions");
  if (!root || !counts) {
    return;
  }
  root.innerHTML = "";
  if (showArchived instanceof HTMLInputElement) {
    showArchived.checked = state.showArchived;
  }
  if (showOlder instanceof HTMLInputElement) {
    showOlder.checked = state.showOlderSessions;
  }

  const nowMs = Date.now();
  const sessions = [...listInteractiveSessions()].sort((a, b) => (parseMs(b.updatedAt) || 0) - (parseMs(a.updatedAt) || 0));
  if (state.sessionLockId && !state.selected) {
    state.selected = { kind: "session", id: state.sessionLockId };
  }
  const pendingApprovals = (state.snapshot?.agents?.pendingCommands || [])
    .filter((command) => command.status === "pending")
    .filter((command) => !isJarvisActor(command));
  const recentSessions = sessions.filter((session) => isSessionRecent(session, nowMs));
  const olderSessions = sessions.filter((session) => !isSessionRecent(session, nowMs));
  const scoped = state.sessionLockId ? sessions.filter((s) => s.sessionId === state.sessionLockId) : sessions;
  const scopedRecent = scoped.filter((session) => isSessionRecent(session, nowMs));
  const scopedOlder = scoped.filter((session) => !isSessionRecent(session, nowMs));
  const windowed = (state.showOlderSessions || state.sessionLockId) ? scoped : scopedRecent;
  const archived = windowed.filter((s) => s.archived);
  const visible = state.showArchived ? windowed : windowed.filter((s) => !s.archived);
  const pinned = visible.filter((s) => s.pinned && !s.archived);
  const active = visible.filter((s) => !s.pinned && classifySession(s) === "active");
  const waiting = visible.filter((s) => !s.pinned && classifySession(s) === "waiting");
  const attention = visible.filter((s) => !s.pinned && classifySession(s) === "attention");
  const offline = visible.filter((s) => !s.pinned && classifySession(s) === "offline");

  counts.textContent =
    `Sessions ${sessions.length} | Last 24h ${recentSessions.length} | Older ${olderSessions.length} | ` +
    `Pinned ${pinned.length} | Archived ${archived.length} | Pending ${pendingApprovals.length}`;

  if (!sessions.length) {
    root.appendChild(emptyText("No sessions reported by supervisor."));
    return;
  }
  if (!scoped.length) {
    root.appendChild(emptyText("Locked session is not currently active."));
    return;
  }
  if (!windowed.length && !state.showOlderSessions && scopedOlder.length > 0) {
    root.appendChild(emptyText("No sessions in the last 24h. Enable 'Show older than 24h' to view older sessions."));
    return;
  }
  if (pinned.length) renderSessionBucket(root, "Pinned", pinned);
  renderSessionBucket(root, "Active", active);
  renderSessionBucket(root, "Waiting", waiting);
  renderSessionBucket(root, "Needs Attention", attention);
  if (offline.length) renderSessionBucket(root, "Offline", offline);
  if (state.showArchived) renderSessionBucket(root, "Archived", archived);
}

function textLine(text, className = "meta-line") {
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  return div;
}

function renderJarvisSupervisorSection() {
  const jarvisSection = byId("agentJarvisSection");
  const jarvisMeta = byId("jarvisSectionMeta");

  if (jarvisSection instanceof HTMLDetailsElement) {
    jarvisSection.open = state.ui.jarvisSectionOpen;
  }

  if (jarvisMeta) {
    const mode = !state.jarvis.enabled
      ? "disabled"
      : (state.jarvis.manualMode ? "manual" : "auto");
    const apiHealth = state.jarvis.chatDegraded || state.jarvis.speechDegraded
      ? "API degraded"
      : "API healthy";
    const reason = state.jarvis.lastReason ? `Reason: ${state.jarvis.lastReason}` : "";
    const focus = state.jarvis.focusLabel ? `Focus: ${state.jarvis.focusLabel}` : "";
    jarvisMeta.textContent = [
      `Mode: ${mode}`,
      apiHealth,
      reason,
      focus
    ].filter((part) => part.length > 0).join(" | ");
  }
}

function renderDetail() {
  const root = byId("detailPanel");
  if (!root) {
    return;
  }
  root.innerHTML = "";
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.appendChild(textLine("Detail", "lane-title"));

  if (!state.snapshot || !state.selected) {
    panel.appendChild(emptyText("Select a board item, workflow run, or agent session."));
    root.appendChild(panel);
    return;
  }

  if (state.selected.kind === "issue") {
    const item = state.snapshot.board.items.find((entry) => entry.itemId === state.selected.id);
    if (item) {
      panel.appendChild(textLine(item.title || "Untitled", "detail-title"));
      panel.appendChild(textLine(`Repo: ${item.repo || "unknown"}`));
      panel.appendChild(textLine(`Issue: #${item.issueNumber || "?"}`));
      panel.appendChild(textLine(`Status: ${item.status || "unknown"}`));
      panel.appendChild(textLine(`Work mode: ${item.workMode || "(none)"}`));
      panel.appendChild(textLine(`Area: ${item.area || "(none)"}`));
      panel.appendChild(textLine(`Priority: ${item.priority || "(none)"}`));
      panel.appendChild(textLine(`Size: ${item.size || "(none)"}`));
      panel.appendChild(textLine(`Claim owner: ${item.claimOwner || "(none)"}`));
      panel.appendChild(textLine(`Lease expires: ${item.leaseExpires || "(none)"}`));
      panel.appendChild(textLine(`Last heartbeat: ${item.lastHeartbeat || "(none)"}`));
    }
  }

  if (state.selected.kind === "run") {
    const run = state.snapshot.actions.runs.find((entry) => entry.id === state.selected.id);
    if (run) {
      panel.appendChild(textLine(run.workflowName || run.name || "Workflow", "detail-title"));
      panel.appendChild(textLine(`Repo: ${run.repo}`));
      panel.appendChild(textLine(`Branch: ${run.headBranch || "(no branch)"}`));
      panel.appendChild(textLine(`Event: ${run.event || "(unknown)"}`));
      panel.appendChild(textLine(`Status: ${run.status}`));
      panel.appendChild(textLine(`Conclusion: ${run.conclusion || "(pending)"}`));
      panel.appendChild(textLine(`Updated: ${formatTime(run.updatedAt)}`));
      const actions = document.createElement("div");
      actions.className = "inline-actions";
      const open = document.createElement("button");
      open.type = "button";
      open.textContent = "Open in GitHub";
      open.onclick = () => openRun(run.url);
      actions.appendChild(open);
      panel.appendChild(actions);
      renderJobsSummary(panel, run.id);
    }
  }

  if (state.selected.kind === "pullRequest") {
    const pullRequest = state.snapshot.actions.pullRequests.find((entry) => entry.id === state.selected.id);
    if (pullRequest) {
      panel.appendChild(textLine(`#${pullRequest.number} ${pullRequest.title}`, "detail-title"));
      panel.appendChild(textLine(`Repo: ${pullRequest.repo}`));
      panel.appendChild(textLine(`State: ${pullRequest.state}`));
      panel.appendChild(textLine(`Review: ${pullRequest.reviewState}`));
      panel.appendChild(textLine(`Draft: ${pullRequest.isDraft ? "yes" : "no"}`));
      panel.appendChild(textLine(`Branch: ${pullRequest.headBranch || "(head)"} -> ${pullRequest.baseBranch || "(base)"}`));
      panel.appendChild(textLine(`Updated: ${formatTime(pullRequest.updatedAt)}`));
      const actions = document.createElement("div");
      actions.className = "inline-actions";
      const open = document.createElement("button");
      open.type = "button";
      open.textContent = "Open in GitHub";
      open.onclick = () => vscode.postMessage({ type: "openPullRequest", url: pullRequest.url });
      actions.appendChild(open);
      panel.appendChild(actions);
    }
  }

  if (state.selected.kind === "session") {
    const session = selectedSession();
    if (session) {
      panel.appendChild(textLine(session.agentId, "detail-title"));
      panel.appendChild(textLine(`Session: ${session.sessionId}`));
      panel.appendChild(textLine(`Status: ${session.status}`));
      panel.appendChild(textLine(`Pinned: ${session.pinned ? "yes" : "no"}`));
      panel.appendChild(textLine(`Archived: ${session.archived ? "yes" : "no"}`));
      panel.appendChild(textLine(`Last heartbeat: ${formatTime(session.lastHeartbeat)} (${formatAge(session.lastHeartbeat)})`));
      const actions = document.createElement("div");
      actions.className = "inline-actions";
      const openSession = document.createElement("button");
      openSession.type = "button";
      openSession.textContent = "Open Session in Editor";
      openSession.onclick = () => vscode.postMessage({ type: "openSessionEditor", sessionId: session.sessionId });
      actions.appendChild(openSession);
      panel.appendChild(actions);
    }
  }

  root.appendChild(panel);
}

function renderControlMeta() {
  const meta = byId("selectedSessionMeta");
  const statsMeta = byId("chatSessionStats");
  const session = selectedSession();
  const stats = computeSessionStats(session);
  const codexMeta = formatCliAuthMeta("Codex", state.auth?.codex);
  const copilotMeta = formatCliAuthMeta("Copilot", state.auth?.copilot);
  const geminiMeta = formatCliAuthMeta("Gemini", state.auth?.gemini);
  const authMeta = `${codexMeta} | ${copilotMeta} | ${geminiMeta}`;
  if (meta) {
    meta.textContent = session
      ? `Selected: ${session.agentId} (${session.sessionId}) | ${session.transport} | ${session.status} | Continues ${stats?.continues ?? 0} | Chats ${stats?.chatMessages ?? 0} | ${authMeta}`
      : `No session selected. ${authMeta}`;
  }
  if (statsMeta) {
    statsMeta.textContent = formatSessionStats(stats);
  }
}

function formatReasoningEffortLabel(effort) {
  const normalized = String(effort || "").trim().toLowerCase();
  if (!normalized) {
    return "Model default";
  }
  if (normalized === "xhigh") {
    return "Extra High";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function renderChatComposerLayout() {
  const composer = byId("chatComposer");
  const contextPanel = byId("contextPickerPanel");
  const contextToggle = byId("toggleContextPickerButton");
  const transportSelect = byId("composerTransportSelect");
  const modeSelect = byId("composerModeSelect");
  const serviceSelect = byId("composerServiceSelect");
  const modelSelect = byId("composerModelSelect");
  const effortSelect = byId("composerEffortSelect");
  const toolSelect = byId("composerToolSelect");
  const mcpToolsSelect = byId("composerMcpToolsSelect");
  const cloudControls = byId("composerCloudControls");
  const issueNumberInput = byId("composerIssueNumberInput");
  const issueNodeIdInput = byId("composerIssueNodeIdInput");
  const cloudStatus = byId("composerCloudStatus");
  if (!composer) {
    return;
  }

  ensureComposeDefaults();
  composer.classList.add("visible");
  if (contextPanel) {
    contextPanel.classList.toggle("open", state.ui.contextPickerOpen);
  }
  if (contextToggle) {
    contextToggle.textContent = state.ui.contextPickerOpen ? "Hide Context" : "Add Context...";
  }
  if (transportSelect instanceof HTMLSelectElement) {
    transportSelect.value = state.compose.transport;
  }
  if (modeSelect instanceof HTMLSelectElement) {
    modeSelect.value = state.compose.mode;
  }
  if (serviceSelect instanceof HTMLSelectElement) {
    serviceSelect.value = state.compose.service;
  }
  if (modelSelect instanceof HTMLSelectElement) {
    const models = getModelsForService(state.compose.service);
    modelSelect.innerHTML = "";
    models.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      const contextLabel = Number.isFinite(Number(model.contextWindow)) && Number(model.contextWindow) > 0
        ? ` (${Math.round(Number(model.contextWindow) / 1000)}k)`
        : "";
      option.textContent = `${model.label}${contextLabel}`;
      modelSelect.appendChild(option);
    });
    if (!models.some((model) => model.id === state.compose.model)) {
      state.compose.model = models[0].id;
    }
    modelSelect.value = state.compose.model;
  }
  if (effortSelect instanceof HTMLSelectElement) {
    const selectedModel = selectedModelInfo();
    const supportedEfforts = Array.isArray(selectedModel?.reasoningEfforts) ? selectedModel.reasoningEfforts : [];
    effortSelect.innerHTML = "";
    if (supportedEfforts.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Reasoning: model default";
      effortSelect.appendChild(option);
      effortSelect.value = "";
      effortSelect.disabled = true;
    } else {
      effortSelect.disabled = false;
      supportedEfforts.forEach((effort) => {
        const option = document.createElement("option");
        option.value = effort;
        option.textContent = `Reasoning: ${formatReasoningEffortLabel(effort)}`;
        effortSelect.appendChild(option);
      });
      const defaultEffort = selectedModel?.defaultReasoningEffort && supportedEfforts.includes(selectedModel.defaultReasoningEffort)
        ? selectedModel.defaultReasoningEffort
        : supportedEfforts[0];
      if (!supportedEfforts.includes(state.compose.effort)) {
        state.compose.effort = defaultEffort;
      }
      effortSelect.value = state.compose.effort;
    }
  }
  if (toolSelect instanceof HTMLSelectElement) {
    toolSelect.value = state.compose.tool;
  }
  if (mcpToolsSelect instanceof HTMLSelectElement) {
    const availableTools = getAvailableMcpToolIds();
    mcpToolsSelect.innerHTML = "";
    if (availableTools.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No MCP tools configured";
      option.disabled = true;
      option.selected = true;
      mcpToolsSelect.appendChild(option);
      mcpToolsSelect.disabled = true;
    } else {
      mcpToolsSelect.disabled = false;
      availableTools.forEach((toolId) => {
        const option = document.createElement("option");
        option.value = toolId;
        option.textContent = toolId;
        option.selected = state.compose.mcpTools.includes(toolId);
        mcpToolsSelect.appendChild(option);
      });
    }
  }
  const isCopilotCloudDispatch = state.compose.service === "copilot" && state.compose.transport === "cloud";
  const selectedIssueItem = selectedIssue();
  if (isCopilotCloudDispatch && !state.compose.issueNumber && selectedIssueItem?.issueNumber) {
    state.compose.issueNumber = selectedIssueItem.issueNumber;
  }
  if (issueNumberInput instanceof HTMLInputElement) {
    issueNumberInput.value = state.compose.issueNumber ? String(state.compose.issueNumber) : "";
  }
  if (issueNodeIdInput instanceof HTMLInputElement) {
    issueNodeIdInput.value = String(state.compose.issueNodeId || "");
  }
  if (cloudControls) {
    cloudControls.classList.toggle("visible", isCopilotCloudDispatch);
  }
  if (cloudStatus) {
    if (!isCopilotCloudDispatch) {
      cloudStatus.textContent = "";
    } else if (!state.runtime.dispatchConfig?.copilotCloudEnabled) {
      cloudStatus.textContent = "Copilot cloud dispatch is disabled in settings (phoenixOps.copilotCloudEnabled=false).";
    } else {
      const repo = selectedIssueItem?.repo || state.runtime.workspaceRepo || "";
      const issueNumber = state.compose.issueNumber || selectedIssueItem?.issueNumber || null;
      cloudStatus.textContent = `Cloud target: ${repo || "(repo required)"} | Issue: ${issueNumber ? `#${issueNumber}` : "(required)"}`;
    }
  }
  autoResizeComposerInput();
  renderStopButtons();
}

function refreshComposerSelectionState() {
  const transportSelect = byId("composerTransportSelect");
  const modeSelect = byId("composerModeSelect");
  const serviceSelect = byId("composerServiceSelect");
  const modelSelect = byId("composerModelSelect");
  const effortSelect = byId("composerEffortSelect");
  const toolSelect = byId("composerToolSelect");
  const mcpToolsSelect = byId("composerMcpToolsSelect");
  const issueNumberInput = byId("composerIssueNumberInput");
  const issueNodeIdInput = byId("composerIssueNodeIdInput");

  if (transportSelect instanceof HTMLSelectElement) {
    state.compose.transport = transportSelect.value;
  }
  if (modeSelect instanceof HTMLSelectElement) {
    state.compose.mode = modeSelect.value;
  }
  if (serviceSelect instanceof HTMLSelectElement) {
    state.compose.service = serviceSelect.value;
  }
  ensureComposeDefaults();
  if (modelSelect instanceof HTMLSelectElement) {
    const modelValue = modelSelect.value;
    if (getModelsForService(state.compose.service).some((model) => model.id === modelValue)) {
      state.compose.model = modelValue;
    }
  }
  if (effortSelect instanceof HTMLSelectElement) {
    state.compose.effort = effortSelect.disabled ? "" : String(effortSelect.value || "").trim().toLowerCase();
  }
  if (toolSelect instanceof HTMLSelectElement) {
    state.compose.tool = toolSelect.value;
  }
  if (mcpToolsSelect instanceof HTMLSelectElement) {
    state.compose.mcpTools = Array.from(mcpToolsSelect.selectedOptions)
      .map((option) => String(option.value || "").trim())
      .filter((entry) => entry.length > 0);
  }
  if (issueNumberInput instanceof HTMLInputElement) {
    state.compose.issueNumber = normalizePositiveInteger(issueNumberInput.value);
  }
  if (issueNodeIdInput instanceof HTMLInputElement) {
    state.compose.issueNodeId = String(issueNodeIdInput.value || "").trim();
  }
  ensureComposeDefaults();
  persistUiState();
}

function renderAgentLayout() {
  const right = byId("rightAgentPane");
  const sessionsSection = byId("agentSessionsSection");
  const jarvisSection = byId("agentJarvisSection");
  const terminalSection = byId("agentTerminalSection");
  const chatSection = byId("agentChatSection");
  const composerSection = byId("agentComposerSection");

  if (!right) {
    return;
  }

  if (state.mode !== "agent-only") {
    right.classList.add("pane-hidden");
    return;
  }

  right.classList.remove("pane-hidden");

  if (sessionsSection instanceof HTMLDetailsElement) {
    sessionsSection.open = state.ui.sessionsSectionOpen;
  }
  if (jarvisSection instanceof HTMLDetailsElement) {
    jarvisSection.open = state.ui.jarvisSectionOpen;
  }
  if (terminalSection instanceof HTMLDetailsElement) {
    terminalSection.open = state.ui.terminalSectionOpen;
  }
  if (chatSection instanceof HTMLDetailsElement) {
    chatSection.open = state.ui.chatSectionOpen;
  }
  if (composerSection instanceof HTMLDetailsElement) {
    composerSection.open = state.ui.composerSectionOpen;
  }
}

function normalizeContextItem(item) {
  const id = String(item?.id || "").trim();
  const label = String(item?.label || "").trim();
  const kind = String(item?.kind || "context");
  const value = typeof item?.value === "string" ? item.value : null;
  const uri = typeof item?.uri === "string" ? item.uri : null;
  const range = typeof item?.range === "string" ? item.range : null;
  if (!id || !label) {
    return null;
  }
  return { id, label, kind, value, uri, range };
}

function appendChatRow(role, text, sessionId = null) {
  if (!text) {
    return;
  }
  state.chatLog.push({
    id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    sessionId,
    occurredAt: new Date().toISOString()
  });
  state.chatLog = state.chatLog.slice(-120);
  persistUiState();
  renderChatTimeline();
}

function renderContextChips() {
  const root = byId("chatContextChips");
  if (!root) {
    return;
  }
  root.innerHTML = "";
  if (!state.contextItems.length) {
    root.appendChild(emptyText("No context attached."));
    return;
  }
  state.contextItems.forEach((item) => {
    const chip = document.createElement("span");
    chip.className = "context-chip";
    chip.textContent = `${item.kind}: ${item.label}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "x";
    remove.onclick = () => {
      state.contextItems = state.contextItems.filter((candidate) => candidate.id !== item.id);
      persistUiState();
      renderContextChips();
    };
    chip.appendChild(remove);
    root.appendChild(chip);
  });
}

function renderChatTimeline() {
  const root = byId("chatTimeline");
  if (!root) {
    return;
  }
  root.innerHTML = "";
  const session = selectedSession();
  const stats = computeSessionStats(session);
  const statsRow = document.createElement("div");
  statsRow.className = "feed-inline";
  statsRow.textContent = formatSessionStats(stats);
  root.appendChild(statsRow);
  const feedRows = (state.snapshot?.agents?.feed || [])
    .filter((entry) => !isJarvisFeedEntry(entry))
    .filter((entry) => !session || entry.sessionId === session.sessionId)
    .sort((a, b) => (parseMs(a.occurredAt) || 0) - (parseMs(b.occurredAt) || 0))
    .slice(-80)
    .map((entry) => {
      const parsed = parseFeedEntryForChat(entry);
      if (!parsed) {
        return null;
      }
      return {
        id: entry.entryId,
        kind: "message",
        role: parsed.role,
        text: parsed.displayText,
        occurredAt: entry.occurredAt
      };
    })
    .filter(Boolean);

  const localRows = (state.chatLog || []).filter((entry) => {
    if (!session) {
      return true;
    }
    return !entry.sessionId || entry.sessionId === session.sessionId;
  });

  const approvalRows = (state.snapshot?.agents?.pendingCommands || [])
    .filter((command) => command.status === "pending")
    .filter((command) => !session || command.sessionId === session.sessionId)
    .map((command) => ({
      id: `approval-${command.commandId}`,
      kind: "approval",
      command,
      occurredAt: command.updatedAt || command.createdAt
    }));

  const timeline = [...feedRows, ...localRows, ...approvalRows]
    .sort((a, b) => (parseMs(a.occurredAt) || 0) - (parseMs(b.occurredAt) || 0))
    .slice(-60);

  if (!timeline.length) {
    root.appendChild(emptyText("No chat messages yet."));
    return;
  }

  timeline.forEach((entry) => {
    if (entry.kind === "approval" && entry.command) {
      root.appendChild(createApprovalChatRow(entry.command));
      return;
    }

    const row = document.createElement("div");
    row.className = `chat-row ${entry.role || "system"}`;
    row.textContent = `${formatTime(entry.occurredAt)} | ${entry.text}`;
    root.appendChild(row);
  });
}

function createApprovalChatRow(command) {
  const row = document.createElement("div");
  row.className = "chat-row approval-request";

  row.appendChild(textLine(`${formatTime(command.createdAt)} | ${command.agentId} | approval required`, "meta-line"));
  row.appendChild(textLine(command.command, "approval-command"));
  if (command.reason) {
    row.appendChild(textLine(command.reason, "meta-line secondary"));
  }

  const actions = document.createElement("div");
  actions.className = "inline-actions";

  const approve = document.createElement("button");
  approve.type = "button";
  approve.textContent = "Approve";
  approve.onclick = () => {
    const note = window.prompt("Approval note (optional)", "") || "";
    vscode.postMessage({ type: "agentCommandDecision", commandId: command.commandId, approve: true, note });
  };
  actions.appendChild(approve);

  const reject = document.createElement("button");
  reject.type = "button";
  reject.textContent = "Reject";
  reject.onclick = () => {
    const note = window.prompt("Rejection reason (optional)", "") || "";
    vscode.postMessage({ type: "agentCommandDecision", commandId: command.commandId, approve: false, note });
  };
  actions.appendChild(reject);

  row.appendChild(actions);
  return row;
}

function renderMeta() {
  const meta = state.snapshot?.meta;
  if (!meta) return;
  byId("updatedAt").textContent = new Date(meta.generatedAt).toLocaleString();
  byId("dataSource").textContent = `Source: ${meta.source}`;
  if (meta.stale) setStatus("Stale", "warn");
  else if (meta.streamConnected) setStatus("Live Stream", "ok");
  else setStatus("Polling", "warn");
}

function sendMessage() {
  const msgInput = byId("agentMessageInput");
  if (!(msgInput instanceof HTMLTextAreaElement)) return;
  const message = msgInput.value.trim();
  if (!message) return;

  refreshComposerSelectionState();
  const session = selectedSession();
  const modelInfo = selectedModelInfo();

  const modePrefix = state.compose.mode === "agent" ? "" : `[${state.compose.mode}] `;
  const servicePrefix = `[${state.compose.service}] `;
  const effortPrefix = state.compose.effort ? `[reasoning:${state.compose.effort}] ` : "";
  const modelSuffix = modelInfo ? ` [model:${modelInfo.label}]` : "";
  const outboundMessage = `${servicePrefix}${modePrefix}${effortPrefix}${message}${modelSuffix}`.trim();
  const selectedMcpTools = sanitizeToolIds(state.compose.mcpTools);

  if (session) {
    vscode.postMessage({
      type: "agentSendMessage",
      sessionId: session.sessionId,
      agentId: session.agentId ?? `${state.compose.service} ${state.compose.mode}`,
      transport: session.transport ?? state.compose.transport,
      message: outboundMessage,
      service: state.compose.service,
      mode: state.compose.mode,
      model: modelInfo?.id || state.compose.model,
      effort: state.compose.effort || null,
      toolProfile: state.compose.tool,
      mcpTools: selectedMcpTools,
      contextItems: state.contextItems
    });
  } else {
    const isCopilotCloudDispatch = state.compose.service === "copilot" && state.compose.transport === "cloud";
    const selectedIssueItem = selectedIssue();
    const issueNumber = isCopilotCloudDispatch
      ? (state.compose.issueNumber || selectedIssueItem?.issueNumber || null)
      : null;
    const issueNodeId = isCopilotCloudDispatch
      ? (String(state.compose.issueNodeId || "").trim() || null)
      : null;
    const repository = isCopilotCloudDispatch
      ? (selectedIssueItem?.repo || state.runtime.workspaceRepo || null)
      : null;
    const branch = isCopilotCloudDispatch
      ? (state.runtime.workspaceBranch || null)
      : null;

    if (isCopilotCloudDispatch && !state.runtime.dispatchConfig?.copilotCloudEnabled) {
      appendChatRow("system", "Copilot cloud dispatch is disabled in settings.", null);
      return;
    }
    if (isCopilotCloudDispatch && !issueNumber) {
      appendChatRow("system", "Cloud dispatch requires an issue number. Select an issue or enter one in the composer.", null);
      return;
    }
    if (isCopilotCloudDispatch && !repository) {
      appendChatRow("system", "Cloud dispatch requires a repository. Select a board issue or open a workspace repository.", null);
      return;
    }
    if (isCopilotCloudDispatch) {
      state.compose.issueNumber = issueNumber;
      persistUiState();
    }

    const agentId = `${state.compose.service.toUpperCase()} ${state.compose.mode.toUpperCase()} ${modelInfo?.label ?? ""}`.trim();
    vscode.postMessage({
      type: "agentDispatch",
      agentId,
      transport: state.compose.transport,
      summary: outboundMessage,
      service: state.compose.service,
      mode: state.compose.mode,
      model: modelInfo?.id || state.compose.model,
      effort: state.compose.effort || null,
      toolProfile: state.compose.tool,
      mcpTools: selectedMcpTools,
      repository,
      branch,
      workspace: null,
      issueNumber,
      issueNodeId
    });
    appendChatRow(
      "system",
      `Dispatch requested: ${agentId} (${state.compose.transport}${issueNumber ? `, issue #${issueNumber}` : ""})`,
      null
    );
  }

  appendChatRow("user", outboundMessage, session?.sessionId ?? null);
  msgInput.value = "";
  autoResizeComposerInput();
}

