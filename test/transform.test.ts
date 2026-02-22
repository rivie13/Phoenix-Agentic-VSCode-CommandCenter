import { describe, expect, it } from "vitest";
import { bucketRuns, isNeedsAttention, mapBoardItems } from "../src/utils/transform";

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
