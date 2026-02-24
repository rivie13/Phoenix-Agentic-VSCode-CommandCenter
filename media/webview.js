const vscode = acquireVsCodeApi();
const persisted = vscode.getState() || {};
const boot = (globalThis.__PHOENIX_BOOT && typeof globalThis.__PHOENIX_BOOT === "object")
  ? globalThis.__PHOENIX_BOOT
  : {};
const bootMode = typeof boot.mode === "string" ? boot.mode : "full";

const statusOrder = [
  "Backlog",
  "Ready",
  "Claimed",
  "In progress",
  "QA Required",
  "QA Feedback",
  "In review",
  "Blocked",
  "Failed",
  "Done"
];

const chatNoisePatterns = [
  /\bheartbeat\b/i,
  /\bdemo\b.*\bvs code task\b/i,
  /^demo\b/i
];

const builtInColorSchemes = {
  "phoenix-rgb": {
    label: "Phoenix RGB",
    colors: ["#ff5f6d", "#ffc371", "#4facfe"]
  },
  aurora: {
    label: "Aurora",
    colors: ["#56ccf2", "#2f80ed", "#9b51e0"]
  },
  ember: {
    label: "Ember",
    colors: ["#ff6b6b", "#ff9f43", "#ffd166"]
  },
  forest: {
    label: "Forest",
    colors: ["#2ecc71", "#27ae60", "#16a085"]
  },
  ocean: {
    label: "Ocean",
    colors: ["#00c6ff", "#0072ff", "#5f9df7"]
  }
};

const defaultColorSchemeKey = "phoenix-rgb";

function normalizeHexColor(value, fallback = "#4facfe") {
  const text = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) {
    return text.toLowerCase();
  }
  return fallback.toLowerCase();
}

function normalizeColorList(input, fallback) {
  if (!Array.isArray(input) || input.length < 3) {
    return fallback.map((entry) => entry.toLowerCase());
  }
  return [
    normalizeHexColor(input[0], fallback[0]),
    normalizeHexColor(input[1], fallback[1]),
    normalizeHexColor(input[2], fallback[2])
  ];
}

function sanitizeCustomSchemes(raw) {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const sanitized = {};
  Object.entries(raw).forEach(([key, value]) => {
    const normalizedKey = String(key || "").trim().toLowerCase();
    if (!normalizedKey) {
      return;
    }
    const label = typeof value?.label === "string" && value.label.trim()
      ? value.label.trim()
      : normalizedKey;
    const colors = normalizeColorList(
      value?.colors,
      builtInColorSchemes[defaultColorSchemeKey].colors
    );
    sanitized[normalizedKey] = { label, colors };
  });
  return sanitized;
}

const fallbackModelCatalog = {
  codex: [
    { id: "gpt-5.3-codex", label: "GPT-5.3-Codex", contextWindow: 200000 },
    { id: "gpt-5-codex", label: "GPT-5-Codex", contextWindow: 128000 }
  ],
  copilot: [
    { id: "gpt-4.1", label: "GPT-4.1", contextWindow: 128000 },
    { id: "claude-sonnet", label: "Claude Sonnet", contextWindow: 200000 }
  ]
};

function normalizeModelContextWindow(raw) {
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.round(parsed);
  }
  return null;
}

function normalizeModelOption(raw) {
  if (typeof raw === "string") {
    const id = raw.trim();
    if (!id) {
      return null;
    }
    return {
      id,
      label: id,
      contextWindow: null
    };
  }
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const id = String(raw.id ?? raw.model ?? raw.name ?? "").trim();
  if (!id) {
    return null;
  }
  const label = String(raw.label ?? raw.name ?? id).trim() || id;
  return {
    id,
    label,
    contextWindow: normalizeModelContextWindow(raw.contextWindow ?? raw.context_window ?? raw.context ?? raw.contextTokens)
  };
}

function normalizeModelList(raw, fallbackList = []) {
  const source = Array.isArray(raw) ? raw : fallbackList;
  const deduped = new Map();
  source.forEach((entry) => {
    const normalized = normalizeModelOption(entry);
    if (!normalized) {
      return;
    }
    deduped.set(normalized.id, normalized);
  });
  return Array.from(deduped.values());
}

function normalizeModelCatalog(raw) {
  const fallback = {
    codex: normalizeModelList(fallbackModelCatalog.codex),
    copilot: normalizeModelList(fallbackModelCatalog.copilot)
  };
  if (!raw || typeof raw !== "object") {
    return fallback;
  }
  const services = raw.services && typeof raw.services === "object" ? raw.services : raw;
  const codex = normalizeModelList(services.codex, fallback.codex);
  const copilot = normalizeModelList(services.copilot, fallback.copilot);
  return {
    codex: codex.length > 0 ? codex : fallback.codex,
    copilot: copilot.length > 0 ? copilot : fallback.copilot
  };
}

const workspaceTabs = ["board", "issues", "actions", "pullRequests"];

const issueCreateTypeOptions = ["Epic", "Feature", "Subfeature"];
const issueCreateFieldKeys = ["status", "workMode", "priority", "size", "area"];

function createEmptyIssueCreateFieldOptions() {
  return {
    status: [],
    workMode: [],
    priority: [],
    size: [],
    area: []
  };
}

function createDefaultIssueCreateDraft() {
  return {
    repo: "",
    type: "Subfeature",
    title: "",
    parentLinks: "",
    baseBranch: "main",
    plannedBranch: "",
    branchReason: "",
    labels: [],
    customLabels: "",
    problemStatement: "",
    scopeIn: "",
    scopeOut: "",
    definitionOfDone: "",
    dependencies: "",
    risks: "",
    validationPlan: "",
    acceptanceCriteria: "",
    architectureImpact: "",
    rolloutStrategy: "",
    taskChecklist: "",
    boardStatus: "",
    boardWorkMode: "",
    boardPriority: "",
    boardSize: "",
    boardArea: "",
    successMetrics: "",
    suspectedCause: "",
    investigationNotes: "",
    body: ""
  };
}

