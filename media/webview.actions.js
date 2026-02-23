function runBuckets() {
  const runs = state.snapshot?.actions?.runs || [];
  return {
    queued: runs.filter((run) => run.status === "queued"),
    inProgress: runs.filter((run) => run.status === "in_progress"),
    needsAttention: runs.filter((run) => ["failure", "cancelled", "action_required", "timed_out"].includes((run.conclusion || "").toLowerCase()))
  };
}

function runUpdatedMs(run) {
  return parseMs(run.updatedAt) || parseMs(run.createdAt) || 0;
}

function actionGroupKey(run, mode) {
  if (mode === "none") {
    return `run:${run.id}`;
  }
  if (mode === "repo") {
    return `repo:${run.repo || "unknown"}`;
  }
  if (mode === "repo-branch") {
    return `repo:${run.repo || "unknown"}|branch:${run.headBranch || "(no branch)"}`;
  }
  return `repo:${run.repo || "unknown"}|branch:${run.headBranch || "(no branch)"}|workflow:${run.workflowName || run.name || "Workflow"}`;
}

function actionGroupLabel(run, mode) {
  if (mode === "none") {
    return run.workflowName || run.name || "Workflow";
  }
  if (mode === "repo") {
    return run.repo || "unknown";
  }
  if (mode === "repo-branch") {
    return `${run.repo || "unknown"} | ${run.headBranch || "(no branch)"}`;
  }
  return `${run.workflowName || run.name || "Workflow"} | ${run.headBranch || "(no branch)"}`;
}

function buildActionGroups(runs, mode) {
  const sorted = [...runs].sort((a, b) => runUpdatedMs(b) - runUpdatedMs(a));
  const groups = new Map();
  sorted.forEach((run) => {
    const key = actionGroupKey(run, mode);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: actionGroupLabel(run, mode),
        runs: [],
        latestRun: run
      });
    }
    const group = groups.get(key);
    group.runs.push(run);
    if (runUpdatedMs(run) > runUpdatedMs(group.latestRun)) {
      group.latestRun = run;
    }
  });
  return Array.from(groups.values()).sort((a, b) => runUpdatedMs(b.latestRun) - runUpdatedMs(a.latestRun));
}

function openRun(url) {
  if (!url) {
    return;
  }
  vscode.postMessage({ type: "openRun", url });
}

function jobsForRun(runId) {
  return (state.snapshot?.actions?.jobs || [])
    .filter((job) => job.runId === runId)
    .sort((a, b) => {
      const aNeeds = ["failure", "cancelled", "action_required", "timed_out"].includes((a.conclusion || "").toLowerCase()) || a.status === "in_progress";
      const bNeeds = ["failure", "cancelled", "action_required", "timed_out"].includes((b.conclusion || "").toLowerCase()) || b.status === "in_progress";
      if (aNeeds === bNeeds) {
        return a.jobName.localeCompare(b.jobName);
      }
      return aNeeds ? -1 : 1;
    });
}

function renderJobsSummary(root, runId) {
  const jobs = jobsForRun(runId)
    .filter((job) => job.status === "in_progress" || ["failure", "cancelled", "action_required", "timed_out"].includes((job.conclusion || "").toLowerCase()))
    .slice(0, 5);
  if (!jobs.length) {
    return;
  }
  const summary = document.createElement("div");
  summary.className = "meta-line secondary";
  summary.textContent = `Jobs needing attention (${jobs.length})`;
  root.appendChild(summary);

  jobs.forEach((job) => {
    const line = document.createElement("div");
    line.className = "feed-inline";
    const steps = Array.isArray(job.failedSteps) && job.failedSteps.length > 0
      ? ` | steps: ${job.failedSteps.slice(0, 3).join(", ")}`
      : "";
    line.textContent = `${job.jobName} | ${job.status}${job.conclusion ? `/${job.conclusion}` : ""}${steps}`;
    root.appendChild(line);
  });
}

function renderRunEntries(root, runs) {
  const list = document.createElement("div");
  list.className = "action-run-list";
  runs.slice(0, 6).forEach((run) => {
    const row = document.createElement("div");
    row.className = "action-run-row";
    const text = document.createElement("div");
    text.className = "meta-line";
    text.textContent = `${run.workflowName || run.name || "Workflow"} | ${run.status}${run.conclusion ? `/${run.conclusion}` : ""} | ${formatAge(run.updatedAt)}`;
    row.appendChild(text);

    const controls = document.createElement("div");
    controls.className = "inline-actions";
    const select = document.createElement("button");
    select.className = "lane-action";
    select.type = "button";
    select.textContent = "Details";
    select.onclick = () => {
      state.selected = { kind: "run", id: run.id };
      renderActionRunInsight();
    };
    controls.appendChild(select);
    const open = document.createElement("button");
    open.className = "lane-action";
    open.type = "button";
    open.textContent = "Open";
    open.onclick = () => openRun(run.url);
    controls.appendChild(open);
    row.appendChild(controls);
    list.appendChild(row);
  });
  root.appendChild(list);
}

