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

function selectedSession() {
  if (!state.snapshot) return null;
  if (state.sessionLockId) {
    return (state.snapshot.agents.sessions || []).find((s) => s.sessionId === state.sessionLockId) || null;
  }
  if (state.selected?.kind !== "session") return null;
  return (state.snapshot.agents.sessions || []).find((s) => s.sessionId === state.selected.id) || null;
}

function syncSelectedSessionFromSnapshot() {
  if (!state.snapshot) {
    return;
  }

  const sessions = [...(state.snapshot.agents.sessions || [])]
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
  const card = document.createElement("section");
  card.className = "card session-card";
  if (state.selected?.kind === "session" && state.selected.id === session.sessionId) card.classList.add("selected");
  const collapsed = Boolean(state.sessionCollapse[session.sessionId]);

  const top = document.createElement("div");
  top.className = "session-head";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = `${session.agentId} (${session.transport})`;
  top.appendChild(title);

  const actions = document.createElement("div");
  actions.className = "inline-actions";
  const toggle = document.createElement("button");
  toggle.className = "lane-action";
  toggle.type = "button";
  toggle.textContent = collapsed ? "Expand" : "Collapse";
  toggle.onclick = (event) => {
    event.stopPropagation();
    state.sessionCollapse[session.sessionId] = !collapsed;
    renderSessions();
  };
  actions.appendChild(toggle);
  const pin = document.createElement("button");
  pin.className = "lane-action";
  pin.type = "button";
  pin.textContent = session.pinned ? "Unpin" : "Pin";
  pin.onclick = (event) => {
    event.stopPropagation();
    vscode.postMessage({ type: "sessionPin", sessionId: session.sessionId, pinned: !session.pinned });
  };
  actions.appendChild(pin);
  const archive = document.createElement("button");
  archive.className = "lane-action";
  archive.type = "button";
  archive.textContent = session.archived ? "Restore" : "Archive";
  archive.onclick = (event) => {
    event.stopPropagation();
    vscode.postMessage({ type: session.archived ? "sessionRestore" : "sessionArchive", sessionId: session.sessionId });
  };
  actions.appendChild(archive);
  const openEditor = document.createElement("button");
  openEditor.className = "lane-action";
  openEditor.type = "button";
  openEditor.textContent = "Open Editor";
  openEditor.onclick = (event) => {
    event.stopPropagation();
    vscode.postMessage({ type: "openSessionEditor", sessionId: session.sessionId });
  };
  actions.appendChild(openEditor);
  top.appendChild(actions);
  card.appendChild(top);

  const meta = document.createElement("div");
  meta.className = "meta-line";
  meta.textContent = `${session.status} | heartbeat ${formatAge(session.lastHeartbeat)} | ${session.summary || ""}`;
  card.appendChild(meta);

  if (!collapsed) {
    const scope = document.createElement("div");
    scope.className = "meta-line secondary";
    scope.textContent = `Repo: ${session.repository || "(none)"} | Branch: ${session.branch || "(none)"}`;
    card.appendChild(scope);
    const workspace = document.createElement("div");
    workspace.className = "meta-line secondary";
    workspace.textContent = `Workspace: ${session.workspace || "(none)"} | Updated: ${formatTime(session.updatedAt)}`;
    card.appendChild(workspace);
  } else {
    card.appendChild(emptyText("Collapsed"));
  }

  card.onclick = () => {
    if (state.sessionLockId) {
      return;
    }
    state.selected = { kind: "session", id: session.sessionId };
    render();
  };
  return card;
}

function renderSessionBucket(root, heading, sessions) {
  const lane = document.createElement("section");
  lane.className = "lane";
  const title = document.createElement("div");
  title.className = "lane-title";
  title.textContent = `${heading} (${sessions.length})`;
  lane.appendChild(title);
  if (!sessions.length) {
    lane.appendChild(emptyText("No sessions"));
    root.appendChild(lane);
    return;
  }
  const cards = document.createElement("div");
  cards.className = "lane-cards";
  sessions.forEach((session) => cards.appendChild(createSessionCard(session)));
  lane.appendChild(cards);
  root.appendChild(lane);
}