const state = {
  mode: bootMode,
  sessionLockId: typeof boot.lockedSessionId === "string" ? boot.lockedSessionId : null,
  snapshot: null,
  selected: null,
  auth: { ok: false },
  filters: {
    repo: "all",
    lane: "all",
    workMode: "all",
    assignee: "all"
  },
  laneCollapse: {},
  pullRequestBucketCollapse: {},
  actionBucketCollapse: {},
  actionGroupExpand: {},
  actionStackMode: "workflow-branch-repo",
  pullRequestInsightsCache: {},
  actionRunLogCache: {},
  pullRequestInsightsLoading: null,
  actionRunLogLoading: null,
  sessionCollapse: {},
  showArchived: false,
  ui: {
    opsSettingsOpen: persisted.opsSettingsOpen === true,
    workspaceControlsOpen: persisted.workspaceControlsOpen !== false,
    boardSectionOpen: persisted.boardSectionOpen !== false,
    issuesSectionOpen: persisted.issuesSectionOpen !== false,
    pullRequestsSectionOpen: persisted.pullRequestsSectionOpen !== false,
    actionsSectionOpen: persisted.actionsSectionOpen !== false,
    activeWorkspaceTab: workspaceTabs.includes(persisted.activeWorkspaceTab) ? persisted.activeWorkspaceTab : "board",
    sessionsSectionOpen: persisted.sessionsSectionOpen !== false,
    chatSectionOpen: persisted.chatSectionOpen !== false,
    composerSectionOpen: persisted.composerSectionOpen !== false,
    contextPickerOpen: persisted.contextPickerOpen === true
  },
  theme: {
    mode: persisted.themeMode === "solid" ? "solid" : "gradient",
    schemeKey: typeof persisted.themeSchemeKey === "string" ? persisted.themeSchemeKey : defaultColorSchemeKey,
    customSchemes: sanitizeCustomSchemes(persisted.themeCustomSchemes),
    previewColors: null
  },
  compose: {
    transport: typeof persisted.composeTransport === "string" ? persisted.composeTransport : "local",
    mode: typeof persisted.composeMode === "string" ? persisted.composeMode : "agent",
    service: typeof persisted.composeService === "string" ? persisted.composeService : "codex",
    model: typeof persisted.composeModel === "string" ? persisted.composeModel : "gpt-5.3-codex",
    tool: typeof persisted.composeTool === "string" ? persisted.composeTool : "auto",
    issueNumber: Number.isInteger(persisted.composeIssueNumber) && Number(persisted.composeIssueNumber) > 0
      ? Number(persisted.composeIssueNumber)
      : null,
    issueNodeId: typeof persisted.composeIssueNodeId === "string" ? persisted.composeIssueNodeId : "",
    mcpTools: Array.isArray(persisted.composeMcpTools)
      ? persisted.composeMcpTools.map((entry) => String(entry || "").trim()).filter((entry) => entry.length > 0)
      : []
  },
  runtime: {
    repositories: [],
    workspaceRepo: null,
    workspaceBranch: null,
    mcpTools: [],
    modelCatalog: normalizeModelCatalog(null),
    dispatchConfig: {
      codexCliPath: "codex",
      copilotCliPath: "copilot",
      codexDefaultModel: null,
      copilotDefaultModel: null,
      copilotCloudEnabled: false
    }
  },
  jarvis: {
    enabled: true,
    manualMode: false,
    autoAnnouncements: true,
    maxAnnouncementsPerHour: 12,
    minSecondsBetweenAnnouncements: 180,
    announcementsLastHour: 0,
    lastReason: null,
    lastMessage: null,
    chatDegraded: false,
    chatFailureKind: null,
    chatCooldownUntil: null,
    speechDegraded: false,
    speechFailureKind: null,
    speechCooldownUntil: null,
    focusLabel: "",
    audioError: "",
    wakeWordEnabled: false,
    wakeWordSupported: false,
    wakeWordStatus: "Wake word off"
  },
  forms: {
    issueCreateOpen: false,
    issueCreateBusy: false,
    issueCreateStatus: "",
    issueCreateDraft: createDefaultIssueCreateDraft(),
    issueCreateMeta: {
      loading: false,
      repo: "",
      loadedRepo: "",
      labels: [],
      fieldOptions: createEmptyIssueCreateFieldOptions(),
      error: ""
    },
    issueCreateAiAssist: {
      busy: false,
      status: "",
      pendingRequestId: null,
      pendingMode: null
    },
    pullRequestCreateOpen: false,
    pullRequestCreateBusy: false,
    pullRequestCreateStatus: "",
    pullRequestCreateDraft: {
      repo: "",
      title: "",
      body: "",
      head: "",
      base: "main",
      draft: false
    },
    pullRequestCommentBusy: false,
    pullRequestCommentStatus: "",
    pullRequestCommentDraft: "",
    pullRequestCommentTarget: null
  },
  contextItems: Array.isArray(persisted.contextItems) ? persisted.contextItems : [],
  chatLog: []
};

let jarvisAudioPlayer = null;
let jarvisAudioObjectUrl = "";
let jarvisWakeRecognition = null;
let jarvisAudioUnlocked = false;
let jarvisPendingAudio = null;
let jarvisPendingRetryTimer = null;
let jarvisPendingRetryCount = 0;
const jarvisPendingRetryLimit = 8;

document.body.classList.toggle("agent-only", state.mode === "agent-only");
document.body.classList.toggle("full-mode", state.mode !== "agent-only");
ensureComposeDefaults();
state.jarvis.wakeWordSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
state.jarvis.wakeWordStatus = state.jarvis.wakeWordSupported ? "Wake word off" : "Wake word unavailable";
bindJarvisAudioUnlockHandlers();

function persistUiState() {
  vscode.setState({
    opsSettingsOpen: state.ui.opsSettingsOpen,
    workspaceControlsOpen: state.ui.workspaceControlsOpen,
    boardSectionOpen: state.ui.boardSectionOpen,
    issuesSectionOpen: state.ui.issuesSectionOpen,
    pullRequestsSectionOpen: state.ui.pullRequestsSectionOpen,
    actionsSectionOpen: state.ui.actionsSectionOpen,
    activeWorkspaceTab: state.ui.activeWorkspaceTab,
    sessionsSectionOpen: state.ui.sessionsSectionOpen,
    chatSectionOpen: state.ui.chatSectionOpen,
    composerSectionOpen: state.ui.composerSectionOpen,
    contextPickerOpen: state.ui.contextPickerOpen,
    themeMode: state.theme.mode,
    themeSchemeKey: state.theme.schemeKey,
    themeCustomSchemes: state.theme.customSchemes,
    composeTransport: state.compose.transport,
    composeMode: state.compose.mode,
    composeService: state.compose.service,
    composeModel: state.compose.model,
    composeTool: state.compose.tool,
    composeIssueNumber: state.compose.issueNumber,
    composeIssueNodeId: state.compose.issueNodeId,
    composeMcpTools: state.compose.mcpTools,
    contextItems: state.contextItems
  });
}

function byId(id) {
  return document.getElementById(id);
}

function getColorSchemeMap() {
  return { ...builtInColorSchemes, ...state.theme.customSchemes };
}

function getColorSchemeEntries() {
  const builtIn = Object.entries(builtInColorSchemes).map(([key, value]) => ({ key, ...value }));
  const custom = Object.entries(state.theme.customSchemes)
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...builtIn, ...custom];
}

function ensureActiveScheme() {
  const schemes = getColorSchemeMap();
  if (!schemes[state.theme.schemeKey]) {
    state.theme.schemeKey = defaultColorSchemeKey;
  }
  return schemes[state.theme.schemeKey] || builtInColorSchemes[defaultColorSchemeKey];
}

function readThemeColorInputs() {
  const one = byId("themeColorOneInput");
  const two = byId("themeColorTwoInput");
  const three = byId("themeColorThreeInput");
  if (!(one instanceof HTMLInputElement) || !(two instanceof HTMLInputElement) || !(three instanceof HTMLInputElement)) {
    return null;
  }
  return [
    normalizeHexColor(one.value, "#ff5f6d"),
    normalizeHexColor(two.value, "#ffc371"),
    normalizeHexColor(three.value, "#4facfe")
  ];
}

