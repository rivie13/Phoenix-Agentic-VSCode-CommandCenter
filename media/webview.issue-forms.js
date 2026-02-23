function uniqueNormalizedValues(values) {
  const unique = new Set();
  (Array.isArray(values) ? values : []).forEach((entry) => {
    const normalized = String(entry || "").trim();
    if (normalized) {
      unique.add(normalized);
    }
  });
  return Array.from(unique).sort((left, right) => left.localeCompare(right));
}

function parseCsvValues(rawText) {
  return uniqueNormalizedValues(
    String(rawText || "")
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  );
}

function normalizeIssueCreateType(value) {
  const normalized = String(value || "").trim();
  return issueCreateTypeOptions.includes(normalized) ? normalized : "Subfeature";
}

function normalizeIssueCreateFieldOptions(rawOptions) {
  const normalized = createEmptyIssueCreateFieldOptions();
  if (!rawOptions || typeof rawOptions !== "object") {
    return normalized;
  }
  issueCreateFieldKeys.forEach((key) => {
    normalized[key] = uniqueNormalizedValues(rawOptions[key]);
  });
  return normalized;
}

function setSingleSelectOptions(selectEl, options, selectedValue, emptyLabel = "(not set)") {
  if (!(selectEl instanceof HTMLSelectElement)) {
    return "";
  }
  const normalized = uniqueNormalizedValues(options);
  const prior = String(selectedValue || "").trim();
  selectEl.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = emptyLabel;
  selectEl.appendChild(empty);
  normalized.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    selectEl.appendChild(option);
  });
  selectEl.value = normalized.includes(prior) ? prior : "";
  return selectEl.value;
}

function setMultiSelectOptions(selectEl, options, selectedValues) {
  if (!(selectEl instanceof HTMLSelectElement)) {
    return [];
  }
  const normalizedOptions = uniqueNormalizedValues(options);
  const selectedSet = new Set(uniqueNormalizedValues(selectedValues));
  selectEl.innerHTML = "";
  normalizedOptions.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = selectedSet.has(value);
    selectEl.appendChild(option);
  });
  return normalizedOptions.filter((value) => selectedSet.has(value));
}

function selectedMultiValues(selectEl) {
  if (!(selectEl instanceof HTMLSelectElement)) {
    return [];
  }
  return Array.from(selectEl.selectedOptions).map((entry) => String(entry.value || "").trim()).filter((entry) => entry.length > 0);
}

function issueCreateFieldDraftKey(fieldKey) {
  if (fieldKey === "status") return "boardStatus";
  if (fieldKey === "workMode") return "boardWorkMode";
  if (fieldKey === "priority") return "boardPriority";
  if (fieldKey === "size") return "boardSize";
  return "boardArea";
}

function requestIssueCreateMetadata(force = false) {
  const repo = normalizeRepositorySlug(state.forms.issueCreateDraft.repo);
  if (!state.forms.issueCreateOpen || !repo) {
    return;
  }
  const meta = state.forms.issueCreateMeta;
  const alreadyLoaded = meta.loadedRepo === repo && !meta.error;
  if (!force && (meta.loading || alreadyLoaded)) {
    return;
  }
  meta.loading = true;
  meta.error = "";
  meta.repo = repo;
  renderIssueCreateForm();
  vscode.postMessage({
    type: "issueCreateMetadataRequest",
    repo
  });
}

