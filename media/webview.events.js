function bindEvents() {
  const signInButton = byId("signInButton");
  const signInCodexButton = byId("signInCodexButton");
  const signInCopilotButton = byId("signInCopilotButton");
  const pollinationsSignInButton = byId("pollinationsSignInButton");
  const pollinationsApiKeyButton = byId("pollinationsApiKeyButton");
  const configureSupervisorButton = byId("configureSupervisorButton");
  const configureJarvisVoiceButton = byId("configureJarvisVoiceButton");
  const configureModelHubButton = byId("configureModelHubButton");
  const jarvisCallButton = byId("jarvisCallButton");
  const jarvisModeButton = byId("jarvisModeButton");
  const jarvisWakeButton = byId("jarvisWakeButton");
  const openAgentWorkspacePanelButton = byId("openAgentWorkspacePanelButton");
  const refreshButton = byId("refreshButton");
  const openPullRequestsTabFromOpsButton = byId("openPullRequestsTabFromOps");
  const openActionsTabFromOpsButton = byId("openActionsTabFromOps");
  const createIssueInIssuesButton = byId("createIssueInIssuesButton");
  const updateFieldInIssuesButton = byId("updateFieldInIssuesButton");
  const updateLabelsInIssuesButton = byId("updateLabelsInIssuesButton");
  const issueCreateRepoSelect = byId("issueCreateRepoSelect");
  const issueCreateTypeSelect = byId("issueCreateTypeSelect");
  const issueCreateTitleInput = byId("issueCreateTitleInput");
  const issueCreateParentLinksInput = byId("issueCreateParentLinksInput");
  const issueCreateBaseBranchInput = byId("issueCreateBaseBranchInput");
  const issueCreatePlannedBranchInput = byId("issueCreatePlannedBranchInput");
  const issueCreateBranchReasonInput = byId("issueCreateBranchReasonInput");
  const issueCreateLabelSelect = byId("issueCreateLabelSelect");
  const issueCreateCustomLabelsInput = byId("issueCreateCustomLabelsInput");
  const issueCreateProblemInput = byId("issueCreateProblemInput");
  const issueCreateScopeInInput = byId("issueCreateScopeInInput");
  const issueCreateScopeOutInput = byId("issueCreateScopeOutInput");
  const issueCreateDoneInput = byId("issueCreateDoneInput");
  const issueCreateDependenciesInput = byId("issueCreateDependenciesInput");
  const issueCreateRisksInput = byId("issueCreateRisksInput");
  const issueCreateValidationInput = byId("issueCreateValidationInput");
  const issueCreateAcceptanceInput = byId("issueCreateAcceptanceInput");
  const issueCreateArchitectureInput = byId("issueCreateArchitectureInput");
  const issueCreateRolloutInput = byId("issueCreateRolloutInput");
  const issueCreateTaskChecklistInput = byId("issueCreateTaskChecklistInput");
  const issueCreateStatusSelect = byId("issueCreateStatusSelect");
  const issueCreateWorkModeSelect = byId("issueCreateWorkModeSelect");
  const issueCreatePrioritySelect = byId("issueCreatePrioritySelect");
  const issueCreateSizeSelect = byId("issueCreateSizeSelect");
  const issueCreateAreaSelect = byId("issueCreateAreaSelect");
  const issueCreateSuccessMetricsInput = byId("issueCreateSuccessMetricsInput");
  const issueCreateSuspectedCauseInput = byId("issueCreateSuspectedCauseInput");
  const issueCreateInvestigationInput = byId("issueCreateInvestigationInput");
  const issueCreateAiDraftButton = byId("issueCreateAiDraftButton");
  const issueCreateAiInvestigateButton = byId("issueCreateAiInvestigateButton");
  const issueCreateBodyInput = byId("issueCreateBodyInput");
  const submitIssueCreateButton = byId("submitIssueCreateButton");
  const cancelIssueCreateButton = byId("cancelIssueCreateButton");
  const createPullRequestInPullRequestsButton = byId("createPullRequestInPullRequestsButton");
  const pullRequestCreateRepoSelect = byId("pullRequestCreateRepoSelect");
  const pullRequestCreateTitleInput = byId("pullRequestCreateTitleInput");
  const pullRequestCreateHeadInput = byId("pullRequestCreateHeadInput");
  const pullRequestCreateBaseInput = byId("pullRequestCreateBaseInput");
  const pullRequestCreateBodyInput = byId("pullRequestCreateBodyInput");
  const pullRequestCreateDraftInput = byId("pullRequestCreateDraftInput");
  const submitPullRequestCreateButton = byId("submitPullRequestCreateButton");
  const cancelPullRequestCreateButton = byId("cancelPullRequestCreateButton");
  const backgroundModeSelect = byId("backgroundModeSelect");
  const colorSchemeSelect = byId("colorSchemeSelect");
  const themeColorOneInput = byId("themeColorOneInput");
  const themeColorTwoInput = byId("themeColorTwoInput");
  const themeColorThreeInput = byId("themeColorThreeInput");
  const customSchemeNameInput = byId("customSchemeNameInput");
  const saveCustomSchemeButton = byId("saveCustomSchemeButton");
  const collapseAllLeftSectionsButton = byId("collapseAllLeftSections");
  const expandAllLeftSectionsButton = byId("expandAllLeftSections");
  const opsSettingsSection = byId("opsSettingsSection");
  const workspaceControlsSection = byId("workspaceControlsSection");
  const boardSection = byId("boardSection");
  const issuesSection = byId("issuesSection");
  const pullRequestsSection = byId("pullRequestsSection");
  const actionsSection = byId("actionsSection");
  const refreshPullRequestsButton = byId("refreshPullRequestsButton");
  const collapseAllPullRequestsButton = byId("collapseAllPullRequests");
  const expandAllPullRequestsButton = byId("expandAllPullRequests");
  const agentSessionsSection = byId("agentSessionsSection");
  const agentChatSection = byId("agentChatSection");
  const agentComposerSection = byId("agentComposerSection");
  const toggleContextPickerButton = byId("toggleContextPickerButton");
  const composerTransportSelect = byId("composerTransportSelect");
  const composerModeSelect = byId("composerModeSelect");
  const composerServiceSelect = byId("composerServiceSelect");
  const composerModelSelect = byId("composerModelSelect");
  const composerToolSelect = byId("composerToolSelect");
  const composerMcpToolsSelect = byId("composerMcpToolsSelect");
  const composerIssueNumberInput = byId("composerIssueNumberInput");
  const composerIssueNodeIdInput = byId("composerIssueNodeIdInput");
  const collapseAllLanesButton = byId("collapseAllLanes");
  const expandAllLanesButton = byId("expandAllLanes");
  const collapseAllActionsButton = byId("collapseAllActions");
  const expandAllActionsButton = byId("expandAllActions");
  const actionsStackMode = byId("actionsStackMode");
  const collapseAllSessionsButton = byId("collapseAllSessions");
  const expandAllSessionsButton = byId("expandAllSessions");
  const showArchivedSessions = byId("showArchivedSessions");
  const addContextFileButton = byId("addContextFileButton");
  const addContextSelectionButton = byId("addContextSelectionButton");
  const addContextWorkspaceFileButton = byId("addContextWorkspaceFileButton");
  const stopSessionFromChatButton = byId("stopSessionFromChatButton");
  const stopSessionFromComposerButton = byId("stopSessionFromComposerButton");
  const sendAgentMessageButton = byId("sendAgentMessageButton");

  if (signInButton) signInButton.addEventListener("click", () => vscode.postMessage({ type: "command", command: "phoenixOps.signIn" }));
  if (signInCodexButton) signInCodexButton.addEventListener("click", () => vscode.postMessage({ type: "command", command: "phoenixOps.signInCodexCli" }));
  if (signInCopilotButton) signInCopilotButton.addEventListener("click", () => vscode.postMessage({ type: "command", command: "phoenixOps.signInCopilotCli" }));
  if (pollinationsSignInButton) pollinationsSignInButton.addEventListener("click", () => vscode.postMessage({ type: "command", command: "phoenixOps.pollinationsSignIn" }));
  if (pollinationsApiKeyButton) pollinationsApiKeyButton.addEventListener("click", () => vscode.postMessage({ type: "command", command: "phoenixOps.pollinationsSetApiKey" }));
  if (configureSupervisorButton) configureSupervisorButton.addEventListener("click", () => vscode.postMessage({ type: "command", command: "phoenixOps.configureSupervisorMode" }));
  if (configureJarvisVoiceButton) configureJarvisVoiceButton.addEventListener("click", () => vscode.postMessage({ type: "command", command: "phoenixOps.configureJarvisVoice" }));
  if (configureModelHubButton) configureModelHubButton.addEventListener("click", () => vscode.postMessage({ type: "command", command: "phoenixOps.configureModelHub" }));
  if (jarvisCallButton) {
    jarvisCallButton.addEventListener("click", () => {
      if (typeof window.prompt !== "function") {
        vscode.postMessage({ type: "command", command: "phoenixOps.jarvisActivate" });
        return;
      }

      let prompt = null;
      try {
        prompt = window.prompt("Ask Jarvis", "What is going on across sessions right now?");
      } catch {
        prompt = null;
      }
      if (typeof prompt !== "string") {
        vscode.postMessage({ type: "command", command: "phoenixOps.jarvisActivate" });
        return;
      }
      vscode.postMessage({ type: "jarvisActivate", prompt: prompt.trim() });
    });
  }
  if (jarvisModeButton) {
    jarvisModeButton.addEventListener("click", () => {
      vscode.postMessage({ type: "jarvisToggleManualMode" });
    });
  }
  if (jarvisWakeButton) {
    jarvisWakeButton.addEventListener("click", () => {
      toggleWakeWordListening();
    });
  }
  if (openAgentWorkspacePanelButton) openAgentWorkspacePanelButton.addEventListener("click", () => vscode.postMessage({ type: "openAgentWorkspacePanel" }));
  if (refreshButton) refreshButton.addEventListener("click", () => vscode.postMessage({ type: "command", command: "phoenixOps.refresh" }));
  if (openPullRequestsTabFromOpsButton) {
    openPullRequestsTabFromOpsButton.addEventListener("click", () => setActiveWorkspaceTab("pullRequests"));
  }
  if (openActionsTabFromOpsButton) {
    openActionsTabFromOpsButton.addEventListener("click", () => setActiveWorkspaceTab("actions"));
  }
  if (createIssueInIssuesButton) {
    createIssueInIssuesButton.addEventListener("click", () => {
      if (state.forms.issueCreateOpen) {
        closeIssueCreateForm();
        return;
      }
      openIssueCreateForm(selectedIssue()?.repo || state.runtime.workspaceRepo || "");
    });
  }
  if (updateFieldInIssuesButton) updateFieldInIssuesButton.addEventListener("click", () => {
    const selected = selectedIssue();
    if (selected) {
      vscode.postMessage({ type: "issueUpdateField", itemId: selected.itemId });
      return;
    }
    vscode.postMessage({ type: "command", command: "phoenixOps.updateProjectField" });
  });
  if (updateLabelsInIssuesButton) updateLabelsInIssuesButton.addEventListener("click", () => {
    const selected = selectedIssue();
    if (selected) {
      vscode.postMessage({ type: "issueUpdateLabels", itemId: selected.itemId });
      return;
    }
    vscode.postMessage({ type: "command", command: "phoenixOps.updateLabels" });
  });
  if (createPullRequestInPullRequestsButton) {
    createPullRequestInPullRequestsButton.addEventListener("click", () => {
      if (state.forms.pullRequestCreateOpen) {
        closePullRequestCreateForm();
        return;
      }
      openPullRequestCreateForm(selectedPullRequest()?.repo || state.runtime.workspaceRepo || "");
    });
  }
  if (issueCreateRepoSelect instanceof HTMLSelectElement) {
    issueCreateRepoSelect.addEventListener("change", () => {
      state.forms.issueCreateDraft.repo = normalizeRepositorySlug(issueCreateRepoSelect.value);
      state.forms.issueCreateStatus = "";
      state.forms.issueCreateMeta.loadedRepo = "";
      state.forms.issueCreateMeta.labels = [];
      requestIssueCreateMetadata(true);
      renderIssueCreateForm();
    });
  }
  if (issueCreateTypeSelect instanceof HTMLSelectElement) {
    issueCreateTypeSelect.addEventListener("change", () => {
      state.forms.issueCreateDraft.type = normalizeIssueCreateType(issueCreateTypeSelect.value);
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateTitleInput instanceof HTMLInputElement) {
    issueCreateTitleInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.title = issueCreateTitleInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateParentLinksInput instanceof HTMLTextAreaElement) {
    issueCreateParentLinksInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.parentLinks = issueCreateParentLinksInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateBaseBranchInput instanceof HTMLInputElement) {
    issueCreateBaseBranchInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.baseBranch = issueCreateBaseBranchInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreatePlannedBranchInput instanceof HTMLInputElement) {
    issueCreatePlannedBranchInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.plannedBranch = issueCreatePlannedBranchInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateBranchReasonInput instanceof HTMLInputElement) {
    issueCreateBranchReasonInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.branchReason = issueCreateBranchReasonInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateLabelSelect instanceof HTMLSelectElement) {
    issueCreateLabelSelect.addEventListener("change", () => {
      state.forms.issueCreateDraft.labels = uniqueNormalizedValues(selectedMultiValues(issueCreateLabelSelect));
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateCustomLabelsInput instanceof HTMLInputElement) {
    issueCreateCustomLabelsInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.customLabels = issueCreateCustomLabelsInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateProblemInput instanceof HTMLTextAreaElement) {
    issueCreateProblemInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.problemStatement = issueCreateProblemInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateScopeInInput instanceof HTMLTextAreaElement) {
    issueCreateScopeInInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.scopeIn = issueCreateScopeInInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateScopeOutInput instanceof HTMLTextAreaElement) {
    issueCreateScopeOutInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.scopeOut = issueCreateScopeOutInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateDoneInput instanceof HTMLTextAreaElement) {
    issueCreateDoneInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.definitionOfDone = issueCreateDoneInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateDependenciesInput instanceof HTMLTextAreaElement) {
    issueCreateDependenciesInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.dependencies = issueCreateDependenciesInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateRisksInput instanceof HTMLTextAreaElement) {
    issueCreateRisksInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.risks = issueCreateRisksInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateValidationInput instanceof HTMLTextAreaElement) {
    issueCreateValidationInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.validationPlan = issueCreateValidationInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateAcceptanceInput instanceof HTMLTextAreaElement) {
    issueCreateAcceptanceInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.acceptanceCriteria = issueCreateAcceptanceInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateArchitectureInput instanceof HTMLTextAreaElement) {
    issueCreateArchitectureInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.architectureImpact = issueCreateArchitectureInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateRolloutInput instanceof HTMLTextAreaElement) {
    issueCreateRolloutInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.rolloutStrategy = issueCreateRolloutInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateTaskChecklistInput instanceof HTMLTextAreaElement) {
    issueCreateTaskChecklistInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.taskChecklist = issueCreateTaskChecklistInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateStatusSelect instanceof HTMLSelectElement) {
    issueCreateStatusSelect.addEventListener("change", () => {
      state.forms.issueCreateDraft.boardStatus = issueCreateStatusSelect.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateWorkModeSelect instanceof HTMLSelectElement) {
    issueCreateWorkModeSelect.addEventListener("change", () => {
      state.forms.issueCreateDraft.boardWorkMode = issueCreateWorkModeSelect.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreatePrioritySelect instanceof HTMLSelectElement) {
    issueCreatePrioritySelect.addEventListener("change", () => {
      state.forms.issueCreateDraft.boardPriority = issueCreatePrioritySelect.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateSizeSelect instanceof HTMLSelectElement) {
    issueCreateSizeSelect.addEventListener("change", () => {
      state.forms.issueCreateDraft.boardSize = issueCreateSizeSelect.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateAreaSelect instanceof HTMLSelectElement) {
    issueCreateAreaSelect.addEventListener("change", () => {
      state.forms.issueCreateDraft.boardArea = issueCreateAreaSelect.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateSuccessMetricsInput instanceof HTMLTextAreaElement) {
    issueCreateSuccessMetricsInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.successMetrics = issueCreateSuccessMetricsInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateSuspectedCauseInput instanceof HTMLTextAreaElement) {
    issueCreateSuspectedCauseInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.suspectedCause = issueCreateSuspectedCauseInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateInvestigationInput instanceof HTMLTextAreaElement) {
    issueCreateInvestigationInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.investigationNotes = issueCreateInvestigationInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateBodyInput instanceof HTMLTextAreaElement) {
    issueCreateBodyInput.addEventListener("input", () => {
      state.forms.issueCreateDraft.body = issueCreateBodyInput.value;
      state.forms.issueCreateStatus = "";
    });
  }
  if (issueCreateAiDraftButton instanceof HTMLButtonElement) {
    issueCreateAiDraftButton.addEventListener("click", () => requestIssueAiAssist("draft"));
  }
  if (issueCreateAiInvestigateButton instanceof HTMLButtonElement) {
    issueCreateAiInvestigateButton.addEventListener("click", () => requestIssueAiAssist("investigate"));
  }
  if (submitIssueCreateButton instanceof HTMLButtonElement) {
    submitIssueCreateButton.addEventListener("click", () => submitIssueCreateForm());
  }
  if (cancelIssueCreateButton instanceof HTMLButtonElement) {
    cancelIssueCreateButton.addEventListener("click", () => closeIssueCreateForm());
  }
  if (pullRequestCreateRepoSelect instanceof HTMLSelectElement) {
    pullRequestCreateRepoSelect.addEventListener("change", () => {
      state.forms.pullRequestCreateDraft.repo = pullRequestCreateRepoSelect.value;
      state.forms.pullRequestCreateStatus = "";
      renderPullRequestCreateForm();
    });
  }
  if (pullRequestCreateTitleInput instanceof HTMLInputElement) {
    pullRequestCreateTitleInput.addEventListener("input", () => {
      state.forms.pullRequestCreateDraft.title = pullRequestCreateTitleInput.value;
      state.forms.pullRequestCreateStatus = "";
    });
  }
  if (pullRequestCreateHeadInput instanceof HTMLInputElement) {
    pullRequestCreateHeadInput.addEventListener("input", () => {
      state.forms.pullRequestCreateDraft.head = pullRequestCreateHeadInput.value;
      state.forms.pullRequestCreateStatus = "";
    });
  }
  if (pullRequestCreateBaseInput instanceof HTMLInputElement) {
    pullRequestCreateBaseInput.addEventListener("input", () => {
      state.forms.pullRequestCreateDraft.base = pullRequestCreateBaseInput.value;
      state.forms.pullRequestCreateStatus = "";
    });
  }
  if (pullRequestCreateBodyInput instanceof HTMLTextAreaElement) {
    pullRequestCreateBodyInput.addEventListener("input", () => {
      state.forms.pullRequestCreateDraft.body = pullRequestCreateBodyInput.value;
      state.forms.pullRequestCreateStatus = "";
    });
  }
  if (pullRequestCreateDraftInput instanceof HTMLInputElement) {
    pullRequestCreateDraftInput.addEventListener("change", () => {
      state.forms.pullRequestCreateDraft.draft = pullRequestCreateDraftInput.checked;
      state.forms.pullRequestCreateStatus = "";
    });
  }
  if (submitPullRequestCreateButton instanceof HTMLButtonElement) {
    submitPullRequestCreateButton.addEventListener("click", () => submitPullRequestCreateForm());
  }
  if (cancelPullRequestCreateButton instanceof HTMLButtonElement) {
    cancelPullRequestCreateButton.addEventListener("click", () => closePullRequestCreateForm());
  }
  if (refreshPullRequestsButton) refreshPullRequestsButton.addEventListener("click", () => vscode.postMessage({ type: "command", command: "phoenixOps.refresh" }));
  if (collapseAllPullRequestsButton) collapseAllPullRequestsButton.addEventListener("click", () => {
    state.pullRequestBucketCollapse.review = true;
    state.pullRequestBucketCollapse.changes = true;
    state.pullRequestBucketCollapse.ready = true;
    renderPullRequests();
  });
  if (expandAllPullRequestsButton) expandAllPullRequestsButton.addEventListener("click", () => {
    state.pullRequestBucketCollapse.review = false;
    state.pullRequestBucketCollapse.changes = false;
    state.pullRequestBucketCollapse.ready = false;
    renderPullRequests();
  });

  if (backgroundModeSelect instanceof HTMLSelectElement) {
    backgroundModeSelect.addEventListener("change", () => {
      state.theme.mode = backgroundModeSelect.value === "solid" ? "solid" : "gradient";
      state.theme.previewColors = null;
      persistUiState();
      renderThemeControls();
    });
  }

  if (colorSchemeSelect instanceof HTMLSelectElement) {
    colorSchemeSelect.addEventListener("change", () => {
      state.theme.schemeKey = colorSchemeSelect.value;
      state.theme.previewColors = null;
      persistUiState();
      renderThemeControls();
    });
  }

  [themeColorOneInput, themeColorTwoInput, themeColorThreeInput].forEach((input) => {
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    input.addEventListener("input", () => {
      const colors = readThemeColorInputs();
      if (!colors) {
        return;
      }
      state.theme.previewColors = colors;
      applyThemeStyles();
    });
  });

  if (saveCustomSchemeButton) {
    saveCustomSchemeButton.addEventListener("click", () => saveCustomScheme());
  }

  if (customSchemeNameInput instanceof HTMLInputElement) {
    customSchemeNameInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      saveCustomScheme();
    });
  }

  if (collapseAllLeftSectionsButton) {
    collapseAllLeftSectionsButton.addEventListener("click", () => {
      state.ui.workspaceControlsOpen = false;
      state.ui.boardSectionOpen = false;
      state.ui.issuesSectionOpen = false;
      state.ui.pullRequestsSectionOpen = false;
      state.ui.actionsSectionOpen = false;
      persistUiState();
      renderLeftSections();
    });
  }

  if (expandAllLeftSectionsButton) {
    expandAllLeftSectionsButton.addEventListener("click", () => {
      state.ui.workspaceControlsOpen = true;
      state.ui.boardSectionOpen = true;
      state.ui.issuesSectionOpen = true;
      state.ui.pullRequestsSectionOpen = true;
      state.ui.actionsSectionOpen = true;
      persistUiState();
      renderLeftSections();
    });
  }

  if (opsSettingsSection instanceof HTMLDetailsElement) {
    opsSettingsSection.addEventListener("toggle", () => {
      state.ui.opsSettingsOpen = opsSettingsSection.open;
      persistUiState();
    });
  }

  if (workspaceControlsSection instanceof HTMLDetailsElement) {
    workspaceControlsSection.addEventListener("toggle", () => {
      state.ui.workspaceControlsOpen = workspaceControlsSection.open;
      persistUiState();
    });
  }

  if (boardSection instanceof HTMLDetailsElement) {
    boardSection.addEventListener("toggle", () => {
      state.ui.boardSectionOpen = boardSection.open;
      persistUiState();
    });
  }
  if (issuesSection instanceof HTMLDetailsElement) {
    issuesSection.addEventListener("toggle", () => {
      state.ui.issuesSectionOpen = issuesSection.open;
      persistUiState();
    });
  }
  if (pullRequestsSection instanceof HTMLDetailsElement) {
    pullRequestsSection.addEventListener("toggle", () => {
      state.ui.pullRequestsSectionOpen = pullRequestsSection.open;
      persistUiState();
    });
  }
  if (actionsSection instanceof HTMLDetailsElement) {
    actionsSection.addEventListener("toggle", () => {
      state.ui.actionsSectionOpen = actionsSection.open;
      persistUiState();
    });
  }

  document.querySelectorAll("[data-workspace-tab]").forEach((node) => {
    node.addEventListener("click", () => {
      const tabKey = node.getAttribute("data-workspace-tab");
      if (!workspaceTabs.includes(tabKey || "")) {
        return;
      }
      setActiveWorkspaceTab(tabKey);
    });
  });

  if (agentSessionsSection instanceof HTMLDetailsElement) {
    agentSessionsSection.addEventListener("toggle", () => {
      state.ui.sessionsSectionOpen = agentSessionsSection.open;
      persistUiState();
    });
  }
  if (agentChatSection instanceof HTMLDetailsElement) {
    agentChatSection.addEventListener("toggle", () => {
      state.ui.chatSectionOpen = agentChatSection.open;
      persistUiState();
    });
  }
  if (agentComposerSection instanceof HTMLDetailsElement) {
    agentComposerSection.addEventListener("toggle", () => {
      state.ui.composerSectionOpen = agentComposerSection.open;
      persistUiState();
    });
  }
  if (toggleContextPickerButton) {
    toggleContextPickerButton.addEventListener("click", () => {
      state.ui.contextPickerOpen = !state.ui.contextPickerOpen;
      persistUiState();
      renderChatComposerLayout();
    });
  }

  [composerTransportSelect, composerModeSelect, composerServiceSelect, composerModelSelect, composerToolSelect, composerMcpToolsSelect].forEach((node) => {
    if (!node) {
      return;
    }
    node.addEventListener("change", () => {
      refreshComposerSelectionState();
      renderChatComposerLayout();
    });
  });
  [composerIssueNumberInput, composerIssueNodeIdInput].forEach((node) => {
    if (!node) {
      return;
    }
    node.addEventListener("input", () => {
      refreshComposerSelectionState();
      renderChatComposerLayout();
    });
  });

  if (stopSessionFromChatButton) {
    stopSessionFromChatButton.addEventListener("click", () => requestStopSession());
  }
  if (stopSessionFromComposerButton) {
    stopSessionFromComposerButton.addEventListener("click", () => requestStopSession());
  }

  if (sendAgentMessageButton) {
    sendAgentMessageButton.addEventListener("click", () => sendMessage());
  }

  const agentMessageInput = byId("agentMessageInput");
  if (agentMessageInput instanceof HTMLTextAreaElement) {
    agentMessageInput.addEventListener("input", () => autoResizeComposerInput());
    agentMessageInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }
      event.preventDefault();
      sendMessage();
    });
  }

  ensureComposeDefaults();
  if (composerTransportSelect instanceof HTMLSelectElement) {
    composerTransportSelect.value = state.compose.transport;
  }
  if (composerModeSelect instanceof HTMLSelectElement) {
    composerModeSelect.value = state.compose.mode;
  }
  if (composerServiceSelect instanceof HTMLSelectElement) {
    composerServiceSelect.value = state.compose.service;
  }
  if (composerModelSelect instanceof HTMLSelectElement) {
    composerModelSelect.value = state.compose.model;
  }
  if (composerToolSelect instanceof HTMLSelectElement) {
    composerToolSelect.value = state.compose.tool;
  }
  if (composerMcpToolsSelect instanceof HTMLSelectElement) {
    const selectedMcp = new Set(state.compose.mcpTools);
    Array.from(composerMcpToolsSelect.options).forEach((option) => {
      option.selected = selectedMcp.has(option.value);
    });
  }
  if (composerIssueNumberInput instanceof HTMLInputElement) {
    composerIssueNumberInput.value = state.compose.issueNumber ? String(state.compose.issueNumber) : "";
  }
  if (composerIssueNodeIdInput instanceof HTMLInputElement) {
    composerIssueNodeIdInput.value = String(state.compose.issueNodeId || "");
  }

  if (toggleContextPickerButton) {
    persistUiState();
  }
  autoResizeComposerInput();

  if (collapseAllLanesButton) collapseAllLanesButton.addEventListener("click", () => {
    statusOrder.forEach((status) => {
      state.laneCollapse[status] = true;
    });
    renderBoard();
  });
  if (expandAllLanesButton) expandAllLanesButton.addEventListener("click", () => {
    statusOrder.forEach((status) => {
      state.laneCollapse[status] = false;
    });
    renderBoard();
  });

  if (collapseAllActionsButton) collapseAllActionsButton.addEventListener("click", () => {
    state.actionBucketCollapse.queued = true;
    state.actionBucketCollapse.inProgress = true;
    state.actionBucketCollapse.needsAttention = true;
    renderActions();
  });
  if (expandAllActionsButton) expandAllActionsButton.addEventListener("click", () => {
    state.actionBucketCollapse.queued = false;
    state.actionBucketCollapse.inProgress = false;
    state.actionBucketCollapse.needsAttention = false;
    renderActions();
  });
  if (actionsStackMode) actionsStackMode.addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement) {
      state.actionStackMode = target.value;
      state.actionGroupExpand = {};
      renderActions();
    }
  });

  if (collapseAllSessionsButton) collapseAllSessionsButton.addEventListener("click", () => {
    (state.snapshot?.agents?.sessions || []).forEach((session) => {
      state.sessionCollapse[session.sessionId] = true;
    });
    renderSessions();
  });
  if (expandAllSessionsButton) expandAllSessionsButton.addEventListener("click", () => {
    (state.snapshot?.agents?.sessions || []).forEach((session) => {
      state.sessionCollapse[session.sessionId] = false;
    });
    renderSessions();
  });

  if (showArchivedSessions) showArchivedSessions.addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      state.showArchived = target.checked;
      renderSessions();
    }
  });

  if (addContextFileButton) addContextFileButton.addEventListener("click", () => {
    vscode.postMessage({ type: "contextAddActiveFile" });
    state.ui.contextPickerOpen = false;
    persistUiState();
    renderChatComposerLayout();
  });
  if (addContextSelectionButton) addContextSelectionButton.addEventListener("click", () => {
    vscode.postMessage({ type: "contextAddSelection" });
    state.ui.contextPickerOpen = false;
    persistUiState();
    renderChatComposerLayout();
  });
  if (addContextWorkspaceFileButton) addContextWorkspaceFileButton.addEventListener("click", () => {
    vscode.postMessage({ type: "contextAddWorkspaceFile" });
    state.ui.contextPickerOpen = false;
    persistUiState();
    renderChatComposerLayout();
  });

  ["repoFilter", "laneFilter", "workModeFilter", "assigneeFilter"].forEach((id) => {
    const node = byId(id);
    if (!node) {
      return;
    }
    node.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      if (id === "repoFilter") state.filters.repo = target.value;
      if (id === "laneFilter") state.filters.lane = target.value;
      if (id === "workModeFilter") state.filters.workMode = target.value;
      if (id === "assigneeFilter") state.filters.assignee = target.value;
      render();
    });
  });
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "snapshot") {
    state.snapshot = message.payload;
    syncSelectedSessionFromSnapshot();
    consumeIssueAiAssistResponseFromSnapshot();
    updateFilterOptions(state.snapshot);
    render();
  }
  if (message.type === "status") {
    setStatus(message.payload.text, message.payload.level);
  }
  if (message.type === "auth") {
    state.auth = { ok: Boolean(message.payload?.ok) };
    renderAuth();
    renderJarvisStatus();
  }
  if (message.type === "jarvisState") {
    const payload = message.payload || {};
    state.jarvis.enabled = Boolean(payload.enabled);
    state.jarvis.manualMode = Boolean(payload.manualMode);
    state.jarvis.autoAnnouncements = Boolean(payload.autoAnnouncements);
    state.jarvis.maxAnnouncementsPerHour = Number(payload.maxAnnouncementsPerHour || 12);
    state.jarvis.minSecondsBetweenAnnouncements = Number(payload.minSecondsBetweenAnnouncements || 180);
    state.jarvis.announcementsLastHour = Number(payload.announcementsLastHour || 0);
    state.jarvis.lastReason = typeof payload.lastReason === "string" ? payload.lastReason : null;
    state.jarvis.lastMessage = typeof payload.lastMessage === "string" ? payload.lastMessage : null;
    state.jarvis.chatDegraded = Boolean(payload.chatDegraded);
    state.jarvis.chatFailureKind = typeof payload.chatFailureKind === "string" ? payload.chatFailureKind : null;
    state.jarvis.chatCooldownUntil = typeof payload.chatCooldownUntil === "string" ? payload.chatCooldownUntil : null;
    state.jarvis.speechDegraded = Boolean(payload.speechDegraded);
    state.jarvis.speechFailureKind = typeof payload.speechFailureKind === "string" ? payload.speechFailureKind : null;
    state.jarvis.speechCooldownUntil = typeof payload.speechCooldownUntil === "string" ? payload.speechCooldownUntil : null;
    renderJarvisStatus();
  }
  if (message.type === "jarvisSpeak") {
    handleJarvisSpeak(message.payload || {});
  }
  if (message.type === "runtimeContext") {
    const payload = message.payload || {};
    state.runtime.repositories = Array.isArray(payload.repositories)
      ? payload.repositories.map((entry) => normalizeRepositorySlug(String(entry || ""))).filter((entry) => entry.length > 0)
      : [];
    state.runtime.workspaceRepo = typeof payload.workspaceRepo === "string"
      ? normalizeRepositorySlug(payload.workspaceRepo)
      : null;
    state.runtime.workspaceBranch = typeof payload.workspaceBranch === "string" ? payload.workspaceBranch : null;
    state.runtime.mcpTools = Array.isArray(payload.mcpTools)
      ? payload.mcpTools.map((entry) => String(entry || "").trim()).filter((entry) => entry.length > 0)
      : [];
    state.runtime.modelCatalog = normalizeModelCatalog(payload.modelCatalog);
    const dispatchConfig = payload.dispatchConfig && typeof payload.dispatchConfig === "object" ? payload.dispatchConfig : {};
    state.runtime.dispatchConfig = {
      codexCliPath: typeof dispatchConfig.codexCliPath === "string" && dispatchConfig.codexCliPath.trim()
        ? dispatchConfig.codexCliPath.trim()
        : "codex",
      copilotCliPath: typeof dispatchConfig.copilotCliPath === "string" && dispatchConfig.copilotCliPath.trim()
        ? dispatchConfig.copilotCliPath.trim()
        : "copilot",
      codexDefaultModel: typeof dispatchConfig.codexDefaultModel === "string" && dispatchConfig.codexDefaultModel.trim()
        ? dispatchConfig.codexDefaultModel.trim()
        : null,
      copilotDefaultModel: typeof dispatchConfig.copilotDefaultModel === "string" && dispatchConfig.copilotDefaultModel.trim()
        ? dispatchConfig.copilotDefaultModel.trim()
        : null,
      copilotCloudEnabled: Boolean(dispatchConfig.copilotCloudEnabled)
    };
    ensureComposeDefaults();
    persistUiState();
    if (!state.forms.issueCreateDraft.repo && state.runtime.workspaceRepo) {
      state.forms.issueCreateDraft.repo = normalizeRepositorySlug(state.runtime.workspaceRepo);
    }
    if (state.runtime.workspaceBranch && !state.forms.issueCreateDraft.baseBranch) {
      state.forms.issueCreateDraft.baseBranch = state.runtime.workspaceBranch;
    }
    if (!state.forms.pullRequestCreateDraft.head && state.runtime.workspaceBranch) {
      state.forms.pullRequestCreateDraft.head = state.runtime.workspaceBranch;
    }
    if (state.forms.issueCreateOpen) {
      requestIssueCreateMetadata();
    }
    renderChatComposerLayout();
    renderIssueCreateForm();
    renderPullRequestCreateForm();
  }
  if (message.type === "uiAction") {
    const payload = message.payload || {};
    const tab = typeof payload.tab === "string" ? payload.tab : "";
    if (workspaceTabs.includes(tab)) {
      setActiveWorkspaceTab(tab);
    }
    if (payload.openIssueCreate) {
      openIssueCreateForm(typeof payload.preferredRepo === "string" ? payload.preferredRepo : state.runtime.workspaceRepo || "");
    }
    if (payload.openPullRequestCreate) {
      openPullRequestCreateForm(typeof payload.preferredRepo === "string" ? payload.preferredRepo : state.runtime.workspaceRepo || "");
    }
    if (state.snapshot) {
      render();
    }
  }
  if (message.type === "issueCreateMetadata") {
    const payload = message.payload || {};
    state.forms.issueCreateMeta.loading = false;
    state.forms.issueCreateMeta.repo = normalizeRepositorySlug(payload.repo || state.forms.issueCreateMeta.repo || "");
    state.forms.issueCreateMeta.loadedRepo = state.forms.issueCreateMeta.repo;
    state.forms.issueCreateMeta.error = typeof payload.error === "string" ? payload.error : "";
    state.forms.issueCreateMeta.labels = uniqueNormalizedValues(payload.labels);
    state.forms.issueCreateMeta.fieldOptions = normalizeIssueCreateFieldOptions(payload.fieldOptions);

    if (payload.defaults && typeof payload.defaults === "object") {
      const defaultBaseBranch = typeof payload.defaults.baseBranch === "string" ? payload.defaults.baseBranch.trim() : "";
      if (defaultBaseBranch && !state.forms.issueCreateDraft.baseBranch) {
        state.forms.issueCreateDraft.baseBranch = defaultBaseBranch;
      }
      const defaultPlannedBranch = typeof payload.defaults.plannedBranch === "string" ? payload.defaults.plannedBranch.trim() : "";
      if (defaultPlannedBranch && !state.forms.issueCreateDraft.plannedBranch) {
        state.forms.issueCreateDraft.plannedBranch = defaultPlannedBranch;
      }
    }

    issueCreateFieldKeys.forEach((key) => {
      const draftKey = issueCreateFieldDraftKey(key);
      const current = String(state.forms.issueCreateDraft[draftKey] || "").trim();
      const options = state.forms.issueCreateMeta.fieldOptions[key] || [];
      if (!current && options.length > 0) {
        state.forms.issueCreateDraft[draftKey] = options[0];
      }
    });
    renderIssueCreateForm();
  }
  if (message.type === "issueCreateResult") {
    const payload = message.payload || {};
    state.forms.issueCreateBusy = false;
    if (payload.ok) {
      state.forms.issueCreateStatus = typeof payload.message === "string" ? payload.message : "Issue created.";
      const preservedRepo = typeof payload.repo === "string"
        ? normalizeRepositorySlug(payload.repo)
        : normalizeRepositorySlug(state.forms.issueCreateDraft.repo);
      const preservedType = normalizeIssueCreateType(state.forms.issueCreateDraft.type);
      const preservedBaseBranch = String(state.forms.issueCreateDraft.baseBranch || "").trim() || "main";
      const preservedBoardStatus = state.forms.issueCreateDraft.boardStatus;
      const preservedBoardWorkMode = state.forms.issueCreateDraft.boardWorkMode;
      const preservedBoardPriority = state.forms.issueCreateDraft.boardPriority;
      const preservedBoardSize = state.forms.issueCreateDraft.boardSize;
      const preservedBoardArea = state.forms.issueCreateDraft.boardArea;
      state.forms.issueCreateDraft = {
        ...createDefaultIssueCreateDraft(),
        repo: preservedRepo,
        type: preservedType,
        baseBranch: preservedBaseBranch,
        boardStatus: preservedBoardStatus,
        boardWorkMode: preservedBoardWorkMode,
        boardPriority: preservedBoardPriority,
        boardSize: preservedBoardSize,
        boardArea: preservedBoardArea
      };
      state.forms.issueCreateAiAssist.busy = false;
      state.forms.issueCreateAiAssist.pendingRequestId = null;
      state.forms.issueCreateAiAssist.pendingMode = null;
      state.forms.issueCreateAiAssist.status = "";
      if (typeof payload.repo === "string") {
        state.forms.issueCreateDraft.repo = normalizeRepositorySlug(payload.repo);
      }
      requestIssueCreateMetadata(true);
    } else {
      state.forms.issueCreateStatus = typeof payload.message === "string" ? payload.message : "Issue creation failed.";
    }
    renderIssueCreateForm();
  }
  if (message.type === "pullRequestCreateResult") {
    const payload = message.payload || {};
    state.forms.pullRequestCreateBusy = false;
    if (payload.ok) {
      state.forms.pullRequestCreateStatus = typeof payload.message === "string" ? payload.message : "Pull request created.";
      state.forms.pullRequestCreateDraft.title = "";
      state.forms.pullRequestCreateDraft.body = "";
      if (typeof payload.repo === "string") {
        state.forms.pullRequestCreateDraft.repo = normalizeRepositorySlug(payload.repo);
      }
      if (state.runtime.workspaceBranch) {
        state.forms.pullRequestCreateDraft.head = state.runtime.workspaceBranch;
      }
    } else {
      state.forms.pullRequestCreateStatus = typeof payload.message === "string" ? payload.message : "Pull request creation failed.";
    }
    renderPullRequestCreateForm();
  }
  if (message.type === "pullRequestCommentResult") {
    const payload = message.payload || {};
    state.forms.pullRequestCommentBusy = false;
    if (payload.ok) {
      state.forms.pullRequestCommentDraft = "";
      state.forms.pullRequestCommentStatus = typeof payload.message === "string" ? payload.message : "Comment posted.";
      const selected = selectedPullRequest();
      if (selected) {
        requestPullRequestInsights(selected, true);
      }
    } else {
      state.forms.pullRequestCommentStatus = typeof payload.message === "string" ? payload.message : "Failed to post comment.";
    }
    renderPullRequestCommentPanel();
  }
  if (message.type === "pullRequestInsights") {
    const payload = message.payload || {};
    const repo = String(payload.repo || "").trim();
    const number = Number(payload.number || 0);
    if (repo && Number.isFinite(number) && number > 0) {
      const key = `${repo}#${number}`;
      state.pullRequestInsightsCache[key] = {
        repo,
        number,
        reviews: Array.isArray(payload.reviews) ? payload.reviews : [],
        comments: Array.isArray(payload.comments) ? payload.comments : [],
        fetchedAt: typeof payload.fetchedAt === "string" ? payload.fetchedAt : new Date().toISOString(),
        error: typeof payload.error === "string" ? payload.error : null
      };
      if (state.pullRequestInsightsLoading === key) {
        state.pullRequestInsightsLoading = null;
      }
      renderPullRequestInsights();
    }
  }
  if (message.type === "actionRunLog") {
    const payload = message.payload || {};
    const repo = String(payload.repo || "").trim();
    const runId = Number(payload.runId || 0);
    if (repo && Number.isFinite(runId) && runId > 0) {
      const key = `${repo}#${runId}`;
      state.actionRunLogCache[key] = {
        repo,
        runId,
        text: typeof payload.text === "string" ? payload.text : "",
        truncated: Boolean(payload.truncated),
        fetchedAt: typeof payload.fetchedAt === "string" ? payload.fetchedAt : new Date().toISOString(),
        error: typeof payload.error === "string" ? payload.error : null
      };
      if (state.actionRunLogLoading === key) {
        state.actionRunLogLoading = null;
      }
      renderActionRunInsight();
    }
  }
  if (message.type === "contextAdded") {
    const normalized = normalizeContextItem(message.payload);
    if (normalized) {
      const exists = state.contextItems.some((item) => item.id === normalized.id);
      if (!exists) {
        state.contextItems.push(normalized);
        if (state.contextItems.length > 12) {
          state.contextItems = state.contextItems.slice(state.contextItems.length - 12);
        }
      }
      persistUiState();
      renderContextChips();
    }
  }
  if (message.type === "contextError") {
    const text = String(message.payload?.message || "Failed to add context.");
    window.alert(text);
  }
});

bindEvents();
window.addEventListener("beforeunload", () => {
  stopWakeWordListening();
  disposeJarvisAudioPlayback();
});
renderThemeControls();
renderTopbarSections();
renderLeftSections();
renderWorkspaceTabs();
renderAgentLayout();
renderChatComposerLayout();
renderJarvisStatus();
renderContextChips();
renderChatTimeline();
vscode.postMessage({ type: "ready" });