function applyThemeStyles() {
  const root = document.documentElement;
  const scheme = ensureActiveScheme();
  const colors = state.theme.previewColors || scheme.colors;
  root.style.setProperty("--phoenix-theme-color-1", colors[0]);
  root.style.setProperty("--phoenix-theme-color-2", colors[1]);
  root.style.setProperty("--phoenix-theme-color-3", colors[2]);
  document.body.classList.toggle("theme-solid", state.theme.mode === "solid");
  document.body.classList.toggle("theme-gradient", state.theme.mode !== "solid");
}

function renderThemeControls() {
  const modeSelect = byId("backgroundModeSelect");
  const schemeSelect = byId("colorSchemeSelect");
  const customNameInput = byId("customSchemeNameInput");
  const activeScheme = ensureActiveScheme();
  const entries = getColorSchemeEntries();

  if (modeSelect instanceof HTMLSelectElement) {
    modeSelect.value = state.theme.mode;
  }

  if (schemeSelect instanceof HTMLSelectElement) {
    const previous = schemeSelect.value;
    schemeSelect.innerHTML = "";
    entries.forEach((scheme) => {
      const option = document.createElement("option");
      option.value = scheme.key;
      const isCustom = !Object.prototype.hasOwnProperty.call(builtInColorSchemes, scheme.key);
      option.textContent = isCustom ? `${scheme.label} (Custom)` : scheme.label;
      schemeSelect.appendChild(option);
    });
    schemeSelect.value = entries.some((entry) => entry.key === state.theme.schemeKey)
      ? state.theme.schemeKey
      : (entries.some((entry) => entry.key === previous) ? previous : defaultColorSchemeKey);
  }

  const preview = state.theme.previewColors || activeScheme.colors;
  const one = byId("themeColorOneInput");
  const two = byId("themeColorTwoInput");
  const three = byId("themeColorThreeInput");
  if (one instanceof HTMLInputElement) one.value = preview[0];
  if (two instanceof HTMLInputElement) two.value = preview[1];
  if (three instanceof HTMLInputElement) three.value = preview[2];

  if (customNameInput instanceof HTMLInputElement && !customNameInput.value) {
    customNameInput.value = "";
  }

  applyThemeStyles();
}

function slugifySchemeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function saveCustomScheme() {
  const nameInput = byId("customSchemeNameInput");
  if (!(nameInput instanceof HTMLInputElement)) {
    return;
  }
  const rawName = nameInput.value.trim();
  if (!rawName) {
    window.alert("Enter a name for the custom color scheme.");
    return;
  }
  const colors = readThemeColorInputs();
  if (!colors) {
    return;
  }
  let key = slugifySchemeName(rawName);
  if (!key) {
    window.alert("Use letters or numbers in the custom scheme name.");
    return;
  }
  if (Object.prototype.hasOwnProperty.call(builtInColorSchemes, key)) {
    key = `custom-${key}`;
  }
  state.theme.customSchemes[key] = { label: rawName, colors };
  state.theme.schemeKey = key;
  state.theme.previewColors = null;
  persistUiState();
  renderThemeControls();
}

function renderWorkspaceTabs() {
  const activeTab = state.ui.activeWorkspaceTab;
  const tabButtons = document.querySelectorAll("[data-workspace-tab]");
  tabButtons.forEach((node) => {
    const tabKey = node.getAttribute("data-workspace-tab");
    const active = tabKey === activeTab;
    node.classList.toggle("active", active);
    node.setAttribute("aria-selected", active ? "true" : "false");
  });

  const tabPanels = document.querySelectorAll("[data-tab-panel]");
  tabPanels.forEach((node) => {
    const panelKey = node.getAttribute("data-tab-panel");
    const active = panelKey === activeTab;
    node.classList.toggle("active-tab", active);
  });
}

function setActiveWorkspaceTab(tabKey) {
  if (!workspaceTabs.includes(tabKey || "")) {
    return;
  }
  state.ui.activeWorkspaceTab = tabKey;
  persistUiState();
  renderWorkspaceTabs();
}

function normalizeRepositorySlug(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+/, "");
}

function availableRepositories() {
  const repos = new Set();
  (state.runtime.repositories || []).forEach((repo) => {
    const normalized = normalizeRepositorySlug(repo);
    if (normalized) {
      repos.add(normalized);
    }
  });
  (state.snapshot?.board?.items || []).forEach((item) => {
    const normalized = normalizeRepositorySlug(item.repo);
    if (normalized) {
      repos.add(normalized);
    }
  });
  (state.snapshot?.actions?.pullRequests || []).forEach((entry) => {
    const normalized = normalizeRepositorySlug(entry.repo);
    if (normalized) {
      repos.add(normalized);
    }
  });
  (state.snapshot?.actions?.runs || []).forEach((entry) => {
    const normalized = normalizeRepositorySlug(entry.repo);
    if (normalized) {
      repos.add(normalized);
    }
  });
  return Array.from(repos).sort((left, right) => left.localeCompare(right));
}

function preferredRepository(candidates) {
  const workspaceRepo = normalizeRepositorySlug(state.runtime.workspaceRepo || "");
  if (workspaceRepo && candidates.includes(workspaceRepo)) {
    return workspaceRepo;
  }
  const filterRepo = normalizeRepositorySlug(state.filters.repo || "");
  if (filterRepo && filterRepo !== "all" && candidates.includes(filterRepo)) {
    return filterRepo;
  }
  return candidates[0] || "";
}

function populateRepositorySelect(selectEl, selectedValue) {
  if (!(selectEl instanceof HTMLSelectElement)) {
    return "";
  }
  const repositories = availableRepositories();
  selectEl.innerHTML = "";
  repositories.forEach((repo) => {
    const option = document.createElement("option");
    option.value = repo;
    option.textContent = repo;
    selectEl.appendChild(option);
  });

  if (!repositories.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No repositories available";
    selectEl.appendChild(option);
    selectEl.value = "";
    selectEl.disabled = true;
    return "";
  }

  const normalizedSelected = normalizeRepositorySlug(selectedValue || "");
  const nextValue = repositories.includes(normalizedSelected)
    ? normalizedSelected
    : preferredRepository(repositories);
  selectEl.value = nextValue;
  selectEl.disabled = false;
  return nextValue;
}

function renderLeftSections() {
  const sectionMap = [
    { id: "workspaceControlsSection", key: "workspaceControlsOpen" },
    { id: "issuesSection", key: "issuesSectionOpen" },
    { id: "pullRequestsSection", key: "pullRequestsSectionOpen" },
    { id: "actionsSection", key: "actionsSectionOpen" }
  ];
  sectionMap.forEach(({ id, key }) => {
    const section = byId(id);
    if (section instanceof HTMLDetailsElement) {
      section.open = state.ui[key];
    }
  });
}

