import { EventEmitter } from "events";

export interface ServerTranscriptEvent {
  text: string;
  is_final: boolean;
  timestamp: number;
}

export type TranscriptListener = (event: ServerTranscriptEvent) => void;

class ServerSTTManager extends EventEmitter {
  public emitTranscript(text: string, isFinal: boolean, timestamp: number = Date.now()): ServerTranscriptEvent {
    const event: ServerTranscriptEvent = {
      text: text.trim(),
      is_final: isFinal,
      timestamp,
    };
    this.emit("transcript", event);
    return event;
  }

  public onTranscript(listener: TranscriptListener): () => void {
    this.on("transcript", listener);
    return () => {
      this.off("transcript", listener);
    };
  }
}

export const serverSTT = new ServerSTTManager();
