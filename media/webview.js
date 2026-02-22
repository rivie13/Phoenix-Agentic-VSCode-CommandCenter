const vscode = acquireVsCodeApi();

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

const state = {
  snapshot: null,
  selected: null,
  filters: {
    repo: "all",
    lane: "all",
    workMode: "all",
    assignee: "all"
  }
};

function byId(id) {
  return document.getElementById(id);
}

function setStatus(text, cls) {
  const el = byId("connStatus");
  el.textContent = text;
  el.className = `status-pill ${cls}`;
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

  applyOptions(byId("repoFilter"), ["all", ...Array.from(repos).sort()]);
  applyOptions(byId("workModeFilter"), ["all", ...Array.from(workModes).sort()]);
  applyOptions(byId("assigneeFilter"), ["all", ...Array.from(assignees).sort()]);
  applyOptions(byId("laneFilter"), ["all", ...statusOrder]);
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

function renderBoard() {
  const root = byId("boardLanes");
  root.innerHTML = "";

  const items = filteredBoardItems();

  statusOrder.forEach((status) => {
    const lane = document.createElement("section");
    lane.className = "lane";

    const laneItems = items.filter((item) => item.status === status);

    const heading = document.createElement("h3");
    heading.textContent = `${status} (${laneItems.length})`;
    lane.appendChild(heading);

    if (!laneItems.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No items";
      lane.appendChild(empty);
    }

    laneItems.slice(0, 20).forEach((item) => {
      const card = document.createElement("div");
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
      title.textContent = item.title || "(Untitled)";
      card.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `${item.repo || "unknown repo"} • #${item.issueNumber || "?"}`;
      card.appendChild(meta);

      lane.appendChild(card);
    });

    root.appendChild(lane);
  });
}

function runBuckets() {
  const runs = state.snapshot?.actions?.runs || [];
  return {
    queued: runs.filter((run) => run.status === "queued"),
    inProgress: runs.filter((run) => run.status === "in_progress"),
    needsAttention: runs.filter((run) => ["failure", "cancelled", "action_required", "timed_out"].includes((run.conclusion || "").toLowerCase()))
  };
}

function renderActions() {
  const buckets = runBuckets();
  renderRunColumn("actionsQueued", "Queued", buckets.queued);
  renderRunColumn("actionsInProgress", "In Progress", buckets.inProgress);
  renderRunColumn("actionsNeedsAttention", "Needs Attention", buckets.needsAttention);
}

function renderRunColumn(targetId, heading, runs) {
  const root = byId(targetId);
  root.innerHTML = "";

  const section = document.createElement("section");
  section.className = "lane";

  const h = document.createElement("h3");
  h.textContent = `${heading} (${runs.length})`;
  section.appendChild(h);

  if (!runs.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No runs";
    section.appendChild(empty);
  }

  runs.slice(0, 20).forEach((run) => {
    const card = document.createElement("div");
    card.className = "card";
    if (state.selected?.kind === "run" && state.selected.id === run.id) {
      card.classList.add("selected");
    }

    card.onclick = () => {
      state.selected = { kind: "run", id: run.id };
      render();
    };

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = run.workflowName || run.name || "Workflow";
    card.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${run.repo} • ${run.status}${run.conclusion ? `/${run.conclusion}` : ""}`;
    card.appendChild(meta);

    section.appendChild(card);
  });

  root.appendChild(section);
}

function renderDetail() {
  const root = byId("detailPanel");
  root.innerHTML = "";

  const panel = document.createElement("section");
  panel.className = "panel";

  const heading = document.createElement("h3");
  heading.textContent = "Detail";
  panel.appendChild(heading);

  if (!state.snapshot || !state.selected) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Select a board item or workflow run.";
    panel.appendChild(empty);
    root.appendChild(panel);
    return;
  }

  if (state.selected.kind === "issue") {
    const item = state.snapshot.board.items.find((entry) => entry.itemId === state.selected.id);
    if (!item) {
      panel.appendChild(emptyText("Selected issue no longer exists in snapshot."));
      root.appendChild(panel);
      return;
    }

    panel.appendChild(textBlock(item.title || "Untitled"));
    panel.appendChild(textBlock(`Repo: ${item.repo || "unknown"}`));
    panel.appendChild(textBlock(`Issue: #${item.issueNumber || "?"}`));
    panel.appendChild(textBlock(`Status: ${item.status || "Unknown"}`));
    panel.appendChild(textBlock(`Work mode: ${item.workMode || "(unset)"}`));
    panel.appendChild(textBlock(`Priority: ${item.priority || "(unset)"}`));
    panel.appendChild(textBlock(`Area: ${item.area || "(unset)"}`));
    panel.appendChild(textBlock(`Claim Owner: ${item.claimOwner || "(unset)"}`));
    panel.appendChild(textBlock(`Lease Expires: ${item.leaseExpires || "(unset)"}`));
    panel.appendChild(textBlock(`Last Heartbeat: ${item.lastHeartbeat || "(unset)"}`));
    panel.appendChild(textBlock(`Run Link: ${item.runLink || "(unset)"}`));

    const actionRow = document.createElement("div");
    actionRow.className = "inline-actions";

    const openIssue = document.createElement("button");
    openIssue.textContent = "Open Issue";
    openIssue.onclick = () => {
      if (item.url) {
        vscode.postMessage({ type: "openIssue", url: item.url });
      }
    };
    actionRow.appendChild(openIssue);

    if (item.runLink) {
      const openRun = document.createElement("button");
      openRun.textContent = "Open Run";
      openRun.onclick = () => {
        vscode.postMessage({ type: "openRun", url: item.runLink });
      };
      actionRow.appendChild(openRun);
    }

    panel.appendChild(actionRow);
  }

  if (state.selected.kind === "run") {
    const run = state.snapshot.actions.runs.find((entry) => entry.id === state.selected.id);
    if (!run) {
      panel.appendChild(emptyText("Selected run no longer exists in snapshot."));
      root.appendChild(panel);
      return;
    }

    panel.appendChild(textBlock(run.workflowName || run.name || "Workflow"));
    panel.appendChild(textBlock(`Repo: ${run.repo}`));
    panel.appendChild(textBlock(`Status: ${run.status}`));
    panel.appendChild(textBlock(`Conclusion: ${run.conclusion || "(pending)"}`));
    panel.appendChild(textBlock(`Branch: ${run.headBranch || "(unknown)"}`));

    const relatedJobs = (state.snapshot.actions.jobs || []).filter((job) => job.runId === run.id);
    if (relatedJobs.length) {
      panel.appendChild(textBlock("Jobs:"));
      relatedJobs.forEach((job) => {
        const line = `${job.jobName} • ${job.status}${job.conclusion ? `/${job.conclusion}` : ""} • ${job.failedSteps.join(", ") || "no failing steps captured"}`;
        panel.appendChild(textBlock(line));
      });
    }

    const actionRow = document.createElement("div");
    actionRow.className = "inline-actions";
    const openRun = document.createElement("button");
    openRun.textContent = "Open Run";
    openRun.onclick = () => {
      if (run.url) {
        vscode.postMessage({ type: "openRun", url: run.url });
      }
    };
    actionRow.appendChild(openRun);
    panel.appendChild(actionRow);
  }

  root.appendChild(panel);
}

function emptyText(text) {
  const div = document.createElement("div");
  div.className = "empty";
  div.textContent = text;
  return div;
}

function textBlock(text) {
  const div = document.createElement("div");
  div.className = "meta";
  div.textContent = text;
  return div;
}

function renderMeta() {
  const meta = state.snapshot?.meta;
  if (!meta) {
    return;
  }

  byId("updatedAt").textContent = new Date(meta.generatedAt).toLocaleString();
  byId("dataSource").textContent = `Source: ${meta.source}`;

  if (meta.stale) {
    setStatus("Stale", "warn");
  } else if (meta.streamConnected) {
    setStatus("Live Stream", "ok");
  } else {
    setStatus("Polling", "warn");
  }
}

function render() {
  if (!state.snapshot) {
    return;
  }
  renderMeta();
  renderBoard();
  renderActions();
  renderDetail();
}

function bindEvents() {
  byId("refreshButton").addEventListener("click", () => {
    vscode.postMessage({ type: "command", command: "phoenixOps.refresh" });
  });

  byId("createIssueButton").addEventListener("click", () => {
    vscode.postMessage({ type: "command", command: "phoenixOps.createIssue" });
  });

  byId("updateFieldButton").addEventListener("click", () => {
    vscode.postMessage({ type: "command", command: "phoenixOps.updateProjectField" });
  });

  byId("updateLabelsButton").addEventListener("click", () => {
    vscode.postMessage({ type: "command", command: "phoenixOps.updateLabels" });
  });

  ["repoFilter", "laneFilter", "workModeFilter", "assigneeFilter"].forEach((id) => {
    byId(id).addEventListener("change", (event) => {
      const target = event.target;
      if (!target || !(target instanceof HTMLSelectElement)) {
        return;
      }
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
    updateFilterOptions(state.snapshot);
    render();
  }
  if (message.type === "status") {
    setStatus(message.payload.text, message.payload.level);
  }
});

bindEvents();
vscode.postMessage({ type: "ready" });