function renderTopbarSections() {
  const settingsSection = byId("opsSettingsSection");
  if (settingsSection instanceof HTMLDetailsElement) {
    settingsSection.open = state.ui.opsSettingsOpen;
  }
}

function setStatus(text, cls) {
  const el = byId("connStatus");
  el.textContent = text;
  el.className = `status-pill ${cls}`;
}

function parseMs(iso) {
  const value = Date.parse(iso || "");
  return Number.isFinite(value) ? value : null;
}

function formatTime(iso) {
  const value = parseMs(iso);
  return value === null ? "(unknown)" : new Date(value).toLocaleString();
}

function formatAge(iso) {
  const value = parseMs(iso);
  if (value === null) {
    return "unknown";
  }
  const delta = Math.max(0, Date.now() - value);
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function isNoisyChatFeedMessage(message) {
  const text = String(message || "").trim();
  if (!text) {
    return true;
  }
  return chatNoisePatterns.some((pattern) => pattern.test(text));
}

function parseFeedEntryForChat(entry) {
  if (isJarvisFeedEntry(entry)) {
    return null;
  }

  const rawMessage = String(entry?.message || "").trim();
  if (isNoisyChatFeedMessage(rawMessage)) {
    return null;
  }

  const prefixedRoleMatch = rawMessage.match(/^\s*(assistant|agent|codex|copilot|ai|system|tool|user|human)\s*[:\-]\s*(.+)$/i);
  let role = "agent";
  let text = rawMessage;

  if (prefixedRoleMatch) {
    const roleToken = prefixedRoleMatch[1].toLowerCase();
    text = prefixedRoleMatch[2].trim();
    if (roleToken === "user" || roleToken === "human") {
      role = "user";
    } else if (roleToken === "system" || roleToken === "tool") {
      role = "system";
    } else {
      role = "agent";
    }
  } else if (entry.level === "warn" || entry.level === "error") {
    role = "system";
  }

  const displayText = role === "agent" ? `${entry.agentId}: ${text}` : text;
  return { role, displayText };
}

function isJarvisFeedEntry(entry) {
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

function getRuntimeModelCatalog() {
  return normalizeModelCatalog(state.runtime?.modelCatalog);
}

function getModelsForService(service) {
  const modelCatalog = getRuntimeModelCatalog();
  return modelCatalog[service] || modelCatalog.codex;
}

function sanitizeToolIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => String(entry || "").trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 32);
}

function getAvailableMcpToolIds() {
  return sanitizeToolIds(state.runtime.mcpTools);
}