function buildIssueAiAssistPrompt(mode, marker) {
  const draft = state.forms.issueCreateDraft;
  const investigationPrompt = mode === "investigate"
    ? "Focus on likely root causes and concrete investigation steps."
    : "Focus on drafting a high-quality issue body aligned with the provided template fields.";
  return [
    "You are assisting with issue authoring for Phoenix Command Center.",
    `Return your response as markdown and include this exact marker on its own line first: ${marker}`,
    investigationPrompt,
    "",
    "Issue context:",
    `- Type: ${draft.type || "(not set)"}`,
    `- Repository: ${draft.repo || "(not set)"}`,
    `- Title: ${draft.title || "(not set)"}`,
    `- Parent links: ${draft.parentLinks || "(not set)"}`,
    `- Base branch: ${draft.baseBranch || "(not set)"}`,
    `- Planned branch: ${draft.plannedBranch || "(not set)"}`,
    `- Problem statement: ${draft.problemStatement || "(not set)"}`,
    `- Scope in: ${draft.scopeIn || "(not set)"}`,
    `- Scope out: ${draft.scopeOut || "(not set)"}`,
    `- Definition of done: ${draft.definitionOfDone || "(not set)"}`,
    `- Dependencies: ${draft.dependencies || "(not set)"}`,
    `- Risks: ${draft.risks || "(not set)"}`,
    `- Validation plan: ${draft.validationPlan || "(not set)"}`,
    `- Acceptance/requirements: ${draft.acceptanceCriteria || "(not set)"}`,
    `- Architecture impact: ${draft.architectureImpact || "(not set)"}`,
    `- Rollout/PR strategy: ${draft.rolloutStrategy || "(not set)"}`,
    `- Task checklist: ${draft.taskChecklist || "(not set)"}`,
    `- Suspected cause: ${draft.suspectedCause || "(not set)"}`,
    `- Existing investigation notes: ${draft.investigationNotes || "(not set)"}`,
    "",
    "Keep the response concise but actionable."
  ].join("\n");
}

function requestIssueAiAssist(mode) {
  const session = selectedSession();
  if (!session) {
    state.forms.issueCreateAiAssist.status = "Select an active agent session in the right panel before requesting AI assist.";
    renderIssueCreateForm();
    return;
  }

  const requestId = `issue-assist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const marker = `[PHOENIX_ISSUE_ASSIST:${requestId}]`;
  const prompt = buildIssueAiAssistPrompt(mode, marker);
  state.forms.issueCreateAiAssist.busy = true;
  state.forms.issueCreateAiAssist.pendingRequestId = requestId;
  state.forms.issueCreateAiAssist.pendingMode = mode;
  state.forms.issueCreateAiAssist.status = mode === "investigate"
    ? "AI investigation request sent. Waiting for response..."
    : "AI draft request sent. Waiting for response...";
  renderIssueCreateForm();

  vscode.postMessage({
    type: "agentSendMessage",
    sessionId: session.sessionId,
    agentId: session.agentId ?? `${state.compose.service} ${state.compose.mode}`,
    transport: session.transport ?? state.compose.transport,
    message: prompt,
    contextItems: state.contextItems
  });
  appendChatRow("system", `Issue AI assist requested (${mode}).`, session.sessionId);
}

function consumeIssueAiAssistResponseFromSnapshot() {
  const assist = state.forms.issueCreateAiAssist;
  if (!assist.busy || !assist.pendingRequestId || !state.snapshot) {
    return;
  }
  const marker = `[PHOENIX_ISSUE_ASSIST:${assist.pendingRequestId}]`;
  const feed = state.snapshot?.agents?.feed || [];
  const matched = [...feed]
    .sort((left, right) => (parseMs(right.occurredAt) || 0) - (parseMs(left.occurredAt) || 0))
    .find((entry) => typeof entry?.message === "string" && entry.message.includes(marker));
  if (!matched) {
    return;
  }

  let responseText = String(matched.message || "");
  const markerIndex = responseText.indexOf(marker);
  if (markerIndex >= 0) {
    responseText = responseText.slice(markerIndex + marker.length).trim();
  }
  if (!responseText) {
    responseText = "(AI returned no content.)";
  }

  if (assist.pendingMode === "investigate") {
    const existing = String(state.forms.issueCreateDraft.investigationNotes || "").trim();
    state.forms.issueCreateDraft.investigationNotes = existing
      ? `${existing}\n\n${responseText}`
      : responseText;
  } else {
    const existing = String(state.forms.issueCreateDraft.body || "").trim();
    const next = `### AI Draft Suggestion\n${responseText}`;
    state.forms.issueCreateDraft.body = existing ? `${existing}\n\n${next}` : next;
  }

  assist.busy = false;
  assist.pendingRequestId = null;
  assist.pendingMode = null;
  assist.status = "AI response applied to the issue form.";
  renderIssueCreateForm();
}

