function isQueuedStatus(status) {
  const lowered = (status || "").toLowerCase();
  return lowered === "queued" || lowered === "waiting" || lowered === "pending" || lowered === "requested";
}

function runBuckets() {
  const runs = state.snapshot?.actions?.runs || [];
  return {
    queued: runs.filter((run) => isQueuedStatus(run.status)),
    inProgress: runs.filter((run) => (run.status || "").toLowerCase() === "in_progress"),
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
  const groups = buildActionGroups(runs, state.actionStackMode);
  const collapsed = Boolean(state.actionBucketCollapse[bucketKey]);

  const bucket = document.createElement("div");
  bucket.className = "ops-bucket";

  const headingEl = document.createElement("div");
  headingEl.className = "ops-bucket-heading";

  const toggle = document.createElement("button");
  toggle.className = "ops-bucket-heading-toggle";
  toggle.type = "button";
  toggle.textContent = collapsed ? "›" : "⌄";
  toggle.title = collapsed ? "Expand" : "Collapse";
  toggle.onclick = () => {
    state.actionBucketCollapse[bucketKey] = !collapsed;
    renderActions();
  };
  headingEl.appendChild(toggle);

  const headText = document.createElement("span");
  headText.textContent = `${heading} (${groups.length})`;
  headingEl.appendChild(headText);
  if (groups.length > 0 && !collapsed) {
    const runCountBadge = document.createElement("span");
    runCountBadge.className = "ops-item-badge";
    runCountBadge.style.marginLeft = "4px";
    runCountBadge.textContent = `${runs.length} runs`;
    headingEl.appendChild(runCountBadge);
  }
  bucket.appendChild(headingEl);

  if (!groups.length) {
    bucket.appendChild(emptyText("No runs"));
    root.appendChild(bucket);
    return;
  }

  if (collapsed) {
    root.appendChild(bucket);
    return;
  }

  const list = document.createElement("div");
  list.className = "ops-item-list";
  groups.slice(0, 30).forEach((group) => {
    const latest = group.latestRun;
    const groupExpandKey = `${bucketKey}:${group.key}`;
    const expanded = Boolean(state.actionGroupExpand[groupExpandKey]);

    const row = document.createElement("div");
    row.className = "ops-item-row";
    if (state.selected?.kind === "run" && group.runs.some((run) => run.id === state.selected.id)) {
      row.classList.add("selected");
    }
    row.onclick = (e) => {
      if (e.target.closest(".ops-item-actions")) return;
      state.selected = { kind: "run", id: latest.id };
      renderActionRunInsight();
    };

    const rowHeader = document.createElement("div");
    rowHeader.className = "ops-item-header";

    const dot = document.createElement("span");
    dot.className = `ops-item-dot ${opsDotClassForRunConclusion(latest)}`;
    rowHeader.appendChild(dot);

    const titleWrap = document.createElement("div");
    titleWrap.className = "ops-item-title-wrap";
    const name = document.createElement("span");
    name.className = "ops-item-name";
    name.textContent = `${group.label}${group.runs.length > 1 ? ` (${group.runs.length})` : ""}`;
    titleWrap.appendChild(name);
    const badge = document.createElement("span");
    badge.className = "ops-item-badge";
    badge.textContent = latest.repo;
    titleWrap.appendChild(badge);
    rowHeader.appendChild(titleWrap);

    const actions = document.createElement("div");
    actions.className = "ops-item-actions";

    const details = document.createElement("button");
    details.className = "ops-item-btn";
    details.type = "button";
    details.textContent = "Details";
    details.onclick = (e) => {
      e.stopPropagation();
      state.selected = { kind: "run", id: latest.id };
      renderActionRunInsight();
    };
    actions.appendChild(details);

    const open = document.createElement("button");
    open.className = "ops-item-btn ops-item-btn--primary";
    open.type = "button";
    open.textContent = "Open";
    open.onclick = (e) => { e.stopPropagation(); openRun(latest.url); };
    actions.appendChild(open);

    const expandBtn = document.createElement("button");
    expandBtn.className = "ops-item-btn";
    expandBtn.type = "button";
    expandBtn.textContent = expanded ? "Less" : "More";
    expandBtn.onclick = (e) => {
      e.stopPropagation();
      state.actionGroupExpand[groupExpandKey] = !expanded;
      renderActions();
    };
    actions.appendChild(expandBtn);
    rowHeader.appendChild(actions);
    row.appendChild(rowHeader);

    const meta = document.createElement("div");
    meta.className = "ops-item-meta";
    meta.textContent = `${latest.status}${latest.conclusion ? `/${latest.conclusion}` : ""} · ${formatAge(latest.updatedAt)}`;
    row.appendChild(meta);

    if (expanded) {
      const detail = document.createElement("div");
      detail.className = "ops-item-detail";
      detail.textContent = `${latest.headBranch || "(no branch)"} · ${latest.event || ""} · ${formatTime(latest.updatedAt)}`;
      row.appendChild(detail);
      renderJobsSummary(row, latest.id);
      if (group.runs.length > 1) {
        renderRunEntries(row, group.runs);
      }
    } else {
      const detail = document.createElement("div");
      detail.className = "ops-item-detail";
      detail.textContent = group.runs.length > 1
        ? `Stacked: ${group.runs.length} · ${latest.headBranch || "(no branch)"}`
        : `${latest.headBranch || "(no branch)"}`;
      row.appendChild(detail);
    }

    list.appendChild(row);
  });
  bucket.appendChild(list);
  root.appendChild(bucket);
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

  const bucket = document.createElement("div");
  bucket.className = "ops-bucket";

  const headingEl = document.createElement("div");
  headingEl.className = "ops-bucket-heading";
  headingEl.textContent = `${heading} (${entries.length})`;
  bucket.appendChild(headingEl);

  if (!entries.length) {
    bucket.appendChild(emptyText("No pull requests"));
    root.appendChild(bucket);
    return;
  }

  const list = document.createElement("div");
  list.className = "ops-item-list";
  entries.slice(0, 8).forEach((entry) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "ops-item-row";
    if (state.selected?.kind === "pullRequest" && state.selected.id === entry.id) {
      row.classList.add("selected");
    }
    row.onclick = () => {
      state.selected = { kind: "pullRequest", id: entry.id };
      setActiveWorkspaceTab("pullRequests");
      requestPullRequestInsights(entry, false);
      render();
    };

    const rowHeader = document.createElement("div");
    rowHeader.className = "ops-item-header";

    const dot = document.createElement("span");
    dot.className = `ops-item-dot ${opsDotClassForPRReviewState(entry.reviewState)}`;
    rowHeader.appendChild(dot);

    const titleWrap = document.createElement("div");
    titleWrap.className = "ops-item-title-wrap";
    const name = document.createElement("span");
    name.className = "ops-item-name";
    name.textContent = `#${entry.number} ${entry.title}`;
    titleWrap.appendChild(name);
    const badge = document.createElement("span");
    badge.className = "ops-item-badge";
    badge.textContent = entry.repo;
    titleWrap.appendChild(badge);
    rowHeader.appendChild(titleWrap);

    const actions = document.createElement("div");
    actions.className = "ops-item-actions";
    if (entry.url) {
      const openBtn = document.createElement("button");
      openBtn.className = "ops-item-btn ops-item-btn--primary";
      openBtn.type = "button";
      openBtn.textContent = "Open";
      openBtn.onclick = (e) => { e.stopPropagation(); vscode.postMessage({ type: "openPullRequest", url: entry.url }); };
      actions.appendChild(openBtn);
    }
    rowHeader.appendChild(actions);
    row.appendChild(rowHeader);

    const meta = document.createElement("div");
    meta.className = "ops-item-meta";
    meta.textContent = `${entry.reviewState} · ${formatAge(entry.updatedAt)}`;
    row.appendChild(meta);

    list.appendChild(row);
  });
  bucket.appendChild(list);
  root.appendChild(bucket);
}

