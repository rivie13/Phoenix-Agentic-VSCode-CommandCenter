import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardSnapshot } from "../src/types";
import {
  buildJarvisSessionSnapshot,
  buildJarvisSessionSummary,
  buildJarvisStartupGreeting,
  createJarvisSessionMemoryStore,
  listRecentJarvisSessionSummaries,
  loadJarvisSessionMemory,
  persistJarvisSessionMemory,
  upsertJarvisSessionMemory
} from "../src/utils/jarvisSessionMemory";

const tempPaths: string[] = [];

function createSnapshot(): DashboardSnapshot {
  return {
    board: {
      items: [
        {
          itemId: "item-1",
          issueNumber: 101,
          title: "Fix dispatch retry",
          url: "https://example.com/issue/101",
          repo: "rivie13/Phoenix-Agentic-VSCode-CommandCenter",
          status: "In Progress",
          workMode: null,
          priority: "High",
          size: "M",
          area: "agent",
          assignees: ["rivie"],
          labels: ["bug"],
          claimOwner: null,
          leaseExpires: null,
          lastHeartbeat: null,
          runLink: null
        }
      ]
    },
    actions: {
      runs: [
        {
          id: 1,
          repo: "rivie13/Phoenix-Agentic-VSCode-CommandCenter",
          workflowName: "CI",
          name: "build",
          displayTitle: "Build",
          status: "completed",
          conclusion: "failure",
          event: "push",
          headBranch: "main",
          createdAt: "2026-02-23T10:00:00.000Z",
          updatedAt: "2026-02-23T10:05:00.000Z",
          url: "https://example.com/runs/1",
          number: 11
        },
        {
          id: 2,
          repo: "rivie13/Phoenix-Agentic-VSCode-CommandCenter",
          workflowName: "CI",
          name: "lint",
          displayTitle: "Lint",
          status: "completed",
          conclusion: "success",
          event: "push",
          headBranch: "main",
          createdAt: "2026-02-23T11:00:00.000Z",
          updatedAt: "2026-02-23T11:05:00.000Z",
          url: "https://example.com/runs/2",
          number: 12
        }
      ],
      jobs: [],
      pullRequests: [
        {
          id: "pr-1",
          repo: "rivie13/Phoenix-Agentic-VSCode-CommandCenter",
          number: 42,
          title: "Session memory",
          state: "open",
          reviewState: "review_required",
          isDraft: false,
          headBranch: "feature/session-memory",
          baseBranch: "main",
          author: "rivie",
          updatedAt: "2026-02-23T12:00:00.000Z",
          createdAt: "2026-02-23T12:00:00.000Z",
          url: "https://example.com/pulls/42"
        }
      ]
    },
    agents: {
      sessions: [
        {
          sessionId: "s1",
          agentId: "Codex",
          transport: "cli",
          status: "waiting",
          summary: "Waiting on approval",
          service: null,
          mode: null,
          model: null,
          toolProfile: null,
          mcpTools: [],
          workspace: "C:/workspace",
          repository: "rivie13/Phoenix-Agentic-VSCode-CommandCenter",
          branch: "main",
          startedAt: "2026-02-23T12:00:00.000Z",
          lastHeartbeat: "2026-02-23T12:02:00.000Z",
          updatedAt: "2026-02-23T12:02:00.000Z"
        },
        {
          sessionId: "s2",
          agentId: "Copilot",
          transport: "cli",
          status: "error",
          summary: "Failed run",
          service: null,
          mode: null,
          model: null,
          toolProfile: null,
          mcpTools: [],
          workspace: "C:/workspace",
          repository: "rivie13/Phoenix-Agentic-VSCode-CommandCenter",
          branch: "main",
          startedAt: "2026-02-23T12:00:00.000Z",
          lastHeartbeat: "2026-02-23T12:03:00.000Z",
          updatedAt: "2026-02-23T12:03:00.000Z"
        }
      ],
      feed: [],
      pendingCommands: [
        {
          commandId: "c1",
          sessionId: "s1",
          agentId: "Codex",
          transport: "cli",
          command: "git push",
          reason: "needs approval",
          risk: "high",
          status: "pending",
          createdAt: "2026-02-23T12:03:00.000Z",
          updatedAt: "2026-02-23T12:03:00.000Z"
        }
      ]
    },
    meta: {
      generatedAt: "2026-02-23T12:03:00.000Z",
      sequence: 1,
      source: "supervisor",
      streamConnected: true,
      stale: false
    }
  };
}