function normalizePositiveInteger(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function ensureComposeDefaults() {
  if (!["local", "cli", "cloud"].includes(state.compose.transport)) {
    state.compose.transport = "local";
  }
  if (state.compose.service === "codex" && state.compose.transport === "cloud") {
    state.compose.transport = "local";
  }
  if (state.compose.transport === "cloud" && state.compose.service !== "copilot") {
    state.compose.service = "copilot";
  }
  const modelCatalog = getRuntimeModelCatalog();
  if (!modelCatalog[state.compose.service]) {
    state.compose.service = "codex";
  }
  const models = getModelsForService(state.compose.service);
  const validModel = models.some((model) => model.id === state.compose.model);
  if (!validModel) {
    state.compose.model = models[0].id;
  }
  if (!["auto", "repo", "terminal"].includes(state.compose.tool)) {
    state.compose.tool = "auto";
  }
  state.compose.issueNumber = normalizePositiveInteger(state.compose.issueNumber);
  state.compose.issueNodeId = String(state.compose.issueNodeId || "").trim();
  const availableMcpTools = new Set(getAvailableMcpToolIds());
  state.compose.mcpTools = sanitizeToolIds(state.compose.mcpTools).filter((entry) => availableMcpTools.has(entry));
}

function selectedModelInfo() {
  const models = getModelsForService(state.compose.service);
  return models.find((model) => model.id === state.compose.model) || models[0];
}

function applyOptions(select, values) {
  const previous = select.value;
  select.innerHTML = "";
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  if (values.includes(previous)) {
    select.value = previous;
  }
}

function updateFilterOptions(snapshot) {
  const repos = new Set();
  const workModes = new Set();
  const assignees = new Set();
  snapshot.board.items.forEach((item) => {
    if (item.repo) repos.add(item.repo);
    if (item.workMode) workModes.add(item.workMode);
    (item.assignees || []).forEach((name) => assignees.add(name));
  });
  (snapshot.actions?.pullRequests || []).forEach((entry) => {
    if (entry.repo) repos.add(entry.repo);
  });

  applyOptions(byId("repoFilter"), ["all", ...Array.from(repos).sort()]);
  applyOptions(byId("workModeFilter"), ["all", ...Array.from(workModes).sort()]);
  applyOptions(byId("assigneeFilter"), ["all", ...Array.from(assignees).sort()]);
  applyOptions(byId("laneFilter"), ["all", ...statusOrder]);
}

function renderAuth() {
  const signIn = byId("signInButton");
  signIn.textContent = state.auth.ok ? "Signed In" : "Sign In";
  signIn.disabled = state.auth.ok;
}

function formatCooldownUntil(isoString) {
  if (typeof isoString !== "string" || isoString.length === 0) {
    return "";
  }
  const parsedMs = Date.parse(isoString);
  if (!Number.isFinite(parsedMs)) {
    return "";
  }
  const remainingMs = parsedMs - Date.now();
  if (remainingMs <= 0) {
    return "";
  }
  const minutes = Math.ceil(remainingMs / 60000);
  return minutes <= 1 ? "about 1m" : `about ${minutes}m`;
}

function renderJarvisStatus() {
  const status = byId("jarvisStatus");
  const focus = byId("jarvisFocus");
  const modeButton = byId("jarvisModeButton");
  const wakeButton = byId("jarvisWakeButton");

  if (status) {
    if (!state.jarvis.enabled) {
      status.textContent = "Jarvis: disabled";
    } else if (state.jarvis.manualMode) {
      status.textContent = `Jarvis: manual mode | ${state.jarvis.announcementsLastHour}/${state.jarvis.maxAnnouncementsPerHour} auto in last hour`;
    } else {
      status.textContent = `Jarvis: auto on | ${state.jarvis.announcementsLastHour}/${state.jarvis.maxAnnouncementsPerHour} auto in last hour`;
    }
    if (state.jarvis.chatDegraded || state.jarvis.speechDegraded) {
      status.textContent += " | API degraded";
    }
  }

  if (focus) {
    const reason = state.jarvis.lastReason ? `Reason: ${state.jarvis.lastReason}` : "";
    const context = state.jarvis.focusLabel ? `Focus: ${state.jarvis.focusLabel}` : "";
    const chatApi = state.jarvis.chatDegraded
      ? `Chat API: ${state.jarvis.chatFailureKind || "degraded"}${formatCooldownUntil(state.jarvis.chatCooldownUntil) ? ` (${formatCooldownUntil(state.jarvis.chatCooldownUntil)})` : ""}`
      : "";
    const speechApi = state.jarvis.speechDegraded
      ? `Speech API: ${state.jarvis.speechFailureKind || "degraded"}${formatCooldownUntil(state.jarvis.speechCooldownUntil) ? ` (${formatCooldownUntil(state.jarvis.speechCooldownUntil)})` : ""}`
      : "";
    const audioError = state.jarvis.audioError ? `Audio: ${state.jarvis.audioError}` : "";
    const wakeStatus = state.jarvis.wakeWordStatus ? `Wake: ${state.jarvis.wakeWordStatus}` : "";
    focus.textContent = [reason, context, chatApi, speechApi, audioError, wakeStatus].filter((value) => value.length > 0).join(" | ");
  }

  if (modeButton) {
    modeButton.textContent = state.jarvis.manualMode ? "Jarvis Auto: Off" : "Jarvis Auto: On";
  }
  if (wakeButton) {
    if (!state.jarvis.wakeWordSupported) {
      wakeButton.textContent = "Wake Word: N/A";
      wakeButton.setAttribute("disabled", "true");
    } else {
      wakeButton.removeAttribute("disabled");
      wakeButton.textContent = state.jarvis.wakeWordEnabled ? "Wake Word: On" : "Wake Word: Off";
    }
  }
}

function applyJarvisFocusHint(hint) {
  if (!hint || !state.snapshot || !hint.id || !hint.kind) {
    return;
  }

  if (hint.kind === "session") {
    const match = state.snapshot.agents.sessions.find((entry) => entry.sessionId === hint.id);
    if (match) {
      state.selected = { kind: "session", id: match.sessionId };
    }
  }

  if (hint.kind === "run") {
    const numericId = Number(hint.id);
    const match = state.snapshot.actions.runs.find((entry) => entry.id === numericId);
    if (match) {
      state.selected = { kind: "run", id: match.id };
    }
  }

  if (hint.kind === "issue") {
    const match = state.snapshot.board.items.find((entry) => entry.itemId === hint.id);
    if (match) {
      state.selected = { kind: "issue", id: match.itemId };
    }
  }

  if (hint.kind === "pullRequest") {
    const match = state.snapshot.actions.pullRequests.find((entry) => entry.id === hint.id);
    if (match) {
      state.selected = { kind: "pullRequest", id: match.id };
    }
  }
}

function normalizeAudioBase64(base64) {
  const trimmed = String(base64 || "").trim();
  if (!trimmed) {
    return "";
  }
  const prefixed = trimmed.match(/^data:audio\/[^;]+;base64,(.+)$/i);
  return prefixed ? prefixed[1].trim() : trimmed;
}

function decodeBase64ToBytes(base64) {
  try {
    const normalized = base64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = window.atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function releaseJarvisAudioObjectUrl(targetUrl) {
  const revokeTarget = typeof targetUrl === "string" && targetUrl ? targetUrl : jarvisAudioObjectUrl;
  if (!revokeTarget) {
    return;
  }
  try {
    URL.revokeObjectURL(revokeTarget);
  } catch {
    // no-op
  }
  if (!targetUrl || revokeTarget === jarvisAudioObjectUrl) {
    jarvisAudioObjectUrl = "";
  }
}

function emitJarvisAudioTrace(level, stage, extra = {}) {
  const payload = {
    type: "jarvisAudioTrace",
    level: level === "warn" ? "warn" : "info",
    stage: String(stage || "unknown"),
    ...extra
  };
  try {
    vscode.postMessage(payload);
  } catch {
    // no-op
  }
}

function normalizePlaybackError(error) {
  if (error && typeof error === "object") {
    const maybe = error;
    const name = typeof maybe.name === "string" ? maybe.name : "Error";
    const message = typeof maybe.message === "string" ? maybe.message : String(error);
    return { name, message };
  }
  return { name: "Error", message: String(error) };
}

function clearJarvisPendingRetryTimer() {
  if (!jarvisPendingRetryTimer) {
    return;
  }
  clearTimeout(jarvisPendingRetryTimer);
  jarvisPendingRetryTimer = null;
}

function queueJarvisPendingAudio(base64, mimeType, meta = null) {
  const normalizedBase64 = normalizeAudioBase64(base64);
  if (!normalizedBase64) {
    return;
  }
  jarvisPendingAudio = {
    base64: normalizedBase64,
    mimeType: mimeType || "audio/mpeg",
    meta
  };
}

function scheduleJarvisPendingRetry() {
  if (!jarvisPendingAudio || jarvisPendingRetryTimer) {
    return;
  }
  if (jarvisPendingRetryCount >= jarvisPendingRetryLimit) {
    emitJarvisAudioTrace("warn", "retry-gave-up", {
      detail: "Reached maximum automatic retry attempts.",
      attempt: jarvisPendingRetryCount,
      reason: jarvisPendingAudio.meta?.reason || "",
      auto: Boolean(jarvisPendingAudio.meta?.auto)
    });
    return;
  }

  const delayMs = Math.min(8000, 750 * Math.pow(2, jarvisPendingRetryCount));
  const nextAttempt = jarvisPendingRetryCount + 1;
  emitJarvisAudioTrace("info", "retry-scheduled", {
    attempt: nextAttempt,
    delayMs,
    reason: jarvisPendingAudio.meta?.reason || "",
    auto: Boolean(jarvisPendingAudio.meta?.auto)
  });
  jarvisPendingRetryTimer = setTimeout(() => {
    jarvisPendingRetryTimer = null;
    jarvisPendingRetryCount += 1;
    emitJarvisAudioTrace("info", "retry-attempt", {
      attempt: jarvisPendingRetryCount,
      reason: jarvisPendingAudio?.meta?.reason || "",
      auto: Boolean(jarvisPendingAudio?.meta?.auto)
    });
    playQueuedJarvisAudio();
  }, delayMs);
}

function playQueuedJarvisAudio() {
  if (!jarvisPendingAudio) {
    return;
  }
  const queued = jarvisPendingAudio;
  jarvisPendingAudio = null;
  playJarvisAudio(queued.base64, queued.mimeType, queued.meta);
}

function unlockJarvisAudioPlayback() {
  if (jarvisAudioUnlocked) {
    return;
  }
  jarvisAudioUnlocked = true;
  emitJarvisAudioTrace("info", "user-gesture-unlock");
  if (state.jarvis.audioError.startsWith("Audio queued")) {
    state.jarvis.audioError = "";
  }
  renderJarvisStatus();
  playQueuedJarvisAudio();
}

function bindJarvisAudioUnlockHandlers() {
  const unlockOnGesture = () => {
    unlockJarvisAudioPlayback();
  };
  window.addEventListener("pointerdown", unlockOnGesture, { once: true, passive: true });
  window.addEventListener("touchstart", unlockOnGesture, { once: true, passive: true });
  window.addEventListener("keydown", unlockOnGesture, { once: true });
}

function disposeJarvisAudioPlayback() {
  jarvisAudioUnlocked = false;
  jarvisPendingAudio = null;
  jarvisPendingRetryCount = 0;
  clearJarvisPendingRetryTimer();
  if (jarvisAudioPlayer) {
    try {
      jarvisAudioPlayer.pause();
    } catch {
      // no-op
    }
    jarvisAudioPlayer = null;
  }
  releaseJarvisAudioObjectUrl();
}

async function tryPlayJarvisAudioWithWebAudio(bytes, meta) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    emitJarvisAudioTrace("warn", "webaudio-unavailable", {
      reason: meta?.reason || "",
      auto: Boolean(meta?.auto)
    });
    return false;
  }

  let context = null;
  try {
    context = new AudioContextCtor();
    if (context.state === "suspended") {
      await context.resume();
    }
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
    const sourceNode = context.createBufferSource();
    sourceNode.buffer = decoded;
    sourceNode.connect(context.destination);
    sourceNode.onended = () => {
      emitJarvisAudioTrace("info", "webaudio-ended", {
        reason: meta?.reason || "",
        auto: Boolean(meta?.auto)
      });
      context.close().catch(() => {
        // no-op
      });
    };
    sourceNode.start(0);
    emitJarvisAudioTrace("info", "webaudio-started", {
      reason: meta?.reason || "",
      auto: Boolean(meta?.auto)
    });
    return true;
  } catch (error) {
    const normalized = normalizePlaybackError(error);
    emitJarvisAudioTrace("warn", "webaudio-failed", {
      reason: meta?.reason || "",
      auto: Boolean(meta?.auto),
      errorName: normalized.name,
      errorMessage: normalized.message
    });
    if (context) {
      context.close().catch(() => {
        // no-op
      });
    }
    return false;
  }
}

function playJarvisAudio(base64, mimeType, meta = null) {
  // Policy: never fall back to browser speechSynthesis for Jarvis supervisor audio.
  const normalizedBase64 = normalizeAudioBase64(base64);
  if (!normalizedBase64) {
    emitJarvisAudioTrace("warn", "audio-payload-missing", {
      reason: meta?.reason || "",
      auto: Boolean(meta?.auto)
    });
    return;
  }
  const bytes = decodeBase64ToBytes(normalizedBase64);
  if (!bytes) {
    state.jarvis.audioError = "Invalid audio payload from Jarvis.";
    emitJarvisAudioTrace("warn", "audio-decode-failed", {
      reason: meta?.reason || "",
      auto: Boolean(meta?.auto),
      bytesBase64: normalizedBase64.length
    });
    renderJarvisStatus();
    return;
  }

  emitJarvisAudioTrace("info", "audio-play-requested", {
    reason: meta?.reason || "",
    auto: Boolean(meta?.auto),
    mimeType: mimeType || "audio/mpeg",
    bytesBase64: normalizedBase64.length
  });

  const audioBlob = new Blob([bytes], { type: mimeType || "audio/mpeg" });
  const source = URL.createObjectURL(audioBlob);
  releaseJarvisAudioObjectUrl();
  jarvisAudioObjectUrl = source;

  if (jarvisAudioPlayer) {
    try {
      jarvisAudioPlayer.pause();
    } catch {
      // no-op
    }
  }

  const player = new Audio(source);
  jarvisAudioPlayer = player;
  player.onended = () => {
    if (jarvisAudioPlayer === player) {
      jarvisAudioPlayer = null;
    }
    state.jarvis.audioError = "";
    releaseJarvisAudioObjectUrl(source);
    renderJarvisStatus();
  };
  player.onerror = () => {
    if (jarvisAudioPlayer === player) {
      jarvisAudioPlayer = null;
    }
    state.jarvis.audioError = "Playback failed in webview.";
    emitJarvisAudioTrace("warn", "html-audio-error-event", {
      reason: meta?.reason || "",
      auto: Boolean(meta?.auto)
    });
    releaseJarvisAudioObjectUrl(source);
    renderJarvisStatus();
  };

  player.play().then(() => {
    jarvisAudioUnlocked = true;
    jarvisPendingRetryCount = 0;
    clearJarvisPendingRetryTimer();
    state.jarvis.audioError = "";
    emitJarvisAudioTrace("info", "html-audio-played", {
      reason: meta?.reason || "",
      auto: Boolean(meta?.auto)
    });
    renderJarvisStatus();
  }).catch(async (error) => {
    const firstError = normalizePlaybackError(error);
    emitJarvisAudioTrace("warn", "html-audio-play-failed", {
      reason: meta?.reason || "",
      auto: Boolean(meta?.auto),
      errorName: firstError.name,
      errorMessage: firstError.message
    });

    if (firstError.name === "NotAllowedError") {
      try {
        player.muted = true;
        await player.play();
        setTimeout(() => {
          player.muted = false;
          player.volume = 1;
        }, 60);
        jarvisAudioUnlocked = true;
        jarvisPendingRetryCount = 0;
        clearJarvisPendingRetryTimer();
        state.jarvis.audioError = "";
        emitJarvisAudioTrace("info", "html-audio-muted-bootstrap", {
          reason: meta?.reason || "",
          auto: Boolean(meta?.auto)
        });
        renderJarvisStatus();
        return;
      } catch (mutedError) {
        const normalizedMuted = normalizePlaybackError(mutedError);
        emitJarvisAudioTrace("warn", "html-audio-muted-bootstrap-failed", {
          reason: meta?.reason || "",
          auto: Boolean(meta?.auto),
          errorName: normalizedMuted.name,
          errorMessage: normalizedMuted.message
        });
      }
    }

    const webAudioPlayed = await tryPlayJarvisAudioWithWebAudio(bytes, meta);
    if (webAudioPlayed) {
      if (jarvisAudioPlayer === player) {
        jarvisAudioPlayer = null;
      }
      jarvisAudioUnlocked = true;
      jarvisPendingRetryCount = 0;
      clearJarvisPendingRetryTimer();
      state.jarvis.audioError = "";
      releaseJarvisAudioObjectUrl(source);
      renderJarvisStatus();
      return;
    }

    if (jarvisAudioPlayer === player) {
      jarvisAudioPlayer = null;
    }
    queueJarvisPendingAudio(normalizedBase64, mimeType, meta);
    scheduleJarvisPendingRetry();
    releaseJarvisAudioObjectUrl(source);
    state.jarvis.audioError = "Automatic audio playback failed; retrying in background.";
    emitJarvisAudioTrace("warn", "audio-queued-for-retry", {
      reason: meta?.reason || "",
      auto: Boolean(meta?.auto)
    });
    renderJarvisStatus();
  });
}

function handleJarvisSpeak(payload) {
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text) {
    return;
  }
  const reason = typeof payload?.reason === "string" ? payload.reason : "";
  const auto = Boolean(payload?.auto);

  state.jarvis.lastMessage = text;
  state.jarvis.lastReason = reason || null;
  state.jarvis.focusLabel = typeof payload?.focusHint?.label === "string" ? payload.focusHint.label : "";
  state.jarvis.audioError = "";

  if (payload?.focusHint) {
    applyJarvisFocusHint(payload.focusHint);
  }

  render();
  renderJarvisStatus();

  const audioBase64 = typeof payload?.audioBase64 === "string" ? payload.audioBase64 : "";
  const mimeType = typeof payload?.mimeType === "string" ? payload.mimeType : "audio/mpeg";
  const audioHandledByHost = Boolean(payload?.audioHandledByHost);
  if (audioBase64) {
    emitJarvisAudioTrace("info", "jarvis-speak-received", {
      reason,
      auto,
      mimeType,
      bytesBase64: audioBase64.length
    });
    playJarvisAudio(audioBase64, mimeType, { reason, auto });
  } else if (audioHandledByHost) {
    state.jarvis.audioError = "";
    emitJarvisAudioTrace("info", "jarvis-speak-host-playback", {
      reason,
      auto
    });
    renderJarvisStatus();
  } else {
    state.jarvis.audioError = "No AI audio payload returned from supervisor.";
    emitJarvisAudioTrace("warn", "jarvis-speak-no-audio", {
      reason,
      auto
    });
    renderJarvisStatus();
  }
}

