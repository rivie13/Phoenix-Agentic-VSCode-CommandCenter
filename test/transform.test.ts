import { describe, expect, it } from "vitest";
import { applyStreamEnvelope, bucketRuns, isNeedsAttention, mapBoardItems } from "../src/utils/transform";

describe("mapBoardItems", () => {
  it("maps raw project payload into board item shape", () => {
    const items = mapBoardItems([
      {
        id: "item-1",
        status: "Ready",
        repository: "https://github.com/rivie13/Phoenix-Agentic-Engine",
        title: "Task title",
        content: {
          number: 42,
          url: "https://github.com/rivie13/Phoenix-Agentic-Engine/issues/42"
        }
      }
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].itemId).toBe("item-1");
    expect(items[0].issueNumber).toBe(42);
    expect(items[0].repo).toBe("rivie13/Phoenix-Agentic-Engine");
    expect(items[0].status).toBe("Ready");
  });
});

describe("run buckets", () => {
  it("classifies runs into queue/in-progress/attention buckets", () => {
    const runs = [
      {
        id: 1,
        repo: "r/a",
        workflowName: "A",
        name: "A",
        displayTitle: "A",
        status: "queued",
        conclusion: null,
        event: "push",
        headBranch: "main",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        url: "https://example.com/1",
        number: 1
      },
      {
        id: 2,
        repo: "r/b",
        workflowName: "B",
        name: "B",
        displayTitle: "B",
        status: "in_progress",
        conclusion: null,
        event: "push",
        headBranch: "main",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        url: "https://example.com/2",
        number: 2
      },
      {
        id: 3,
        repo: "r/c",
        workflowName: "C",
        name: "C",
        displayTitle: "C",
        status: "completed",
        conclusion: "failure",
        event: "push",
        headBranch: "main",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        url: "https://example.com/3",
        number: 3
      }
    ];

    const buckets = bucketRuns(runs);
    expect(buckets.queued).toHaveLength(1);
    expect(buckets.inProgress).toHaveLength(1);
    expect(buckets.needsAttention).toHaveLength(1);
    expect(isNeedsAttention("action_required")).toBe(true);
  });
});

describe("stream reducer", () => {
  it("applies agent session and feed events", () => {
    const base = {
      board: { items: [] },
      actions: { runs: [], jobs: [], pullRequests: [] },
      agents: { sessions: [], feed: [], pendingCommands: [] },
      meta: {
        generatedAt: "2026-01-01T00:00:00Z",
        sequence: 1,
        source: "supervisor" as const,
        streamConnected: true,
        stale: false
      }
    };

    const withSession = applyStreamEnvelope(base, {
      eventId: "a-1",
      sequence: 2,
      eventType: "agents.session.upserted",
      occurredAt: "2026-01-01T00:00:05Z",
      source: "test",
      payload: {
        sessionId: "s1",
        agentId: "Codex CLI",
        transport: "cli",
        status: "online",
        summary: "Working",
        workspace: "C:/workspace",
        repository: "rivie13/Phoenix-Agentic-Engine",
        branch: "main",
        startedAt: "2026-01-01T00:00:00Z",
        lastHeartbeat: "2026-01-01T00:00:05Z",
        updatedAt: "2026-01-01T00:00:05Z"
      }
    });

    const withFeed = applyStreamEnvelope(withSession, {
      eventId: "a-2",
      sequence: 3,
      eventType: "agents.feed.appended",
      occurredAt: "2026-01-01T00:00:06Z",
      source: "test",
      payload: {
        entryId: "f1",
        sessionId: "s1",
        agentId: "Codex CLI",
        transport: "cli",
        level: "info",
        message: "Heartbeat",
        repository: "rivie13/Phoenix-Agentic-Engine",
        workspace: "C:/workspace",
        occurredAt: "2026-01-01T00:00:06Z"
      }
    });

    const withCommand = applyStreamEnvelope(withFeed, {
      eventId: "a-3",
      sequence: 4,
      eventType: "agents.command.upserted",
      occurredAt: "2026-01-01T00:00:07Z",
      source: "test",
      payload: {
        commandId: "cmd-1",
        sessionId: "s1",
        agentId: "Codex CLI",
        transport: "cli",
        command: "rm -rf build",
        reason: "Dangerous operation",
        risk: "high",
        status: "pending",
        createdAt: "2026-01-01T00:00:07Z",
        updatedAt: "2026-01-01T00:00:07Z"
      }
    });

    const withPullRequest = applyStreamEnvelope(withCommand, {
      eventId: "a-4",
      sequence: 5,
      eventType: "actions.pull_request.upserted",
      occurredAt: "2026-01-01T00:00:08Z",
      source: "test",
      payload: {
        id: "rivie13/Phoenix-Agentic-Engine#101",
        repo: "rivie13/Phoenix-Agentic-Engine",
        number: 101,
        title: "feat: add split agent pane",
        state: "OPEN",
        reviewState: "review_required",
        isDraft: false,
        headBranch: "feat/split-pane",
        baseBranch: "main",
        author: "rivie13",
        updatedAt: "2026-01-01T00:00:08Z",
        createdAt: "2026-01-01T00:00:08Z",
        url: "https://github.com/rivie13/Phoenix-Agentic-Engine/pull/101"
      }
    });

    expect(withPullRequest.agents.sessions).toHaveLength(1);
    expect(withPullRequest.agents.feed).toHaveLength(1);
    expect(withPullRequest.agents.pendingCommands).toHaveLength(1);
    expect(withPullRequest.actions.pullRequests).toHaveLength(1);
    expect(withPullRequest.meta.sequence).toBe(5);
  });
});