function openIssueCreateForm(preferredRepo = "") {
  state.forms.issueCreateOpen = true;
  const normalized = normalizeRepositorySlug(preferredRepo);
  if (normalized) {
    state.forms.issueCreateDraft.repo = normalized;
  }
  state.forms.issueCreateStatus = "";
  requestIssueCreateMetadata(true);
  renderIssueCreateForm();
  const titleInput = byId("issueCreateTitleInput");
  if (titleInput instanceof HTMLInputElement) {
    titleInput.focus();
  }
}

function closeIssueCreateForm() {
  state.forms.issueCreateOpen = false;
  state.forms.issueCreateStatus = "";
  state.forms.issueCreateBusy = false;
  state.forms.issueCreateAiAssist.busy = false;
  state.forms.issueCreateAiAssist.pendingRequestId = null;
  state.forms.issueCreateAiAssist.pendingMode = null;
  renderIssueCreateForm();
}

function renderIssueCreateForm() {
  const panel = byId("issueCreateFormPanel");
  const toggleButton = byId("createIssueInIssuesButton");
  const repoSelect = byId("issueCreateRepoSelect");
  const typeSelect = byId("issueCreateTypeSelect");
  const titleInput = byId("issueCreateTitleInput");
  const parentLinksInput = byId("issueCreateParentLinksInput");
  const baseBranchInput = byId("issueCreateBaseBranchInput");
  const plannedBranchInput = byId("issueCreatePlannedBranchInput");
  const branchReasonInput = byId("issueCreateBranchReasonInput");
  const labelSelect = byId("issueCreateLabelSelect");
  const customLabelsInput = byId("issueCreateCustomLabelsInput");
  const labelMeta = byId("issueCreateLabelMeta");
  const problemInput = byId("issueCreateProblemInput");
  const scopeInInput = byId("issueCreateScopeInInput");
  const scopeOutInput = byId("issueCreateScopeOutInput");
  const doneInput = byId("issueCreateDoneInput");
  const dependenciesInput = byId("issueCreateDependenciesInput");
  const risksInput = byId("issueCreateRisksInput");
  const validationInput = byId("issueCreateValidationInput");
  const acceptanceInput = byId("issueCreateAcceptanceInput");
  const architectureInput = byId("issueCreateArchitectureInput");
  const rolloutInput = byId("issueCreateRolloutInput");
  const taskChecklistInput = byId("issueCreateTaskChecklistInput");
  const statusSelect = byId("issueCreateStatusSelect");
  const workModeSelect = byId("issueCreateWorkModeSelect");
  const prioritySelect = byId("issueCreatePrioritySelect");
  const sizeSelect = byId("issueCreateSizeSelect");
  const areaSelect = byId("issueCreateAreaSelect");
  const successMetricsInput = byId("issueCreateSuccessMetricsInput");
  const suspectedCauseInput = byId("issueCreateSuspectedCauseInput");
  const investigationInput = byId("issueCreateInvestigationInput");
  const bodyInput = byId("issueCreateBodyInput");
  const aiDraftButton = byId("issueCreateAiDraftButton");
  const aiInvestigateButton = byId("issueCreateAiInvestigateButton");
  const aiStatus = byId("issueCreateAiStatus");
  const submitButton = byId("submitIssueCreateButton");
  const cancelButton = byId("cancelIssueCreateButton");
  const status = byId("issueCreateFormStatus");

  if (panel) {
    panel.classList.toggle("active", state.forms.issueCreateOpen);
  }
  if (toggleButton instanceof HTMLButtonElement) {
    toggleButton.textContent = state.forms.issueCreateOpen ? "Hide Create Form" : "Create Issue";
  }

  if (repoSelect instanceof HTMLSelectElement) {
    const previousRepo = normalizeRepositorySlug(state.forms.issueCreateDraft.repo);
    const nextRepo = populateRepositorySelect(repoSelect, state.forms.issueCreateDraft.repo);
    state.forms.issueCreateDraft.repo = nextRepo;
    if (state.forms.issueCreateOpen) {
      const metadataRepo = normalizeRepositorySlug(state.forms.issueCreateMeta.repo);
      if (nextRepo && (nextRepo !== metadataRepo || nextRepo !== previousRepo || state.forms.issueCreateMeta.error)) {
        requestIssueCreateMetadata();
      }
    }
  }

  const draft = state.forms.issueCreateDraft;
  draft.type = normalizeIssueCreateType(draft.type);
  if (typeSelect instanceof HTMLSelectElement) {
    typeSelect.value = draft.type;
  }
  if (titleInput instanceof HTMLInputElement) titleInput.value = draft.title;
  if (parentLinksInput instanceof HTMLTextAreaElement) parentLinksInput.value = draft.parentLinks;
  if (baseBranchInput instanceof HTMLInputElement) baseBranchInput.value = draft.baseBranch;
  if (plannedBranchInput instanceof HTMLInputElement) plannedBranchInput.value = draft.plannedBranch;
  if (branchReasonInput instanceof HTMLInputElement) branchReasonInput.value = draft.branchReason;
  if (customLabelsInput instanceof HTMLInputElement) customLabelsInput.value = draft.customLabels;
  if (problemInput instanceof HTMLTextAreaElement) problemInput.value = draft.problemStatement;
  if (scopeInInput instanceof HTMLTextAreaElement) scopeInInput.value = draft.scopeIn;
  if (scopeOutInput instanceof HTMLTextAreaElement) scopeOutInput.value = draft.scopeOut;
  if (doneInput instanceof HTMLTextAreaElement) doneInput.value = draft.definitionOfDone;
  if (dependenciesInput instanceof HTMLTextAreaElement) dependenciesInput.value = draft.dependencies;
  if (risksInput instanceof HTMLTextAreaElement) risksInput.value = draft.risks;
  if (validationInput instanceof HTMLTextAreaElement) validationInput.value = draft.validationPlan;
  if (acceptanceInput instanceof HTMLTextAreaElement) acceptanceInput.value = draft.acceptanceCriteria;
  if (architectureInput instanceof HTMLTextAreaElement) architectureInput.value = draft.architectureImpact;
  if (rolloutInput instanceof HTMLTextAreaElement) rolloutInput.value = draft.rolloutStrategy;
  if (taskChecklistInput instanceof HTMLTextAreaElement) taskChecklistInput.value = draft.taskChecklist;
  if (successMetricsInput instanceof HTMLTextAreaElement) successMetricsInput.value = draft.successMetrics;
  if (suspectedCauseInput instanceof HTMLTextAreaElement) suspectedCauseInput.value = draft.suspectedCause;
  if (investigationInput instanceof HTMLTextAreaElement) investigationInput.value = draft.investigationNotes;
  if (bodyInput instanceof HTMLTextAreaElement) bodyInput.value = draft.body;

  draft.labels = setMultiSelectOptions(labelSelect, state.forms.issueCreateMeta.labels, draft.labels);
  if (labelMeta) {
    if (state.forms.issueCreateMeta.loading) {
      labelMeta.textContent = "Loading labels...";
    } else if (state.forms.issueCreateMeta.error) {
      labelMeta.textContent = `Label load failed: ${state.forms.issueCreateMeta.error}`;
    } else if (state.forms.issueCreateMeta.labels.length > 0) {
      labelMeta.textContent = `${state.forms.issueCreateMeta.labels.length} labels available`;
    } else {
      labelMeta.textContent = "No labels available for this repository.";
    }
  }

  const fieldOptions = state.forms.issueCreateMeta.fieldOptions || createEmptyIssueCreateFieldOptions();
  draft.boardStatus = setSingleSelectOptions(statusSelect, fieldOptions.status, draft.boardStatus);
  draft.boardWorkMode = setSingleSelectOptions(workModeSelect, fieldOptions.workMode, draft.boardWorkMode);
  draft.boardPriority = setSingleSelectOptions(prioritySelect, fieldOptions.priority, draft.boardPriority);
  draft.boardSize = setSingleSelectOptions(sizeSelect, fieldOptions.size, draft.boardSize);
  draft.boardArea = setSingleSelectOptions(areaSelect, fieldOptions.area, draft.boardArea);

  const aiBusy = Boolean(state.forms.issueCreateAiAssist.busy);
  if (aiDraftButton instanceof HTMLButtonElement) {
    aiDraftButton.disabled = aiBusy || state.forms.issueCreateBusy || !state.forms.issueCreateOpen;
    aiDraftButton.textContent = aiBusy && state.forms.issueCreateAiAssist.pendingMode === "draft"
      ? "AI Drafting..."
      : "AI Draft Issue";
  }
  if (aiInvestigateButton instanceof HTMLButtonElement) {
    aiInvestigateButton.disabled = aiBusy || state.forms.issueCreateBusy || !state.forms.issueCreateOpen;
    aiInvestigateButton.textContent = aiBusy && state.forms.issueCreateAiAssist.pendingMode === "investigate"
      ? "AI Investigating..."
      : "AI Investigate Cause";
  }
  if (aiStatus) {
    aiStatus.textContent = state.forms.issueCreateAiAssist.status;
  }

  if (submitButton instanceof HTMLButtonElement) {
    submitButton.disabled = state.forms.issueCreateBusy || !state.forms.issueCreateOpen || !state.forms.issueCreateDraft.repo;
    submitButton.textContent = state.forms.issueCreateBusy ? "Creating..." : "Create Issue";
  }
  if (cancelButton instanceof HTMLButtonElement) {
    cancelButton.disabled = state.forms.issueCreateBusy;
  }
  if (status) {
    status.textContent = state.forms.issueCreateStatus;
  }
}