function getWakeWordPromptFromTranscript(transcript) {
  const text = String(transcript || "").trim().toLowerCase();
  if (!text) {
    return null;
  }
  if (!text.includes("jarvis")) {
    return null;
  }

  const pattern = /(?:hey|ok|okay|yo|wake up)?\s*jarvis[,\s:.-]*(.*)$/i;
  const match = text.match(pattern);
  if (!match) {
    return "";
  }
  return String(match[1] || "").trim();
}

function stopWakeWordListening() {
  state.jarvis.wakeWordEnabled = false;
  if (jarvisWakeRecognition) {
    try {
      jarvisWakeRecognition.onend = null;
      jarvisWakeRecognition.stop();
    } catch {
      // no-op
    }
  }
  jarvisWakeRecognition = null;
  state.jarvis.wakeWordStatus = "Wake word off";
  renderJarvisStatus();
}

function startWakeWordListening() {
  const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!RecognitionCtor) {
    state.jarvis.wakeWordSupported = false;
    state.jarvis.wakeWordEnabled = false;
    state.jarvis.wakeWordStatus = "Wake word unavailable";
    renderJarvisStatus();
    return;
  }

  state.jarvis.wakeWordSupported = true;
  state.jarvis.wakeWordEnabled = true;

  jarvisWakeRecognition = new RecognitionCtor();
  jarvisWakeRecognition.lang = "en-US";
  jarvisWakeRecognition.continuous = true;
  jarvisWakeRecognition.interimResults = false;
  state.jarvis.wakeWordStatus = "Wake word listening";

  jarvisWakeRecognition.onresult = (event) => {
    const lastResult = event.results[event.results.length - 1];
    if (!lastResult || !lastResult[0]) {
      return;
    }
    const transcript = String(lastResult[0].transcript || "");
    const wakePrompt = getWakeWordPromptFromTranscript(transcript);
    if (wakePrompt === null) {
      return;
    }
    state.jarvis.wakeWordStatus = "Wake word detected";
    renderJarvisStatus();
    vscode.postMessage({
      type: "jarvisActivate",
      prompt: wakePrompt.length > 0 ? wakePrompt : "Give me a concise status update."
    });
  };

  jarvisWakeRecognition.onerror = () => {
    state.jarvis.wakeWordStatus = "Wake word mic error";
    renderJarvisStatus();
  };

  jarvisWakeRecognition.onend = () => {
    if (!state.jarvis.wakeWordEnabled) {
      return;
    }
    try {
      jarvisWakeRecognition.start();
    } catch {
      state.jarvis.wakeWordStatus = "Wake word restart blocked";
      renderJarvisStatus();
    }
  };

  try {
    jarvisWakeRecognition.start();
  } catch {
    state.jarvis.wakeWordEnabled = false;
    state.jarvis.wakeWordStatus = "Wake word start failed";
  }

  renderJarvisStatus();
}

