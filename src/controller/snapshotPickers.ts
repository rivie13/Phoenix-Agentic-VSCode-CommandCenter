import * as vscode from "vscode";
import type {
  ActionRun,
  AgentPendingCommand,
  BoardItem,
  DashboardSnapshot,
  PullRequestSummary
} from "../types";

interface SnapshotPickerContext {
  getSnapshot: () => DashboardSnapshot | null;
  refresh: () => Promise<void>;
}

export function findBoardItemById(snapshot: DashboardSnapshot | null, itemId: string): BoardItem | undefined {
  return snapshot?.board.items.find((item) => item.itemId === itemId);
}

export async function pickBoardItem(
  context: SnapshotPickerContext,
  title: string
): Promise<BoardItem | undefined> {
  if (!context.getSnapshot()) {
    await context.refresh();
  }

  const snapshot = context.getSnapshot();
  if (!snapshot || snapshot.board.items.length === 0) {
    vscode.window.showWarningMessage("No board items available.");
    return undefined;
  }

  return await vscode.window
    .showQuickPick(
      snapshot.board.items.map((item) => ({
        label: `#${item.issueNumber ?? "?"} ${item.title}`,
        description: `${item.repo} | ${item.status}${item.workMode ? ` | ${item.workMode}` : ""}`,
        item
      })),
      { title, placeHolder: "Select board item" }
    )
    .then((selected) => selected?.item);
}

export async function pickRun(
  context: SnapshotPickerContext,
  title: string
): Promise<ActionRun | undefined> {
  if (!context.getSnapshot()) {
    await context.refresh();
  }

  const runs = context.getSnapshot()?.actions.runs ?? [];
  if (!runs.length) {
    vscode.window.showWarningMessage("No workflow runs available.");
    return undefined;
  }

  return await vscode.window
    .showQuickPick(
      runs.map((run) => ({
        label: `${run.repo} #${run.id}`,
        description: `${run.workflowName || run.name} | ${run.status}${run.conclusion ? `/${run.conclusion}` : ""}`,
        run
      })),
      { title, placeHolder: "Select workflow run" }
    )
    .then((selected) => selected?.run);
}

export async function pickPullRequest(
  context: SnapshotPickerContext,
  title: string
): Promise<PullRequestSummary | undefined> {
  if (!context.getSnapshot()) {
    await context.refresh();
  }

  const pullRequests = context.getSnapshot()?.actions.pullRequests ?? [];
  if (!pullRequests.length) {
    vscode.window.showWarningMessage("No pull requests available.");
    return undefined;
  }

  return await vscode.window
    .showQuickPick(
      pullRequests.map((pr) => ({
        label: `${pr.repo} #${pr.number} ${pr.title}`,
        description: `${pr.reviewState}${pr.headBranch ? ` | ${pr.headBranch}` : ""}`,
        pr
      })),
      { title, placeHolder: "Select pull request" }
    )
    .then((selected) => selected?.pr);
}

export async function pickPendingCommand(
  context: SnapshotPickerContext,
  title: string
): Promise<AgentPendingCommand | undefined> {
  const first = context.getSnapshot();
  if (!first || first.agents.pendingCommands.length === 0) {
    await context.refresh();
  }

  const pending = (context.getSnapshot()?.agents.pendingCommands ?? []).filter((command) => command.status === "pending");
  if (!pending.length) {
    vscode.window.showWarningMessage("No pending commands require approval.");
    return undefined;
  }

  return await vscode.window
    .showQuickPick(
      pending.map((command) => ({
        label: `${command.agentId} | ${command.risk.toUpperCase()}`,
        description: command.command,
        detail: command.reason ?? "",
        command
      })),
      { title, placeHolder: "Select pending command" }
    )
    .then((selected) => selected?.command);
}
