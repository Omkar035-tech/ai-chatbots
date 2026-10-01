import { llmRouter } from "../llm/router";

export interface TranscriptChunk {
  text: string;
  isFinal: boolean;
  ts: number;
}

export class ContextBuffer {
  private chunks: TranscriptChunk[] = [];
  private rollingSummary: string = "Stream started recently.";
  private lastSummaryRefresh: number = Date.now();
  private maxWindowMs: number = 30000; // ~30 seconds

  public addTranscript(text: string, isFinal: boolean, ts: number = Date.now()): void {
    if (!text.trim()) return;

    this.chunks.push({ text: text.trim(), isFinal, ts });
    this.prune();

    // Trigger summary update every 60 seconds
    if (Date.now() - this.lastSummaryRefresh > 60000) {
      this.refreshSummary();
    }
  }

  private prune() {
    const cutoff = Date.now() - this.maxWindowMs;
    this.chunks = this.chunks.filter((c) => c.ts >= cutoff);
  }

  public getRecentTranscriptText(seconds: number = 30): string {
    const cutoff = Date.now() - seconds * 1000;
    const relevant = this.chunks.filter((c) => c.ts >= cutoff && c.isFinal);
    return relevant.map((c) => c.text).join(" ");
  }

  public getFullRecentWindow(): TranscriptChunk[] {
    this.prune();
    return [...this.chunks];
  }

  public getRollingSummary(): string {
    return this.rollingSummary;
  }

  private async refreshSummary() {
    this.lastSummaryRefresh = Date.now();
    const recent = this.getRecentTranscriptText(45);
    if (!recent || recent.length < 20) return;

    try {
      const prompt = `Summarize the current stream action in 1 concise sentence based on what the streamer said:\n"${recent}"\nPrevious summary: "${this.rollingSummary}"`;
      const res = await llmRouter.complete_json(
        "summary",
        "You are an assistant providing a 1-sentence stream summary. Return JSON: { \"summary\": \"...\" }",
        prompt
      );
      if (res && res.summary) {
        this.rollingSummary = res.summary;
      }
    } catch {
      // keep current summary
    }
  }

  public clear() {
    this.chunks = [];
    this.rollingSummary = "Streamer is broadcasting.";
  }
}

export const contextBuffer = new ContextBuffer();