function renderRunColumn(targetId, bucketKey, heading, runs) {
  const root = byId(targetId);
  root.innerHTML = "";
  const lane = document.createElement("section");
  lane.className = "lane";
  const groups = buildActionGroups(runs, state.actionStackMode);
  const collapsed = Boolean(state.actionBucketCollapse[bucketKey]);

  const header = document.createElement("div");
  header.className = "lane-header";
  const left = document.createElement("div");
  left.className = "lane-title-wrap";
  const toggle = document.createElement("button");
  toggle.className = "lane-toggle";
  toggle.type = "button";
  toggle.textContent = collapsed ? ">" : "v";
  toggle.onclick = () => {
    state.actionBucketCollapse[bucketKey] = !collapsed;
    renderActions();
  };
  left.appendChild(toggle);
  const title = document.createElement("div");
  title.className = "lane-title";
  title.textContent = `${heading} (${groups.length})`;
  left.appendChild(title);
  header.appendChild(left);
  lane.appendChild(header);

  const bucketMeta = document.createElement("div");
  bucketMeta.className = "meta-line";
  bucketMeta.textContent = state.actionStackMode === "none"
    ? `${runs.length} runs`
    : `${groups.length} groups | ${runs.length} runs`;
  lane.appendChild(bucketMeta);

  if (!groups.length) {
    lane.appendChild(emptyText("No runs"));
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
  groups.slice(0, 30).forEach((group) => {
    const latest = group.latestRun;
    const groupExpandKey = `${bucketKey}:${group.key}`;
    const expanded = Boolean(state.actionGroupExpand[groupExpandKey]);
    const card = document.createElement("section");
    card.className = "card action-card";
    if (state.selected?.kind === "run" && group.runs.some((run) => run.id === state.selected.id)) {
      card.classList.add("selected");
    }

    const head = document.createElement("div");
    head.className = "session-head";
    const text = document.createElement("div");
    text.className = "title";
    text.textContent = `${group.label}${group.runs.length > 1 ? ` (${group.runs.length})` : ""}`;
    head.appendChild(text);

    const rowActions = document.createElement("div");
    rowActions.className = "inline-actions";
    const select = document.createElement("button");
    select.className = "lane-action";
    select.type = "button";
    select.textContent = "Details";
    select.onclick = () => {
      state.selected = { kind: "run", id: latest.id };
      renderActionRunInsight();
    };
    rowActions.appendChild(select);
    const open = document.createElement("button");
    open.className = "lane-action";
    open.type = "button";
    open.textContent = "Open";
    open.onclick = () => openRun(latest.url);
    rowActions.appendChild(open);
    const expand = document.createElement("button");
    expand.className = "lane-action";
    expand.type = "button";
    expand.textContent = expanded ? "Less" : "More";
    expand.onclick = () => {
      state.actionGroupExpand[groupExpandKey] = !expanded;
      renderActions();
    };
    rowActions.appendChild(expand);
    head.appendChild(rowActions);
    card.appendChild(head);

    const meta = document.createElement("div");
    meta.className = "meta-line";
    meta.textContent = `${latest.repo} | ${latest.status}${latest.conclusion ? `/${latest.conclusion}` : ""} | ${formatAge(latest.updatedAt)}`;
    card.appendChild(meta);

    if (!expanded) {
      if (group.runs.length > 1) {
        const stack = document.createElement("div");
        stack.className = "meta-line secondary";
        stack.textContent = `Stacked runs: ${group.runs.length}`;
        card.appendChild(stack);
      }
      cards.appendChild(card);
      return;
    }

    const limited = document.createElement("div");
    limited.className = "meta-line secondary";
    limited.textContent = `Branch: ${latest.headBranch || "(no branch)"} | Event: ${latest.event || "(unknown)"} | Updated: ${formatTime(latest.updatedAt)}`;
    card.appendChild(limited);

    renderJobsSummary(card, latest.id);

    if (group.runs.length > 1) {
      const stackedHeading = document.createElement("div");
      stackedHeading.className = "meta-line secondary";
      stackedHeading.textContent = "Stack contents";
      card.appendChild(stackedHeading);
      renderRunEntries(card, group.runs);
    }

    cards.appendChild(card);
  });
  lane.appendChild(cards);
  root.appendChild(lane);
}

function renderActions() {
  const stackModeEl = byId("actionsStackMode");
  if (stackModeEl instanceof HTMLSelectElement) {
    stackModeEl.value = state.actionStackMode;
  }
  const buckets = runBuckets();
  const runs = state.snapshot?.actions?.runs || [];
  const counts = byId("actionsCounts");
  const summaryCounts = byId("actionsCountsSummary");
  if (counts) {
    counts.textContent = `Runs ${runs.length} | Stack mode: ${state.actionStackMode}`;
  }
  if (summaryCounts) {
    summaryCounts.textContent = `${runs.length} runs`;
  }
  renderRunColumn("actionsQueued", "queued", "Queued", buckets.queued);
  renderRunColumn("actionsInProgress", "inProgress", "In Progress", buckets.inProgress);
  renderRunColumn("actionsNeedsAttention", "needsAttention", "Needs Attention", buckets.needsAttention);
  renderActionRunInsight();
}

function actionRunInsightKey(run) {
  return `${run.repo}#${run.id}`;
}

function requestActionRunLog(run, force = false) {
  const key = actionRunInsightKey(run);
  if (state.actionRunLogLoading === key) {
    return;
  }
  if (!force && state.actionRunLogCache[key] && !state.actionRunLogCache[key].error) {
    return;
  }
  state.actionRunLogLoading = key;
  renderActionRunInsight();
  vscode.postMessage({ type: "fetchActionRunLog", repo: run.repo, runId: run.id });
}

function renderActionRunInsight() {
  const root = byId("actionRunInsightPanel");
  if (!root) {
    return;
  }
  root.innerHTML = "";
  const run = selectedRun();
  if (!run) {
    root.appendChild(emptyText("Select a workflow run from the Actions lanes to inspect logs and retry options."));
    return;
  }

  const key = actionRunInsightKey(run);
  const cached = state.actionRunLogCache[key] || null;

  root.appendChild(textLine(`${run.repo} | ${run.workflowName || run.name || "Workflow"}`, "detail-title"));
  root.appendChild(textLine(`Run #${run.number} | ${run.status}${run.conclusion ? `/${run.conclusion}` : ""} | Updated ${formatAge(run.updatedAt)}`, "meta-line"));

  const controls = document.createElement("div");
  controls.className = "inline-actions";

  const open = document.createElement("button");
  open.type = "button";
  open.className = "lane-action";
  open.textContent = "Open";
  open.onclick = () => openRun(run.url);
  controls.appendChild(open);

  const loadLogs = document.createElement("button");
  loadLogs.type = "button";
  loadLogs.className = "lane-action";
  loadLogs.textContent = state.actionRunLogLoading === key ? "Loading..." : (cached ? "Refresh Logs" : "Load Logs");
  loadLogs.disabled = state.actionRunLogLoading === key;
  loadLogs.onclick = () => requestActionRunLog(run, true);
  controls.appendChild(loadLogs);

  const retryFailed = document.createElement("button");
  retryFailed.type = "button";
  retryFailed.className = "lane-action";
  retryFailed.textContent = "Retry Failed";
  retryFailed.onclick = () => vscode.postMessage({ type: "retryActionRun", repo: run.repo, runId: run.id, failedOnly: true });
  controls.appendChild(retryFailed);

  const retryAll = document.createElement("button");
  retryAll.type = "button";
  retryAll.className = "lane-action";
  retryAll.textContent = "Retry All";
  retryAll.onclick = () => vscode.postMessage({ type: "retryActionRun", repo: run.repo, runId: run.id, failedOnly: false });
  controls.appendChild(retryAll);

  root.appendChild(controls);

  if (state.actionRunLogLoading === key && !cached) {
    root.appendChild(emptyText("Fetching run logs..."));
    return;
  }

  if (cached?.error) {
    root.appendChild(textLine(`Log fetch failed: ${cached.error}`, "meta-line secondary"));
    return;
  }

  if (!cached?.text) {
    root.appendChild(emptyText("Logs are not loaded yet."));
    return;
  }

  const info = document.createElement("div");
  info.className = "meta-line secondary";
  info.textContent = `Log captured ${formatTime(cached.fetchedAt)}${cached.truncated ? " | truncated" : ""}`;
  root.appendChild(info);

  const pre = document.createElement("pre");
  pre.className = "log-output";
  pre.textContent = cached.text;
  root.appendChild(pre);
}

function renderOpsPullRequestOverviewLane(targetId, heading, entries) {
  const root = byId(targetId);
  if (!root) {
    return;
  }
  root.innerHTML = "";

  const lane = document.createElement("section");
  lane.className = "lane";
  lane.appendChild(textLine(`${heading} (${entries.length})`, "lane-title"));

  if (!entries.length) {
    lane.appendChild(emptyText("No pull requests"));
    root.appendChild(lane);
    return;
  }

  const cards = document.createElement("div");
  cards.className = "lane-cards";
  entries.slice(0, 8).forEach((entry) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    if (state.selected?.kind === "pullRequest" && state.selected.id === entry.id) {
      card.classList.add("selected");
    }
    card.onclick = () => {
      state.selected = { kind: "pullRequest", id: entry.id };
      setActiveWorkspaceTab("pullRequests");
      requestPullRequestInsights(entry, false);
      render();
    };
    card.appendChild(textLine(`#${entry.number} ${entry.title}`, "title"));
    card.appendChild(textLine(`${entry.repo} | ${entry.reviewState}`, "meta-line"));
    card.appendChild(textLine(`Updated ${formatAge(entry.updatedAt)}`, "meta-line secondary"));
    cards.appendChild(card);
  });
  lane.appendChild(cards);
  root.appendChild(lane);
}

