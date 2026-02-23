import type { RefreshReason } from "../services/DataService";
import type { SupervisorStreamClient } from "../services/SupervisorStreamClient";
import type { DashboardSnapshot, StreamEnvelope } from "../types";

type StatusLevel = "ok" | "warn" | "err";

interface SupervisorRuntimeSettings {
  useSupervisorStream: boolean;
  supervisorBaseUrl: string;
  supervisorAuthToken: string;
}

export interface SupervisorFlowHandlersDeps {
  getRuntimeSettings: () => SupervisorRuntimeSettings;
  streamClient: Pick<SupervisorStreamClient, "connect">;
  fetchSnapshot: (snapshotUrl: string, authToken: string) => Promise<DashboardSnapshot>;
  acceptSnapshot: (snapshot: DashboardSnapshot) => void;
  onStreamEnvelope: (envelope: StreamEnvelope) => void;
  getStreamConnected: () => boolean;
  setStreamConnected: (value: boolean) => void;
  logInfo: (message: string) => void;
  logWarn: (message: string) => void;
  postStatus: (message: string, level: StatusLevel) => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  sleep: (ms: number) => Promise<void>;
}

async function requestSupervisorReconcile(baseUrl: string, authToken: string): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const headers: Record<string, string> = {};
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    await fetch(`${baseUrl}/reconcile`, {
      method: "POST",
      signal: controller.signal,
      headers
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function startDataFlow(deps: SupervisorFlowHandlersDeps): Promise<void> {
  const settings = deps.getRuntimeSettings();
  deps.logInfo(
    `Starting data flow (useSupervisorStream=${settings.useSupervisorStream}, supervisorBaseUrl=${settings.supervisorBaseUrl.replace(/\/$/, "")}).`
  );
  if (!settings.useSupervisorStream) {
    deps.startPolling();
    return;
  }

  const connected = await tryStartSupervisorStream(deps);
  if (!connected) {
    deps.startPolling();
  }
}

export async function tryStartSupervisorStream(deps: SupervisorFlowHandlersDeps): Promise<boolean> {
  const settings = deps.getRuntimeSettings();
  if (!settings.useSupervisorStream) {
    return false;
  }

  const snapshotUrl = `${settings.supervisorBaseUrl.replace(/\/$/, "")}/snapshot`;

  try {
    deps.logInfo(`Attempting supervisor stream bootstrap from ${snapshotUrl}.`);
    const initial = await deps.fetchSnapshot(snapshotUrl, settings.supervisorAuthToken);
    deps.acceptSnapshot({
      ...initial,
      meta: {
        ...initial.meta,
        source: "supervisor",
        streamConnected: true,
        stale: false
      }
    });

    deps.streamClient.connect(
      settings.supervisorBaseUrl,
      settings.supervisorAuthToken,
      (envelope) => deps.onStreamEnvelope(envelope),
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        deps.logWarn(`Supervisor stream disconnected: ${message}`);
        deps.setStreamConnected(false);
        void deps.postStatus("Supervisor stream disconnected; polling supervisor snapshot", "warn");
        deps.startPolling();
      },
      () => {
        deps.logInfo("Supervisor stream connected.");
        deps.setStreamConnected(true);
        deps.stopPolling();
        void deps.postStatus("Live stream connected", "ok");
      }
    );

    deps.stopPolling();
    return true;
  } catch (error) {
    deps.setStreamConnected(false);
    const message = error instanceof Error ? error.message : String(error);
    deps.logWarn(`Supervisor stream bootstrap failed: ${message}`);
    await deps.postStatus("Supervisor unavailable", "warn");
    return false;
  }
}

export async function refreshFromSupervisor(
  deps: SupervisorFlowHandlersDeps,
  reason: RefreshReason
): Promise<boolean> {
  const settings = deps.getRuntimeSettings();
  const baseUrl = settings.supervisorBaseUrl.replace(/\/$/, "");
  const snapshotUrl = `${baseUrl}/snapshot`;

  try {
    if (reason === "write") {
      try {
        await requestSupervisorReconcile(baseUrl, settings.supervisorAuthToken);
        await deps.sleep(600);
      } catch {
        // If manual reconcile endpoint is unavailable, still attempt /snapshot.
      }
    }

    const snapshot = await deps.fetchSnapshot(snapshotUrl, settings.supervisorAuthToken);
    deps.acceptSnapshot({
      ...snapshot,
      meta: {
        ...snapshot.meta,
        source: "supervisor",
        streamConnected: deps.getStreamConnected(),
        stale: false
      }
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logWarn(`Supervisor snapshot refresh failed (${reason}): ${message}`);
    if (reason === "poll" && !deps.getStreamConnected()) {
      return await tryStartSupervisorStream(deps);
    }
    return false;
  }
}