function renderOpsActionOverviewLane(targetId, heading, entries) {
  const root = byId(targetId);
  if (!root) {
    return;
  }
  root.innerHTML = "";

  const bucket = document.createElement("div");
  bucket.className = "ops-bucket";

  const headingEl = document.createElement("div");
  headingEl.className = "ops-bucket-heading";
  headingEl.textContent = `${heading} (${entries.length})`;
  bucket.appendChild(headingEl);

  if (!entries.length) {
    bucket.appendChild(emptyText("No workflow runs"));
    root.appendChild(bucket);
    return;
  }

  const list = document.createElement("div");
  list.className = "ops-item-list";
  entries.slice(0, 8).forEach((entry) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "ops-item-row";
    if (state.selected?.kind === "run" && state.selected.id === entry.id) {
      row.classList.add("selected");
    }
    row.onclick = () => {
      state.selected = { kind: "run", id: entry.id };
      setActiveWorkspaceTab("actions");
      render();
    };

    const rowHeader = document.createElement("div");
    rowHeader.className = "ops-item-header";

    const dot = document.createElement("span");
    dot.className = `ops-item-dot ${opsDotClassForRunConclusion(entry)}`;
    rowHeader.appendChild(dot);

    const titleWrap = document.createElement("div");
    titleWrap.className = "ops-item-title-wrap";
    const name = document.createElement("span");
    name.className = "ops-item-name";
    name.textContent = entry.workflowName || entry.name || "Workflow";
    titleWrap.appendChild(name);
    const badge = document.createElement("span");
    badge.className = "ops-item-badge";
    badge.textContent = entry.repo;
    titleWrap.appendChild(badge);
    rowHeader.appendChild(titleWrap);

    const actions = document.createElement("div");
    actions.className = "ops-item-actions";
    if (entry.url) {
      const openBtn = document.createElement("button");
      openBtn.className = "ops-item-btn ops-item-btn--primary";
      openBtn.type = "button";
      openBtn.textContent = "Open";
      openBtn.onclick = (e) => { e.stopPropagation(); openRun(entry.url); };
      actions.appendChild(openBtn);
    }
    rowHeader.appendChild(actions);
    row.appendChild(rowHeader);

    const meta = document.createElement("div");
    meta.className = "ops-item-meta";
    meta.textContent = `${entry.status}${entry.conclusion ? `/${entry.conclusion}` : ""} · ${entry.headBranch || "(no branch)"} · ${formatAge(entry.updatedAt)}`;
    row.appendChild(meta);

    list.appendChild(row);
  });
  bucket.appendChild(list);
  root.appendChild(bucket);
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

