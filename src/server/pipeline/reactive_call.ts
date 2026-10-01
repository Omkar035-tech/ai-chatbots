import { llmRouter } from "../llm/router";
import { apiBudget } from "../llm/budget";
import { safetyFilter } from "./safety";
import { messageBank, BankMessage } from "../bank/store";
import { HypeMoment } from "./hype_detector";

export class ReactiveCallGenerator {
  private lastCallTs: number = 0;
  private totalCalls: number = 0;
  private blockedCount: number = 0;

  public getBlockedCount(): number {
    return this.blockedCount;
  }

  public getTotalCalls(): number {
    return this.totalCalls;
  }

  /**
   * Generates 30-50 contextual chat messages for a specific novel or absurd moment.
   * Only runs if budget allows and REACTIVE_CALLS !== 'off'.
   */
  public async generateForMoment(moment: HypeMoment): Promise<BankMessage[]> {
    if (process.env.REACTIVE_CALLS === "off") {
      console.log("[ReactiveCall] Tier 2 disabled by REACTIVE_CALLS=off");
      return [];
    }

    if (!apiBudget.canRunReactiveCall()) {
      console.log("[ReactiveCall] Tier 2 throttled by budget governor (cooldown or hourly cap).");
      return [];
    }

    const now = Date.now();
    this.lastCallTs = now;
    this.totalCalls++;
    console.log(`[ReactiveCall] Triggering Tier 2 micro-call for moment: "${moment.quote}" (Event: ${moment.event_type}, Intensity: ${moment.intensity}, Absurd: ${moment.absurd})`);

    const prompt = this.buildPrompt(moment);

    try {
      // Complete with raw line-based format
      const rawOutput = await llmRouter.complete_raw(
        "Below is a transcript of a video-game streamer talking. Write funny, friendly viewer chat reactions.",
        prompt,
        1500
      );

      if (!rawOutput) {
        console.warn("[ReactiveCall] Empty output received from router. Skipping reactive micro-call.");
        return [];
      }

      const parsedLines = this.parseLines(rawOutput, moment);
      const validMessages: BankMessage[] = [];

      for (const item of parsedLines) {
        const validation = await safetyFilter.validateMessage(item.text, "system");
        if (validation.valid && validation.cleanedText) {
          validMessages.push({
            id: `r_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${validMessages.length}`,
            text: validation.cleanedText,
            event_type: moment.event_type,
            intensity: moment.intensity,
            style_tag: item.style_tag || "lowercase_casual",
            moment_id: moment.moment_id,
            slots: [],
            created_at: Date.now(),
            used_count: 0,
            last_used: 0,
          });
        }
      }

      if (validMessages.length > 0) {
        apiBudget.recordReactiveCall();
        await messageBank.addBatch(validMessages);
        console.log(`[ReactiveCall] Successfully generated and stored ${validMessages.length} tailored messages for moment ${moment.moment_id}`);
      }

      return validMessages;
    } catch (err: any) {
      if (err.message && (err.message.includes("policy") || err.message.includes("safety") || err.message.includes("400"))) {
        this.blockedCount++;
        console.warn("[ReactiveCall] Provider content-policy block detected. Falling back to bank without retrying text.");
      } else {
        console.warn("[ReactiveCall] Error during reactive micro-call:", err.message);
      }
      return [];
    }
  }

  private buildPrompt(moment: HypeMoment): string {
    const quote = moment.quote;
    const entitiesStr = moment.entities.length > 0 ? moment.entities.join(", ") : "none";

    return `Write 35-50 realistic Twitch/Kick stream chat reactions to what the streamer just said.
Streamer quote: "${quote}"
Event type: ${moment.event_type}
Intensity: ${moment.intensity}/10
Key subjects/entities: ${entitiesStr}
Absurd/Novel: ${moment.absurd ? "YES" : "NO"}

REQUIREMENTS:
- AT LEAST 60% of the messages must directly reference the exact subjects, words, or absurdity in the quote.
- Include funny disbelief, confusion, roasts, follow-up questions, short spam, and memes.
- Keep them short and natural (1 to 8 words mostly). Real chat is brief: "bruh what", "LMAO", "wait what", "george is cooked".
- DO NOT use generic filler like "chill vibes bro 💀 W" or repeat "bro ... 💀".
- Mix styles: lowercase_casual, caps_hype, short_lurker, question_asker, meme_spammer.

FEW-SHOT EXAMPLE:
Quote: "George fell from the table and got pregnant" (Event: funny, Intensity: 8)
Lines:
funny|8|lowercase_casual|bruh what
funny|8|question_asker|what are you talking about
funny|8|lowercase_casual|ooh hell nah
funny|8|lowercase_casual|george cooked without oil
funny|8|question_asker|george which month
funny|8|question_asker|wait george is a guy??
funny|8|lowercase_casual|chat did he just say that
funny|8|caps_hype|LMAOOOO
funny|8|lowercase_casual|rip george
funny|8|lowercase_casual|ok who let george near the table
funny|8|short_lurker|??
funny|8|meme_spammer|KEKW GEORGE
funny|8|lowercase_casual|bro is creating lore rn

OUTPUT FORMAT:
Return ONLY lines in the format:
event_type|intensity|style_tag|text`;
  }

  private parseLines(raw: string, moment: HypeMoment): Array<{ style_tag: string; text: string }> {
    const results: Array<{ style_tag: string; text: string }> = [];
    const lines = raw.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || line.startsWith("{") || line.startsWith("```")) continue;

      const parts = line.split("|");
      if (parts.length >= 4) {
        // event_type|intensity|style_tag|text
        const style_tag = parts[2].trim();
        const text = parts.slice(3).join("|").trim();
        if (text && text.length >= 2 && text.length <= 150) {
          results.push({ style_tag, text });
        }
      } else if (parts.length === 1 && line.length >= 2 && line.length <= 150) {
        // Fallback for plain lines
        results.push({ style_tag: "lowercase_casual", text: line });
      }
    }

    return results;
  }
}

export const reactiveCallGenerator = new ReactiveCallGenerator();
