import { llmRouter } from "../llm/router";
import fs from "fs";
import path from "path";

export interface DirectorDecisionResult {
  react: boolean;
  eventType: string;
  intensity: number;
  reason: string;
  suggestedReactionTypes: string[];
  ts: number;
}

export class Director {
  private systemPrompt: string = "";

  constructor() {
    try {
      const promptPath = path.join(process.cwd(), "src/server/llm/prompts/director.txt");
      if (fs.existsSync(promptPath)) {
        this.systemPrompt = fs.readFileSync(promptPath, "utf-8");
      }
    } catch {
      // fallback handled in router
    }
  }

  public async evaluate(
    recentTranscript: string,
    rollingSummary: string,
    hints: string[],
    timeSinceLastReactionMs: number,
    momentDepth: number
  ): Promise<DirectorDecisionResult> {
    const userPrompt = JSON.stringify({
      recent_transcript: recentTranscript,
      rolling_summary: rollingSummary,
      prefilter_hints: hints,
      seconds_since_last_reaction: Math.round(timeSinceLastReactionMs / 1000),
      moment_depth_setting: momentDepth,
    });

    try {
      const raw = await llmRouter.complete_json(
        "director",
        this.systemPrompt,
        `Evaluate this streamer context:\n${userPrompt}`
      );

      const react =
        raw?.react === true ||
        raw?.react === "yes" ||
        raw?.react === "YES" ||
        (typeof raw?.react === "string" && raw.react.toLowerCase() === "yes");

      let rawIntensity = typeof raw?.intensity === "number" ? raw.intensity : react ? 5 : 0;
      // Moment depth bias: shifts intensity (-5 to +5)
      const depthBias = (momentDepth - 5);
      const intensity = Math.min(10, Math.max(0, rawIntensity + depthBias));

      return {
        react,
        eventType: raw?.event_type || (react ? "funny" : "boring"),
        intensity,
        reason: raw?.reason || (react ? "Reaction warranted" : "Low energy"),
        suggestedReactionTypes: Array.isArray(raw?.suggested_reaction_types)
          ? raw.suggested_reaction_types
          : ["troll", "hype"],
        ts: Date.now(),
      };
    } catch (err: any) {
      console.warn("[Director] Evaluation error:", err.message);
      return {
        react: false,
        eventType: "boring",
        intensity: 0,
        reason: "Director evaluation failed",
        suggestedReactionTypes: [],
        ts: Date.now(),
      };
    }
  }
}

export const director = new Director();