function toggleWakeWordListening() {
  if (state.jarvis.wakeWordEnabled) {
    stopWakeWordListening();
    return;
  }
  startWakeWordListening();
}

function emptyText(message) {
  const div = document.createElement("div");
  div.className = "empty";
  div.textContent = message;
  return div;
}

function addChip(container, value, className) {
  if (!value) {
    return;
  }
  const chip = document.createElement("span");
  chip.className = `chip ${className}`;
  chip.textContent = value;
  container.appendChild(chip);
}

function filteredBoardItems() {
  const items = state.snapshot?.board?.items || [];
  return items.filter((item) => {
    if (state.filters.repo !== "all" && item.repo !== state.filters.repo) return false;
    if (state.filters.lane !== "all" && item.status !== state.filters.lane) return false;
    if (state.filters.workMode !== "all" && item.workMode !== state.filters.workMode) return false;
    if (state.filters.assignee !== "all" && !(item.assignees || []).includes(state.filters.assignee)) return false;
    return true;
  });
}

function filteredPullRequests() {
  const pullRequests = state.snapshot?.actions?.pullRequests || [];
  return pullRequests.filter((entry) => {
    if (state.filters.repo !== "all" && entry.repo !== state.filters.repo) {
      return false;
    }
    return true;
  });
}

function selectedIssue() {
  if (!state.snapshot || state.selected?.kind !== "issue") {
    return null;
  }
  return state.snapshot.board.items.find((item) => item.itemId === state.selected.id) || null;
}

function selectedPullRequest() {
  if (!state.snapshot || state.selected?.kind !== "pullRequest") {
    return null;
  }
  return state.snapshot.actions.pullRequests.find((entry) => entry.id === state.selected.id) || null;
}

function selectedRun() {
  if (!state.snapshot || state.selected?.kind !== "run") {
    return null;
  }
  return state.snapshot.actions.runs.find((entry) => entry.id === state.selected.id) || null;
}