function renderSessions() {
  const root = byId("agentSessions");
  const counts = byId("sessionCounts");
  const showArchived = byId("showArchivedSessions");
  if (!root || !counts) {
    return;
  }
  root.innerHTML = "";
  if (showArchived instanceof HTMLInputElement) {
    showArchived.checked = state.showArchived;
  }
  const sessions = [...(state.snapshot?.agents?.sessions || [])].sort((a, b) => (parseMs(b.updatedAt) || 0) - (parseMs(a.updatedAt) || 0));
  if (state.sessionLockId && !state.selected) {
    state.selected = { kind: "session", id: state.sessionLockId };
  }
  const pendingApprovals = (state.snapshot?.agents?.pendingCommands || []).filter((c) => c.status === "pending");
  const archived = sessions.filter((s) => s.archived);
  const scoped = state.sessionLockId ? sessions.filter((s) => s.sessionId === state.sessionLockId) : sessions;
  const visible = state.showArchived ? scoped : scoped.filter((s) => !s.archived);
  const pinned = visible.filter((s) => s.pinned && !s.archived);
  const active = visible.filter((s) => !s.pinned && classifySession(s) === "active");
  const waiting = visible.filter((s) => !s.pinned && classifySession(s) === "waiting");
  const attention = visible.filter((s) => !s.pinned && classifySession(s) === "attention");
  const offline = visible.filter((s) => !s.pinned && classifySession(s) === "offline");

  counts.textContent = `Sessions ${sessions.length} | Pinned ${pinned.length} | Archived ${archived.length} | Pending ${pendingApprovals.length}`;

  if (!scoped.length) {
    root.appendChild(emptyText("Locked session is not currently active."));
    return;
  }
  if (!sessions.length) {
    root.appendChild(emptyText("No sessions reported by supervisor."));
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

function renderFeed() {
  const root = byId("agentFeed");
  root.innerHTML = "";
  const entries = [...(state.snapshot?.agents?.feed || [])]
    .filter((entry) => !isJarvisFeedEntry(entry))
    .sort((a, b) => (parseMs(b.occurredAt) || 0) - (parseMs(a.occurredAt) || 0));
  const selected = selectedSession();
  const stats = computeSessionStats(selected);
  const statsLine = document.createElement("div");
  statsLine.className = "feed-inline";
  statsLine.textContent = selected
    ? `Session stats: ${formatSessionStats(stats)}`
    : "Select a session to view per-session chat/context stats.";
  root.appendChild(statsLine);
  const visible = selected ? entries.filter((entry) => entry.sessionId === selected.sessionId) : entries;
  if (!visible.length) {
    root.appendChild(emptyText(selected ? "No feed for selected session." : "No feed entries."));
    return;
  }
  visible.slice(0, 80).forEach((entry) => {
    const row = document.createElement("div");
    row.className = `feed-row ${entry.level || "info"}`;
    row.appendChild(textLine(`${formatTime(entry.occurredAt)} | ${entry.transport} | ${entry.agentId}`));
    row.appendChild(textLine(entry.message, "feed-text"));
    root.appendChild(row);
  });
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
  if (meta) {
    meta.textContent = session
      ? `Selected: ${session.agentId} (${session.sessionId}) | ${session.transport} | ${session.status} | Continues ${stats?.continues ?? 0} | Chats ${stats?.chatMessages ?? 0}`
      : "No session selected.";
  }
  if (statsMeta) {
    statsMeta.textContent = formatSessionStats(stats);
  }
}

function renderChatComposerLayout() {
  const composer = byId("chatComposer");
  const contextPanel = byId("contextPickerPanel");
  const contextToggle = byId("toggleContextPickerButton");
  const transportSelect = byId("composerTransportSelect");
  const modeSelect = byId("composerModeSelect");
  const serviceSelect = byId("composerServiceSelect");
  const modelSelect = byId("composerModelSelect");
  const toolSelect = byId("composerToolSelect");
  const mcpToolsSelect = byId("composerMcpToolsSelect");
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
  autoResizeComposerInput();
  renderStopButtons();
}

function refreshComposerSelectionState() {
  const transportSelect = byId("composerTransportSelect");
  const modeSelect = byId("composerModeSelect");
  const serviceSelect = byId("composerServiceSelect");
  const modelSelect = byId("composerModelSelect");
  const toolSelect = byId("composerToolSelect");
  const mcpToolsSelect = byId("composerMcpToolsSelect");

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
  if (toolSelect instanceof HTMLSelectElement) {
    state.compose.tool = toolSelect.value;
  }
  if (mcpToolsSelect instanceof HTMLSelectElement) {
    state.compose.mcpTools = Array.from(mcpToolsSelect.selectedOptions)
      .map((option) => String(option.value || "").trim())
      .filter((entry) => entry.length > 0);
  }
  ensureComposeDefaults();
  persistUiState();
}

function renderAgentLayout() {
  const right = byId("rightAgentPane");
  const sessionsSection = byId("agentSessionsSection");
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
  const modelSuffix = modelInfo ? ` [model:${modelInfo.label}]` : "";
  const outboundMessage = `${servicePrefix}${modePrefix}${message}${modelSuffix}`.trim();
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
      toolProfile: state.compose.tool,
      mcpTools: selectedMcpTools,
      contextItems: state.contextItems
    });
  } else {
    const agentId = `${state.compose.service.toUpperCase()} ${state.compose.mode.toUpperCase()} ${modelInfo?.label ?? ""}`.trim();
    vscode.postMessage({
      type: "agentDispatch",
      agentId,
      transport: state.compose.transport,
      summary: outboundMessage,
      service: state.compose.service,
      mode: state.compose.mode,
      model: modelInfo?.id || state.compose.model,
      toolProfile: state.compose.tool,
      mcpTools: selectedMcpTools,
      repository: null,
      branch: null,
      workspace: null
    });
    appendChatRow("system", `Dispatch requested: ${agentId} (${state.compose.transport})`, null);
  }

  appendChatRow("user", outboundMessage, session?.sessionId ?? null);
  msgInput.value = "";
  autoResizeComposerInput();
}