function collectIssueCreateLabels() {
  const selected = uniqueNormalizedValues(state.forms.issueCreateDraft.labels);
  const custom = parseCsvValues(state.forms.issueCreateDraft.customLabels);
  return uniqueNormalizedValues([...selected, ...custom]);
}

function submitIssueCreateForm() {
  const repo = normalizeRepositorySlug(state.forms.issueCreateDraft.repo);
  const draft = state.forms.issueCreateDraft;
  const title = String(draft.title || "").trim();
  const baseBranch = String(draft.baseBranch || "").trim();
  const plannedBranch = String(draft.plannedBranch || "").trim();
  const problemStatement = String(draft.problemStatement || "").trim();
  const scopeIn = String(draft.scopeIn || "").trim();
  const definitionOfDone = String(draft.definitionOfDone || "").trim();
  const validationPlan = String(draft.validationPlan || "").trim();
  const parentLinks = String(draft.parentLinks || "").trim();

  const missing = [];
  if (!repo) missing.push("repository");
  if (!title) missing.push("title");
  if (!baseBranch) missing.push("base branch");
  if (!plannedBranch) missing.push("planned branch");
  if (!problemStatement) missing.push("problem statement");
  if (!scopeIn) missing.push("scope in");
  if (!definitionOfDone) missing.push("definition of done");
  if (!validationPlan) missing.push("validation plan");
  if (draft.type !== "Epic" && !parentLinks) missing.push("parent links");

  if (missing.length > 0) {
    state.forms.issueCreateStatus = `Required: ${missing.join(", ")}.`;
    renderIssueCreateForm();
    return;
  }

  state.forms.issueCreateBusy = true;
  state.forms.issueCreateStatus = "Creating issue...";
  renderIssueCreateForm();

  vscode.postMessage({
    type: "createIssueFromView",
    repo,
    title,
    labels: collectIssueCreateLabels(),
    body: draft.body || "",
    template: {
      type: draft.type,
      parentLinks: draft.parentLinks,
      baseBranch: draft.baseBranch,
      plannedBranch: draft.plannedBranch,
      branchReason: draft.branchReason,
      problemStatement: draft.problemStatement,
      scopeIn: draft.scopeIn,
      scopeOut: draft.scopeOut,
      definitionOfDone: draft.definitionOfDone,
      dependencies: draft.dependencies,
      risks: draft.risks,
      validationPlan: draft.validationPlan,
      acceptanceCriteria: draft.acceptanceCriteria,
      architectureImpact: draft.architectureImpact,
      rolloutStrategy: draft.rolloutStrategy,
      taskChecklist: draft.taskChecklist,
      successMetrics: draft.successMetrics,
      suspectedCause: draft.suspectedCause,
      investigationNotes: draft.investigationNotes
    },
    boardFields: {
      status: draft.boardStatus,
      workMode: draft.boardWorkMode,
      priority: draft.boardPriority,
      size: draft.boardSize,
      area: draft.boardArea
    }
  });
}