function renderOpsActionOverviewLane(targetId, heading, entries) {
  const root = byId(targetId);
  if (!root) {
    return;
  }
  root.innerHTML = "";

  const lane = document.createElement("section");
  lane.className = "lane";
  lane.appendChild(textLine(`${heading} (${entries.length})`, "lane-title"));

  if (!entries.length) {
    lane.appendChild(emptyText("No workflow runs"));
    root.appendChild(lane);
    return;
  }

  const cards = document.createElement("div");
  cards.className = "lane-cards";
  entries.slice(0, 8).forEach((entry) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    if (state.selected?.kind === "run" && state.selected.id === entry.id) {
      card.classList.add("selected");
    }
    card.onclick = () => {
      state.selected = { kind: "run", id: entry.id };
      setActiveWorkspaceTab("actions");
      render();
    };
    card.appendChild(textLine(entry.workflowName || entry.name || "Workflow", "title"));
    card.appendChild(textLine(`${entry.repo} | ${entry.status}${entry.conclusion ? `/${entry.conclusion}` : ""}`, "meta-line"));
    card.appendChild(textLine(`${entry.headBranch || "(no branch)"} | Updated ${formatAge(entry.updatedAt)}`, "meta-line secondary"));
    cards.appendChild(card);
  });
  lane.appendChild(cards);
  root.appendChild(lane);
}

