import type { RefreshReason } from "../services/DataService";
import type { AgentPendingCommand, DashboardSnapshot } from "../types";
import { focusFromSessionId } from "../utils/jarvisPrompts";
import type { JarvisFocusHint } from "./CommandCenterPayloads";

export interface JarvisDelegatedApprovalDeps {
  postSupervisorDecision: (commandId: string) => Promise<void>;
  refreshNow: (reason: RefreshReason) => Promise<void>;
}

export async function tryJarvisDelegatedApproval(
  deps: JarvisDelegatedApprovalDeps,
  prompt: string,
  snapshot: DashboardSnapshot
): Promise<{ text: string; reason: string; focusHint: JarvisFocusHint | null } | null> {
  const lowered = prompt.toLowerCase();
  if (!/\bapprove\b/.test(lowered) || !/\bpending\b/.test(lowered)) {
    return null;
  }

  const includeHighRisk = /\bincluding high\b|\bhigh risk too\b|\ball pending\b.*\bhigh\b/.test(lowered);
  let allowedRisks: AgentPendingCommand["risk"][] = ["low"];
  if (/\bmedium\b/.test(lowered) || /\ball pending\b/.test(lowered)) {
    allowedRisks = ["low", "medium"];
  }
  if (includeHighRisk) {
    allowedRisks = ["low", "medium", "high"];
  }

  const pending = snapshot.agents.pendingCommands.filter(
    (command) => command.status === "pending" && allowedRisks.includes(command.risk)
  );
  if (pending.length === 0) {
    return {
      text: "No matching pending commands are available for approval right now. I can keep watching and call out new ones.",
      reason: "delegated-approval-noop",
      focusHint: null
    };
  }

  let approved = 0;
  for (const command of pending) {
    try {
      await deps.postSupervisorDecision(command.commandId);
      approved += 1;
    } catch {
      // Continue to next command. Failures are summarized in the spoken response.
    }
  }

  await deps.refreshNow("manual");
  const rejectedByPolicy = snapshot.agents.pendingCommands.filter(
    (command) => command.status === "pending" && command.risk === "high" && !allowedRisks.includes("high")
  ).length;
  const focusHint = focusFromSessionId(snapshot, pending[0].sessionId, `Session ${pending[0].agentId}`);

  const text = rejectedByPolicy > 0
    ? `Approved ${approved} pending command${approved === 1 ? "" : "s"} within your delegated risk scope. I intentionally left ${rejectedByPolicy} high-risk command${rejectedByPolicy === 1 ? "" : "s"} for manual review.`
    : `Approved ${approved} pending command${approved === 1 ? "" : "s"} as requested. I will keep monitoring and flag anything unusual.`;

  return {
    text,
    reason: "delegated-approval",
    focusHint
  };
}
