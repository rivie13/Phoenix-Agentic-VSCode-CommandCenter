function pullRequestBuckets() {
  const pullRequests = filteredPullRequests();
  return {
    review: pullRequests.filter((entry) => entry.reviewState === "review_required" || entry.reviewState === "draft"),
    changes: pullRequests.filter((entry) => entry.reviewState === "changes_requested"),
    ready: pullRequests.filter((entry) => entry.reviewState === "approved")
  };
}

function renderPullRequestColumn(targetId, bucketKey, heading, pullRequests) {
  const root = byId(targetId);
  root.innerHTML = "";
  const lane = document.createElement("section");
  lane.className = "lane";
  const collapsed = Boolean(state.pullRequestBucketCollapse[bucketKey]);

  const header = document.createElement("div");
  header.className = "lane-header";
  const left = document.createElement("div");
  left.className = "lane-title-wrap";
  const toggle = document.createElement("button");
  toggle.className = "lane-toggle";
  toggle.type = "button";
  toggle.textContent = collapsed ? ">" : "v";
  toggle.onclick = () => {
    state.pullRequestBucketCollapse[bucketKey] = !collapsed;
    renderPullRequests();
  };
  left.appendChild(toggle);

  const title = document.createElement("div");
  title.className = "lane-title";
  title.textContent = `${heading} (${pullRequests.length})`;
  left.appendChild(title);
  header.appendChild(left);
  lane.appendChild(header);

  if (!pullRequests.length) {
    lane.appendChild(emptyText("No pull requests"));
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
  pullRequests.slice(0, 40).forEach((entry) => {
    const card = document.createElement("section");
    card.className = "card action-card";
    if (state.selected?.kind === "pullRequest" && state.selected.id === entry.id) {
      card.classList.add("selected");
    }

    const head = document.createElement("div");
    head.className = "session-head";
    const text = document.createElement("div");
    text.className = "title";
    text.textContent = `#${entry.number} ${entry.title}`;
    head.appendChild(text);

    const controls = document.createElement("div");
    controls.className = "inline-actions";

    const details = document.createElement("button");
    details.className = "lane-action";
    details.type = "button";
    details.textContent = "Details";
    details.onclick = () => {
      state.selected = { kind: "pullRequest", id: entry.id };
      requestPullRequestInsights(entry, false);
      renderPullRequestInsights();
      renderPullRequestCommentPanel();
    };
    controls.appendChild(details);

    const open = document.createElement("button");
    open.className = "lane-action";
    open.type = "button";
    open.textContent = "Open";
    open.onclick = () => vscode.postMessage({ type: "openPullRequest", url: entry.url });
    controls.appendChild(open);

    head.appendChild(controls);
    card.appendChild(head);

    const meta = document.createElement("div");
    meta.className = "meta-line";
    meta.textContent = `${entry.repo} | ${entry.headBranch || "(head)"} -> ${entry.baseBranch || "(base)"} | ${entry.reviewState}`;
    card.appendChild(meta);
    const sub = document.createElement("div");
    sub.className = "meta-line secondary";
    sub.textContent = `${entry.isDraft ? "Draft | " : ""}Updated ${formatAge(entry.updatedAt)} | Author ${entry.author || "(unknown)"}`;
    card.appendChild(sub);

    cards.appendChild(card);
  });

  lane.appendChild(cards);
  root.appendChild(lane);
}

function renderPullRequests() {
  const counts = byId("pullRequestCounts");
  const summaryCounts = byId("pullRequestCountsSummary");
  const pullRequests = filteredPullRequests();
  const buckets = pullRequestBuckets();
  if (counts) {
    counts.textContent = `PRs ${pullRequests.length} | Review ${buckets.review.length} | Changes ${buckets.changes.length} | Ready ${buckets.ready.length}`;
  }
  if (summaryCounts) {
    summaryCounts.textContent = `${pullRequests.length} total`;
  }
  renderPullRequestColumn("pullRequestsReview", "review", "Review Required", buckets.review);
  renderPullRequestColumn("pullRequestsChanges", "changes", "Changes Requested", buckets.changes);
  renderPullRequestColumn("pullRequestsReady", "ready", "Approved / Ready", buckets.ready);
  const selected = selectedPullRequest();
  if (selected) {
    requestPullRequestInsights(selected, false);
  }
  renderPullRequestInsights();
}

function pullRequestInsightKey(pullRequest) {
  return `${pullRequest.repo}#${pullRequest.number}`;
}

function requestPullRequestInsights(pullRequest, force = false) {
  const key = pullRequestInsightKey(pullRequest);
  if (state.pullRequestInsightsLoading === key) {
    return;
  }
  if (!force && state.pullRequestInsightsCache[key] && !state.pullRequestInsightsCache[key].error) {
    return;
  }
  state.pullRequestInsightsLoading = key;
  renderPullRequestInsights();
  vscode.postMessage({ type: "fetchPullRequestInsights", repo: pullRequest.repo, number: pullRequest.number });
}

function insightRowsForDisplay(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter((entry) => entry && typeof entry.body === "string" && entry.body.trim().length > 0)
    .slice(0, 24);
}

function appendInsightRows(container, title, rows) {
  if (!rows.length) {
    return;
  }
  container.appendChild(textLine(title, "lane-title"));
  rows.slice(0, 8).forEach((row) => {
    const card = document.createElement("div");
    card.className = "feed-inline";
    const stateSuffix = row.state ? ` | ${row.state}` : "";
    const pathSuffix = row.path ? ` | ${row.path}${row.line ? `:${row.line}` : ""}` : "";
    card.appendChild(textLine(`${row.author || "unknown"}${stateSuffix}${pathSuffix}`, "meta-line"));
    card.appendChild(textLine(row.body, "feed-text"));
    if (row.createdAt || row.updatedAt) {
      card.appendChild(textLine(`Updated ${formatAge(row.updatedAt || row.createdAt)}${row.url ? " | Open in GitHub from PR page" : ""}`, "meta-line secondary"));
    }
    container.appendChild(card);
  });
}

function renderPullRequestInsights() {
  const root = byId("pullRequestInsightPanel");
  if (!root) {
    return;
  }
  root.innerHTML = "";

  const pullRequest = selectedPullRequest();
  if (!pullRequest) {
    root.appendChild(emptyText("Select a pull request from a lane to view review insights and Copilot comments."));
    return;
  }

  const key = pullRequestInsightKey(pullRequest);
  const cached = state.pullRequestInsightsCache[key] || null;
  root.appendChild(textLine(`${pullRequest.repo}#${pullRequest.number}`, "detail-title"));
  root.appendChild(textLine(`${pullRequest.title}`, "meta-line"));

  const controls = document.createElement("div");
  controls.className = "inline-actions";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "lane-action";
  open.textContent = "Open PR";
  open.onclick = () => vscode.postMessage({ type: "openPullRequest", url: pullRequest.url });
  controls.appendChild(open);

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "lane-action";
  refresh.textContent = state.pullRequestInsightsLoading === key ? "Loading..." : "Refresh Reviews";
  refresh.disabled = state.pullRequestInsightsLoading === key;
  refresh.onclick = () => requestPullRequestInsights(pullRequest, true);
  controls.appendChild(refresh);

  const createPr = document.createElement("button");
  createPr.type = "button";
  createPr.className = "lane-action";
  createPr.textContent = "Create PR";
  createPr.onclick = () => openPullRequestCreateForm(pullRequest.repo);
  controls.appendChild(createPr);
  root.appendChild(controls);

  if (state.pullRequestInsightsLoading === key && !cached) {
    root.appendChild(emptyText("Fetching pull request reviews and comments..."));
    return;
  }

  if (cached?.error) {
    root.appendChild(textLine(`Unable to load review insights: ${cached.error}`, "meta-line secondary"));
    return;
  }

  if (!cached) {
    root.appendChild(emptyText("Review insights are not loaded yet."));
    return;
  }

  const reviews = insightRowsForDisplay(cached.reviews);
  const comments = insightRowsForDisplay(cached.comments);
  const copilotRows = [...reviews, ...comments].filter((row) => Boolean(row.isCopilot));

  root.appendChild(textLine(
    `Reviews ${reviews.length} | Comments ${comments.length} | Copilot ${copilotRows.length}`,
    "meta-line secondary"
  ));

  appendInsightRows(root, "Copilot Review Comments", copilotRows);
  appendInsightRows(root, "Latest Reviews", reviews.filter((row) => !row.isCopilot));
  appendInsightRows(root, "Inline PR Comments", comments.filter((row) => !row.isCopilot));
}

function renderPullRequestCommentPanel() {
  const root = byId("pullRequestCommentPanel");
  if (!root) {
    return;
  }
  root.innerHTML = "";

  const pullRequest = selectedPullRequest();
  if (!pullRequest) {
    state.forms.pullRequestCommentTarget = null;
    state.forms.pullRequestCommentBusy = false;
    state.forms.pullRequestCommentStatus = "";
    root.appendChild(emptyText("Select a pull request to write and post a comment."));
    return;
  }

  const targetKey = pullRequestInsightKey(pullRequest);
  if (state.forms.pullRequestCommentTarget !== targetKey) {
    state.forms.pullRequestCommentTarget = targetKey;
    state.forms.pullRequestCommentDraft = "";
    state.forms.pullRequestCommentStatus = "";
    state.forms.pullRequestCommentBusy = false;
  }

  root.appendChild(textLine(`${pullRequest.repo}#${pullRequest.number}`, "detail-title"));
  root.appendChild(textLine(`${pullRequest.title}`, "meta-line"));

  const inputWrap = document.createElement("div");
  inputWrap.className = "field";
  const input = document.createElement("textarea");
  input.id = "pullRequestCommentInput";
  input.rows = 4;
  input.placeholder = "Comment body";
  input.value = state.forms.pullRequestCommentDraft;
  input.disabled = state.forms.pullRequestCommentBusy;
  input.oninput = () => {
    state.forms.pullRequestCommentDraft = input.value;
  };
  inputWrap.appendChild(input);
  root.appendChild(inputWrap);

  const actions = document.createElement("div");
  actions.className = "inline-actions";

  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "lane-action";
  submit.textContent = state.forms.pullRequestCommentBusy ? "Posting..." : "Post Comment";
  submit.disabled = state.forms.pullRequestCommentBusy;
  submit.onclick = () => {
    const body = state.forms.pullRequestCommentDraft.trim();
    if (!body) {
      state.forms.pullRequestCommentStatus = "Comment body is required.";
      renderPullRequestCommentPanel();
      return;
    }
    state.forms.pullRequestCommentBusy = true;
    state.forms.pullRequestCommentStatus = "Posting comment...";
    renderPullRequestCommentPanel();
    vscode.postMessage({
      type: "commentPullRequestFromView",
      repo: pullRequest.repo,
      number: pullRequest.number,
      body
    });
  };
  actions.appendChild(submit);

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "lane-action";
  clear.textContent = "Clear";
  clear.disabled = state.forms.pullRequestCommentBusy;
  clear.onclick = () => {
    state.forms.pullRequestCommentDraft = "";
    state.forms.pullRequestCommentStatus = "";
    renderPullRequestCommentPanel();
  };
  actions.appendChild(clear);
  root.appendChild(actions);

  root.appendChild(textLine(state.forms.pullRequestCommentStatus, "meta-line secondary"));
}

