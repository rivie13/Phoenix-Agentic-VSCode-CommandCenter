import WebSocket, { type RawData } from "ws";
import type { AgentTerminalStreamPayload } from "../controller/CommandCenterPayloads";

export class SupervisorTerminalClient {
  private socket: WebSocket | null = null;

  connect(
    baseUrl: string,
    authToken: string,
    sessionId: string,
    onPayload: (payload: AgentTerminalStreamPayload) => void,
    onError: (error: unknown) => void,
    onClose?: () => void,
    onOpen?: () => void
  ): void {
    this.dispose();

    const url = this.toWebSocketUrl(baseUrl, authToken, sessionId);
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.on("message", (data: RawData) => {
      const payload = this.parsePayload(data);
      if (!payload) {
        return;
      }
      onPayload(payload);
    });

    socket.on("open", () => {
      onOpen?.();
    });

    socket.on("error", (event: Error) => {
      onError(event);
    });

    socket.on("close", () => {
      if (this.socket === socket) {
        this.socket = null;
      }
      onClose?.();
    });
  }

  dispose(): void {
    if (!this.socket) {
      return;
    }
    try {
      this.socket.close();
    } catch {
      // Ignore close failures.
    } finally {
      this.socket = null;
    }
  }

  private toWebSocketUrl(baseUrl: string, authToken: string, sessionId: string): string {
    const normalized = baseUrl.replace(/\/$/, "");
    const parsed = new URL(normalized);
    parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    parsed.pathname = "/agents/terminal/stream";
    parsed.searchParams.set("sessionId", sessionId);
    if (authToken) {
      parsed.searchParams.set("token", authToken);
    }
    return parsed.toString();
  }

  private parsePayload(data: unknown): AgentTerminalStreamPayload | null {
    const text = this.toText(data);
    if (!text) {
      return null;
    }

    try {
      const parsed = JSON.parse(text) as AgentTerminalStreamPayload;
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      if (typeof parsed.type !== "string" || typeof parsed.sessionId !== "string") {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private toText(data: unknown): string {
    if (typeof data === "string") {
      return data;
    }
    if (Buffer.isBuffer(data)) {
      return data.toString("utf8");
    }
    if (data instanceof ArrayBuffer) {
      return new TextDecoder().decode(data);
    }
    if (ArrayBuffer.isView(data)) {
      return new TextDecoder().decode(data);
    }
    return "";
  }
}