function openPullRequestCreateForm(preferredRepo = "") {
  state.forms.pullRequestCreateOpen = true;
  const normalized = normalizeRepositorySlug(preferredRepo);
  if (normalized) {
    state.forms.pullRequestCreateDraft.repo = normalized;
  }
  if (!state.forms.pullRequestCreateDraft.head && state.runtime.workspaceBranch) {
    state.forms.pullRequestCreateDraft.head = state.runtime.workspaceBranch;
  }
  state.forms.pullRequestCreateStatus = "";
  renderPullRequestCreateForm();
  const titleInput = byId("pullRequestCreateTitleInput");
  if (titleInput instanceof HTMLInputElement) {
    titleInput.focus();
  }
}

function closePullRequestCreateForm() {
  state.forms.pullRequestCreateOpen = false;
  state.forms.pullRequestCreateStatus = "";
  state.forms.pullRequestCreateBusy = false;
  renderPullRequestCreateForm();
}

function renderPullRequestCreateForm() {
  const panel = byId("pullRequestCreateFormPanel");
  const toggleButton = byId("createPullRequestInPullRequestsButton");
  const repoSelect = byId("pullRequestCreateRepoSelect");
  const titleInput = byId("pullRequestCreateTitleInput");
  const headInput = byId("pullRequestCreateHeadInput");
  const baseInput = byId("pullRequestCreateBaseInput");
  const bodyInput = byId("pullRequestCreateBodyInput");
  const draftInput = byId("pullRequestCreateDraftInput");
  const submitButton = byId("submitPullRequestCreateButton");
  const cancelButton = byId("cancelPullRequestCreateButton");
  const status = byId("pullRequestCreateFormStatus");

  if (panel) {
    panel.classList.toggle("active", state.forms.pullRequestCreateOpen);
  }
  if (toggleButton instanceof HTMLButtonElement) {
    toggleButton.textContent = state.forms.pullRequestCreateOpen ? "Hide Create Form" : "Create PR";
  }

  if (repoSelect instanceof HTMLSelectElement) {
    state.forms.pullRequestCreateDraft.repo = populateRepositorySelect(repoSelect, state.forms.pullRequestCreateDraft.repo);
  }
  if (titleInput instanceof HTMLInputElement) {
    titleInput.value = state.forms.pullRequestCreateDraft.title;
  }
  if (headInput instanceof HTMLInputElement) {
    headInput.value = state.forms.pullRequestCreateDraft.head;
  }
  if (baseInput instanceof HTMLInputElement) {
    baseInput.value = state.forms.pullRequestCreateDraft.base || "main";
  }
  if (bodyInput instanceof HTMLTextAreaElement) {
    bodyInput.value = state.forms.pullRequestCreateDraft.body;
  }
  if (draftInput instanceof HTMLInputElement) {
    draftInput.checked = Boolean(state.forms.pullRequestCreateDraft.draft);
  }
  if (submitButton instanceof HTMLButtonElement) {
    submitButton.disabled = state.forms.pullRequestCreateBusy || !state.forms.pullRequestCreateOpen || !state.forms.pullRequestCreateDraft.repo;
    submitButton.textContent = state.forms.pullRequestCreateBusy ? "Creating..." : "Create PR";
  }
  if (cancelButton instanceof HTMLButtonElement) {
    cancelButton.disabled = state.forms.pullRequestCreateBusy;
  }
  if (status) {
    status.textContent = state.forms.pullRequestCreateStatus;
  }
}

function submitPullRequestCreateForm() {
  const repo = normalizeRepositorySlug(state.forms.pullRequestCreateDraft.repo);
  const title = state.forms.pullRequestCreateDraft.title.trim();
  const head = state.forms.pullRequestCreateDraft.head.trim();
  const base = state.forms.pullRequestCreateDraft.base.trim();
  if (!repo || !title || !head || !base) {
    state.forms.pullRequestCreateStatus = "Repository, title, head, and base are required.";
    renderPullRequestCreateForm();
    return;
  }

  state.forms.pullRequestCreateBusy = true;
  state.forms.pullRequestCreateStatus = "Creating pull request...";
  renderPullRequestCreateForm();

  vscode.postMessage({
    type: "createPullRequestFromView",
    repo,
    title,
    body: state.forms.pullRequestCreateDraft.body || "",
    head,
    base,
    draft: Boolean(state.forms.pullRequestCreateDraft.draft)
  });
}
