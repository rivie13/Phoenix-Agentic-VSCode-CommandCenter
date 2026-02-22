import { EventSource } from "eventsource";
import { StreamEnvelope } from "../types";

export class SupervisorStreamClient {
  private eventSource: EventSource | null = null;

  connect(
    baseUrl: string,
    onEnvelope: (envelope: StreamEnvelope) => void,
    onError: (error: unknown) => void,
    onOpen: () => void
  ): void {
    this.dispose();

    const url = `${baseUrl.replace(/\/$/, "")}/events`;
    const source = new EventSource(url);

    source.onopen = () => onOpen();
    source.onerror = (event) => onError(event);

    source.onmessage = (message) => {
      try {
        const parsed = JSON.parse(message.data) as StreamEnvelope;
        onEnvelope(parsed);
      } catch (error) {
        onError(error);
      }
    };

    this.eventSource = source;
  }

  dispose(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}