function renderBoard() {
  const root = byId("boardLanes");
  const counts = byId("boardCounts");
  const summaryCounts = byId("boardCountsSummary");
  root.innerHTML = "";

  const all = state.snapshot?.board?.items || [];
  const items = filteredBoardItems();
  counts.textContent = `Showing ${items.length} of ${all.length} board items`;
  if (summaryCounts) {
    summaryCounts.textContent = `${items.length}/${all.length}`;
  }

  statusOrder.forEach((status) => {
    const lane = document.createElement("section");
    lane.className = "lane";
    const laneItems = items.filter((item) => item.status === status);
    const collapsed = Boolean(state.laneCollapse[status]);

    const header = document.createElement("div");
    header.className = "lane-header";
    const left = document.createElement("div");
    left.className = "lane-title-wrap";
    const toggle = document.createElement("button");
    toggle.className = "lane-toggle";
    toggle.type = "button";
    toggle.textContent = collapsed ? ">" : "v";
    toggle.onclick = () => {
      state.laneCollapse[status] = !state.laneCollapse[status];
      renderBoard();
    };
    left.appendChild(toggle);
    const title = document.createElement("div");
    title.className = "lane-title";
    title.textContent = `${status} (${laneItems.length})`;
    left.appendChild(title);
    header.appendChild(left);
    lane.appendChild(header);

    if (!laneItems.length) {
      lane.appendChild(emptyText("No items"));
      root.appendChild(lane);
      return;
    }

    if (collapsed) {
      lane.appendChild(emptyText("Collapsed"));
      root.appendChild(lane);
      return;
    }

    const cards = document.createElement("div");
    cards.className = "lane-cards";
    laneItems.slice(0, 50).forEach((item) => {
      const card = document.createElement("button");
      card.className = "card";
      card.type = "button";
      if (state.selected?.kind === "issue" && state.selected.id === item.itemId) card.classList.add("selected");
      card.onclick = () => {
        state.selected = { kind: "issue", id: item.itemId };
        render();
      };

      const cardTitle = document.createElement("div");
      cardTitle.className = "title";
      cardTitle.textContent = item.title || "(Untitled)";
      card.appendChild(cardTitle);
      const meta = document.createElement("div");
      meta.className = "meta-line";
      meta.textContent = `${item.repo || "unknown"} | #${item.issueNumber || "?"}`;
      card.appendChild(meta);

      const chips = document.createElement("div");
      chips.className = "card-chips";
      addChip(chips, item.workMode, "workmode");
      addChip(chips, item.area, "area");
      addChip(chips, item.priority, "priority");
      addChip(chips, item.size, "size");
      if (chips.childNodes.length > 0) {
        card.appendChild(chips);
      }

      if (item.claimOwner) {
        const owner = document.createElement("div");
        owner.className = "meta-line secondary";
        owner.textContent = `Claim owner: ${item.claimOwner}`;
        card.appendChild(owner);
      }
      if (item.assignees?.length) {
        const assignees = document.createElement("div");
        assignees.className = "meta-line secondary";
        assignees.textContent = `Assignees: ${item.assignees.join(", ")}`;
        card.appendChild(assignees);
      }

      cards.appendChild(card);
    });
    lane.appendChild(cards);
    root.appendChild(lane);
  });
}

function renderIssuesWorkbench() {
  const listRoot = byId("issuesWorkbenchList");
  const detailRoot = byId("issueWorkbenchDetail");
  const counts = byId("issueWorkbenchCounts");
  const summaryCounts = byId("issueWorkbenchCountsSummary");
  if (state.mode === "agent-only" || !listRoot || !detailRoot) {
    return;
  }

  listRoot.innerHTML = "";
  detailRoot.innerHTML = "";

  const all = state.snapshot?.board?.items || [];
  const filtered = filteredBoardItems();
  if (counts) {
    counts.textContent = `Issues ${filtered.length} of ${all.length}`;
  }
  if (summaryCounts) {
    summaryCounts.textContent = `${filtered.length}/${all.length}`;
  }

  if (!filtered.length) {
    listRoot.appendChild(emptyText("No issues for current filters."));
    detailRoot.appendChild(emptyText("Select an issue to inspect and update."));
    return;
  }

  filtered.slice(0, 120).forEach((item) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    if (state.selected?.kind === "issue" && state.selected.id === item.itemId) {
      card.classList.add("selected");
    }
    card.onclick = () => {
      state.selected = { kind: "issue", id: item.itemId };
      render();
    };

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = `#${item.issueNumber || "?"} ${item.title || "(Untitled)"}`;
    card.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "meta-line";
    meta.textContent = `${item.repo} | ${item.status} | ${item.workMode || "(no work mode)"}`;
    card.appendChild(meta);

    if (item.labels?.length) {
      const labels = document.createElement("div");
      labels.className = "meta-line secondary";
      labels.textContent = `Labels: ${item.labels.slice(0, 4).join(", ")}${item.labels.length > 4 ? "..." : ""}`;
      card.appendChild(labels);
    }

    listRoot.appendChild(card);
  });

  const selected = selectedIssue() || filtered[0] || null;
  if (!selected) {
    detailRoot.appendChild(emptyText("Select an issue to inspect and update."));
    return;
  }
  if (state.selected?.kind !== "issue") {
    state.selected = { kind: "issue", id: selected.itemId };
  }

  detailRoot.appendChild(textLine(`#${selected.issueNumber || "?"} ${selected.title}`, "detail-title"));
  detailRoot.appendChild(textLine(`Repo: ${selected.repo}`, "meta-line"));
  detailRoot.appendChild(textLine(`Status: ${selected.status}`, "meta-line"));
  detailRoot.appendChild(textLine(`Work mode: ${selected.workMode || "(none)"}`, "meta-line"));
  detailRoot.appendChild(textLine(`Area: ${selected.area || "(none)"} | Priority: ${selected.priority || "(none)"} | Size: ${selected.size || "(none)"}`, "meta-line"));
  if (selected.assignees?.length) {
    detailRoot.appendChild(textLine(`Assignees: ${selected.assignees.join(", ")}`, "meta-line"));
  }
  if (selected.labels?.length) {
    detailRoot.appendChild(textLine(`Labels: ${selected.labels.join(", ")}`, "meta-line secondary"));
  }
  if (selected.claimOwner) {
    detailRoot.appendChild(textLine(`Claim owner: ${selected.claimOwner}`, "meta-line secondary"));
  }
  if (selected.lastHeartbeat) {
    detailRoot.appendChild(textLine(`Last heartbeat: ${formatTime(selected.lastHeartbeat)} (${formatAge(selected.lastHeartbeat)})`, "meta-line secondary"));
  }

  const actions = document.createElement("div");
  actions.className = "inline-actions";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "lane-action";
  open.textContent = "Open Issue";
  open.onclick = () => {
    if (selected.url) {
      vscode.postMessage({ type: "openIssue", url: selected.url });
    }
  };
  actions.appendChild(open);

  const updateField = document.createElement("button");
  updateField.type = "button";
  updateField.className = "lane-action";
  updateField.textContent = "Update Field";
  updateField.onclick = () => {
    vscode.postMessage({ type: "issueUpdateField", itemId: selected.itemId });
  };
  actions.appendChild(updateField);

  const updateLabels = document.createElement("button");
  updateLabels.type = "button";
  updateLabels.className = "lane-action";
  updateLabels.textContent = "Update Labels";
  updateLabels.onclick = () => {
    vscode.postMessage({ type: "issueUpdateLabels", itemId: selected.itemId });
  };
  actions.appendChild(updateLabels);

  detailRoot.appendChild(actions);
}
function render() {
  if (!state.snapshot) return;
  renderAuth();
  renderTopbarSections();
  renderJarvisStatus();
  renderThemeControls();
  renderLeftSections();
  renderWorkspaceTabs();
  renderAgentLayout();
  renderChatComposerLayout();
  renderMeta();
  renderBoard();
  renderOpsOverviews();
  renderIssuesWorkbench();
  renderIssueCreateForm();
  renderPullRequests();
  renderPullRequestCreateForm();
  renderPullRequestCommentPanel();
  renderActions();
  renderSessions();
  renderControlMeta();
  renderStopButtons();
  renderFeed();
  renderContextChips();
  renderChatTimeline();
}

