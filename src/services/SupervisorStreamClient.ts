import { StreamEnvelope } from "../types";

interface ParsedSseEvent {
  data: string;
  id: string | null;
  event: string | null;
}

export class SupervisorStreamClient {
  private abortController: AbortController | null = null;

  connect(
    baseUrl: string,
    authToken: string,
    onEnvelope: (envelope: StreamEnvelope) => void,
    onError: (error: unknown) => void,
    onOpen: () => void
  ): void {
    this.dispose();

    const url = `${baseUrl.replace(/\/$/, "")}/events`;
    const controller = new AbortController();
    this.abortController = controller;

    void this.consumeSse(url, authToken, controller, onEnvelope, onError, onOpen);
  }

  dispose(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private async consumeSse(
    url: string,
    authToken: string,
    controller: AbortController,
    onEnvelope: (envelope: StreamEnvelope) => void,
    onError: (error: unknown) => void,
    onOpen: () => void
  ): Promise<void> {
    try {
      const headers: Record<string, string> = {
        Accept: "text/event-stream"
      };
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
      }

      const response = await fetch(url, {
        signal: controller.signal,
        headers
      });

      if (!response.ok) {
        throw new Error(`SSE HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error("SSE stream did not provide a response body.");
      }

      onOpen();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentData: string[] = [];
      let currentEvent: string | null = null;
      let currentId: string | null = null;

      const emitIfReady = (): void => {
        if (currentData.length === 0) {
          currentEvent = null;
          currentId = null;
          return;
        }

        const parsed: ParsedSseEvent = {
          data: currentData.join("\n"),
          event: currentEvent,
          id: currentId
        };

        currentData = [];
        currentEvent = null;
        currentId = null;

        try {
          const envelope = JSON.parse(parsed.data) as StreamEnvelope;
          onEnvelope(envelope);
        } catch (error) {
          onError(error);
        }
      };

      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const newlineIndex = buffer.indexOf("\n");
          if (newlineIndex < 0) {
            break;
          }

          const rawLine = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

          if (line.length === 0) {
            emitIfReady();
            continue;
          }

          if (line.startsWith(":")) {
            continue;
          }

          const separator = line.indexOf(":");
          const field = separator >= 0 ? line.slice(0, separator) : line;
          let valuePart = separator >= 0 ? line.slice(separator + 1) : "";
          if (valuePart.startsWith(" ")) {
            valuePart = valuePart.slice(1);
          }

          if (field === "data") {
            currentData.push(valuePart);
            continue;
          }

          if (field === "event") {
            currentEvent = valuePart;
            continue;
          }

          if (field === "id") {
            currentId = valuePart;
          }
        }
      }

      if (buffer.length > 0) {
        const trailingLine = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
        if (trailingLine.startsWith("data:")) {
          currentData.push(trailingLine.slice(5).trimStart());
        }
      }

      emitIfReady();

      if (!controller.signal.aborted) {
        onError(new Error("SSE stream closed."));
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      onError(error);
    }
  }
}