describe("jarvisSessionMemory", () => {
  afterEach(() => {
    for (const tempPath of tempPaths) {
      try {
        fs.rmSync(tempPath, { recursive: true, force: true });
      } catch {
        // ignore cleanup failure in tests
      }
    }
    tempPaths.length = 0;
  });

  it("builds deterministic snapshot metrics", () => {
    const stats = buildJarvisSessionSnapshot(createSnapshot());
    expect(stats.actionRunsTotal24h).toBe(2);
    expect(stats.actionRunsAttention24h).toBe(1);
    expect(stats.agentSessions).toBe(2);
    expect(stats.waitingSessions).toBe(1);
    expect(stats.erroredSessions).toBe(1);
    expect(stats.pendingApprovals).toBe(1);
    expect(stats.highRiskApprovals).toBe(1);
    expect(stats.pullRequestsNeedingReview).toBe(1);
  });

  it("excludes Jarvis meta sessions from snapshot metrics", () => {
    const snapshot = createSnapshot();
    snapshot.agents.sessions.push({
      sessionId: "jarvis-voice",
      agentId: "Jarvis",
      transport: "local",
      status: "waiting",
      summary: "Meta supervisor session",
      service: "jarvis",
      mode: "voice",
      model: "openai",
      toolProfile: null,
      mcpTools: [],
      workspace: "C:/workspace",
      repository: "rivie13/Phoenix-Agentic-VSCode-CommandCenter",
      branch: "main",
      startedAt: "2026-02-23T12:00:00.000Z",
      lastHeartbeat: "2026-02-23T12:03:00.000Z",
      updatedAt: "2026-02-23T12:03:00.000Z"
    });

    const stats = buildJarvisSessionSnapshot(snapshot);
    expect(stats.agentSessions).toBe(2);
    expect(stats.waitingSessions).toBe(1);
    expect(stats.erroredSessions).toBe(1);
  });

  it("upserts sessions and returns bounded prior summaries", () => {
    const snapshot = buildJarvisSessionSnapshot(createSnapshot());
    let store = createJarvisSessionMemoryStore();

    store = upsertJarvisSessionMemory(
      store,
      {
        sessionId: "a",
        workspaceName: "Phoenix Ops",
        startedAt: "2026-02-23T09:00:00.000Z",
        endedAt: "2026-02-23T09:10:00.000Z",
        summary: "Session A",
        snapshot,
        turns: [{ role: "assistant", content: "A" }],
        nowIso: "2026-02-23T09:10:00.000Z"
      },
      { maxSessions: 10, maxTurnsPerSession: 8 }
    );

    store = upsertJarvisSessionMemory(
      store,
      {
        sessionId: "b",
        workspaceName: "Phoenix Ops",
        startedAt: "2026-02-23T10:00:00.000Z",
        endedAt: "2026-02-23T10:05:00.000Z",
        summary: "Session B",
        snapshot,
        turns: [{ role: "assistant", content: "B" }],
        nowIso: "2026-02-23T10:05:00.000Z"
      },
      { maxSessions: 10, maxTurnsPerSession: 8 }
    );

    store = upsertJarvisSessionMemory(
      store,
      {
        sessionId: "c",
        workspaceName: "Phoenix Ops",
        startedAt: "2026-02-23T11:00:00.000Z",
        endedAt: "2026-02-23T11:05:00.000Z",
        summary: "Session C",
        snapshot,
        turns: [{ role: "assistant", content: "C" }],
        nowIso: "2026-02-23T11:05:00.000Z"
      },
      { maxSessions: 10, maxTurnsPerSession: 8 }
    );

    const summaries = listRecentJarvisSessionSummaries(store, "c", 2);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toContain("Session B");
    expect(summaries[1]).toContain("Session A");
  });

  it("persists and reloads memory store", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-memory-"));
    tempPaths.push(tempDir);
    const memoryPath = path.join(tempDir, "phoenix-jarvis-session-memory.json");

    const snapshot = buildJarvisSessionSnapshot(createSnapshot());
    const summary = buildJarvisSessionSummary({
      workspaceName: "Phoenix Ops",
      snapshot,
      turns: [
        { role: "user", content: "What should I do next?" },
        { role: "assistant", content: "Review the pending high-risk approval first." }
      ]
    });

    const store = upsertJarvisSessionMemory(
      createJarvisSessionMemoryStore(),
      {
        sessionId: "session-current",
        workspaceName: "Phoenix Ops",
        startedAt: "2026-02-23T12:00:00.000Z",
        endedAt: null,
        summary,
        snapshot,
        turns: [
          { role: "user", content: "What should I do next?" },
          { role: "assistant", content: "Review the pending high-risk approval first." }
        ],
        nowIso: "2026-02-23T12:00:00.000Z"
      },
      { maxSessions: 10, maxTurnsPerSession: 8 }
    );

    expect(persistJarvisSessionMemory(memoryPath, store)).toBe(true);

    const reloaded = loadJarvisSessionMemory(memoryPath);
    expect(reloaded.sessions).toHaveLength(1);
    expect(reloaded.sessions[0]?.sessionId).toBe("session-current");
    expect(reloaded.sessions[0]?.summary).toContain("Last request");
  });

  it("builds startup greeting from local snapshot and prior summaries", () => {
    const greeting = buildJarvisStartupGreeting({
      workspaceName: "Phoenix Ops",
      operatorName: "Rivie",
      snapshot: {
        boardItems: 5,
        actionRunsTotal24h: 12,
        actionRunsAttention24h: 2,
        agentSessions: 4,
        waitingSessions: 1,
        erroredSessions: 1,
        pendingApprovals: 3,
        highRiskApprovals: 1,
        pullRequestsNeedingReview: 2
      },
      priorSessionSummaries: ["Phoenix Ops: Session A", "Phoenix Ops: Session B"]
    });

    expect(greeting).toContain("Rivie");
    expect(greeting).toContain("4 sessions");
    expect(greeting).toContain("2 workflow runs needing attention");
    expect(greeting).toContain("Session A");
  });
});