function renderOpsOverviews() {
  const pullRequests = filteredPullRequests();
  const pullBuckets = pullRequestBuckets();
  const pullRequestCounts = byId("opsPullRequestCounts");
  if (pullRequestCounts) {
    pullRequestCounts.textContent = `PRs ${pullRequests.length} | Review ${pullBuckets.review.length} | Changes ${pullBuckets.changes.length} | Ready ${pullBuckets.ready.length}`;
  }
  renderOpsPullRequestOverviewLane("opsPullRequestsReview", "Review Required", pullBuckets.review);
  renderOpsPullRequestOverviewLane("opsPullRequestsChanges", "Changes Requested", pullBuckets.changes);
  renderOpsPullRequestOverviewLane("opsPullRequestsReady", "Approved / Ready", pullBuckets.ready);

  const actionRuns = state.snapshot?.actions?.runs || [];
  const actionBuckets = runBuckets();
  const actionCounts = byId("opsActionCounts");
  if (actionCounts) {
    actionCounts.textContent = `Runs ${actionRuns.length} | Queued ${actionBuckets.queued.length} | In Progress ${actionBuckets.inProgress.length} | Needs Attention ${actionBuckets.needsAttention.length}`;
  }
  renderOpsActionOverviewLane("opsActionsQueued", "Queued", actionBuckets.queued);
  renderOpsActionOverviewLane("opsActionsInProgress", "In Progress", actionBuckets.inProgress);
  renderOpsActionOverviewLane("opsActionsNeedsAttention", "Needs Attention", actionBuckets.needsAttention);
}

