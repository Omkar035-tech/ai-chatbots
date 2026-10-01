import { messageBank, BankMessage } from "../bank/store";
import { safetyFilter } from "./safety";
import { apiBudget } from "../llm/budget";
import { llmRouter } from "../llm/router";
import Redis from "ioredis";

export interface PinnedMoment {
  id: string;
  quote: string;
  event_type: string;
  intensity: number;
  entities: string[];
  joke_tags: string[];
  absurd: boolean;
  ts: number;
}

export class BatchJobRunner {
  private redis: Redis | null = null;
  private isRunning: boolean = false;
  private lastRunTs: number = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastStreamId: string = "0";

  // In-memory transcript buffer fallback if Redis stream is unavailable
  private memoryTranscriptBuffer: Array<{ text: string; ts: number }> = [];
  private pinnedMoments: Map<string, PinnedMoment> = new Map();

  constructor(redisClient?: Redis | null) {
    if (redisClient) this.redis = redisClient;
  }

  public setRedis(redisClient: Redis) {
    this.redis = redisClient;
  }

  public appendTranscript(text: string, ts: number = Date.now(), audioLevel: number = 0) {
    this.memoryTranscriptBuffer.push({ text, ts });
    // Keep last 60 minutes
    const cutoff = Date.now() - 3600 * 1000;
    this.memoryTranscriptBuffer = this.memoryTranscriptBuffer.filter((m) => m.ts >= cutoff);

    if (this.redis) {
      try {
        this.redis.xadd(
          "transcript:stream",
          "MAXLEN",
          "~",
          "1000",
          "*",
          "ts",
          ts.toString(),
          "text",
          text,
          "audioLevel",
          audioLevel.toString()
        );
      } catch {}
    }
  }

  public startSchedule() {
    if (this.timer) clearTimeout(this.timer);

    const scheduleNext = () => {
      const intervalSec = parseInt(process.env.BATCH_INTERVAL_SEC || "240", 10);
      // ±40s natural jitter
      const jitterSec = Math.floor(Math.random() * 80) - 40;
      const delayMs = Math.max(120, intervalSec + jitterSec) * 1000;

      this.timer = setTimeout(async () => {
        await this.runCycle();
        scheduleNext();
      }, delayMs);
    };

    scheduleNext();
    console.log("[BatchJob] Scheduled Tier 1 batch refills.");
  }

  public async checkLowWaterRefill(): Promise<boolean> {
    const timeSinceLast = Date.now() - this.lastRunTs;
    if (timeSinceLast < 120 * 1000) return false; // Minimum 120s cooldown

    const unusedCount = await messageBank.getUnusedCount();
    const lowWater = parseInt(process.env.BANK_LOW_WATER || "120", 10);

    if (unusedCount < lowWater && apiBudget.canRunBatchCycle()) {
      console.log(`[BatchJob] Bank unused (${unusedCount}) below low water (${lowWater}). Triggering early refill...`);
      await this.runCycle();
      return true;
    }
    return false;
  }

  public async runCycle(): Promise<number> {
    if (this.isRunning) return 0;
    if (!apiBudget.canRunBatchCycle()) {
      console.warn("[BatchJob] Hourly batch API budget reached. Serving from existing bank.");
      return 0;
    }

    this.isRunning = true;
    this.lastRunTs = Date.now();
    console.log("[BatchJob] Starting Tier 1 batch cycle...");

    try {
      // 1. Fetch transcript chunks since last cursor
      const transcriptLines = await this.readTranscriptSinceCursor();
      const combinedText = transcriptLines.length > 0
        ? transcriptLines.map((t) => t.text).join(" ")
        : "Streamer is playing games, interacting with viewers, joking and testing builds.";

      // 2. Query LLM with compact line format prompt
      const prompt = this.buildBatchPrompt(combinedText);
      const rawOutput = await this.callBatchLLM(prompt);

      if (!rawOutput) {
        console.warn("[BatchJob] No output received from LLM, bank remains intact.");
        return 0;
      }

      // 3. Parse line-by-line truncation-tolerant format
      const { moments, messages } = this.parseLineFormat(rawOutput);

      // 4. Save pinned moments into moments:pins
      await this.savePinnedMoments(moments);

      // 5. Safety filter and add to message bank
      let admittedCount = 0;
      const validMessages: BankMessage[] = [];

      for (const msg of messages) {
        const validation = await safetyFilter.validateMessage(msg.text, "system");
        if (validation.valid && validation.cleanedText) {
          validMessages.push({
            id: `b_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${admittedCount}`,
            text: validation.cleanedText,
            event_type: msg.event_type || "funny",
            intensity: Math.min(10, Math.max(1, msg.intensity || 7)),
            style_tag: msg.style_tag || "lowercase_casual",
            moment_id: msg.moment_id || "-",
            slots: this.detectSlots(validation.cleanedText),
            created_at: Date.now(),
            used_count: 0,
            last_used: 0,
          });
          admittedCount++;
        }
      }

      if (validMessages.length > 0) {
        await messageBank.addBatch(validMessages);
        apiBudget.recordBatchCycle();
        console.log(`[BatchJob] Cycle completed: ${validMessages.length} fresh messages added to bank (${moments.length} moments pinned).`);
      }

      return validMessages.length;
    } catch (err: any) {
      console.warn("[BatchJob] Cycle failed, falling back to local bank:", err.message);
      return 0;
    } finally {
      this.isRunning = false;
    }
  }

  private async readTranscriptSinceCursor(): Promise<Array<{ text: string; ts: number }>> {
    if (this.redis) {
      try {
        const res: any = await this.redis.xread("COUNT", 200, "STREAMS", "transcript:stream", this.lastStreamId);
        if (res && res[0] && res[0][1]) {
          const entries = res[0][1];
          const chunks: Array<{ text: string; ts: number }> = [];
          for (const item of entries) {
            this.lastStreamId = item[0];
            const fields = item[1];
            let text = "";
            let ts = Date.now();
            for (let i = 0; i < fields.length; i += 2) {
              if (fields[i] === "text") text = fields[i + 1];
              if (fields[i] === "ts") ts = parseInt(fields[i + 1], 10);
            }
            if (text) chunks.push({ text, ts });
          }
          return chunks;
        }
      } catch {}
    }

    const recent = this.memoryTranscriptBuffer.slice(-15);
    return recent;
  }

  private buildBatchPrompt(transcriptText: string): string {
    return `You are a stream chat batch generator for Twitch/Kick streams.
Analyze this recent streamer transcript and generate:
1. Pinned high-impact moments (#MOMENTS)
2. 350+ diverse, realistic chat reaction lines (#MESSAGES) in compact line format.

DISTRIBUTION REQUIREMENTS (350+ lines total):
- 40% tied to specific words/entities in the transcript (quote exact names/events)
- 20% about the current game / gameplay context
- 15% callbacks / running jokes from earlier moments (e.g. "still thinking about X", "X update?")
- 15% generic reactions (confusion, disbelief, hype, light roast, "??", "no way", "huh")
- 10% ambient chatter (greetings, lurker comments, casual questions)

MOMENT ARCHETYPES TO MIX:
confusion ("what are you talking about", "huh??")
disbelief ("no way", "nahh")
roast ("skill issue", "who let him cook")
short/one-word ("??", "lol", "rip", "oof")
follow-up questions ("which month", "wait is he a guy")
specific jokes
memes/Twitch emotes (KEKW, Pog, Sadge, GIGACHAD, monkaS)

FEW-SHOT EXAMPLE:
Quote: "George fell from the table and got pregnant" -> Event: funny, Intensity: 8
Good lines:
funny|8|lowercase_casual|m1|bro wtf
funny|8|lowercase_casual|m1|what are you talking about
funny|8|lowercase_casual|m1|ooh hell nah
funny|8|lowercase_casual|m1|george cooked without oil
funny|8|question_asker|m1|george which month
funny|8|question_asker|m1|wait george is a guy??
funny|8|lowercase_casual|m1|chat did he just say that
funny|8|caps_hype|m1|LMAOOOO
funny|8|lowercase_casual|m1|rip george
funny|8|lowercase_casual|m1|ok who let george near the table

OUTPUT FORMAT (COMPACT, TRUNCATION-TOLERANT LINE FORMAT):
#MOMENTS
{"moments":[{"id":"m1","quote":"...","event_type":"funny","intensity":8,"entities":["george"],"joke_tags":["george pregnant"],"absurd":true}]}
#MESSAGES
event_type|intensity|style_tag|moment_id_or_-|text

RECENT STREAMER TRANSCRIPT:
"${transcriptText.slice(0, 2500)}"`;
  }

  private async callBatchLLM(prompt: string): Promise<string> {
    const raw = await llmRouter.complete_raw(
      "You are a Twitch stream chat writer generating a bulk batch of 350+ chat messages.",
      prompt,
      4000
    );
    return raw;
  }

  public parseLineFormat(output: string): { moments: PinnedMoment[]; messages: Array<any> } {
    const moments: PinnedMoment[] = [];
    const messages: Array<any> = [];

    const lines = output.split(/\r?\n/);
    let inMoments = false;
    let inMessages = false;
    let momentsJsonAccumulator = "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith("#MOMENTS")) {
        inMoments = true;
        inMessages = false;
        continue;
      }

      if (line.startsWith("#MESSAGES")) {
        inMoments = false;
        inMessages = true;
        if (momentsJsonAccumulator) {
          try {
            const parsed = JSON.parse(momentsJsonAccumulator);
            if (parsed && Array.isArray(parsed.moments)) {
              for (const m of parsed.moments) {
                moments.push({ ...m, ts: Date.now() });
              }
            }
          } catch {}
          momentsJsonAccumulator = "";
        }
        continue;
      }

      if (inMoments) {
        momentsJsonAccumulator += line;
      } else if (inMessages) {
        // Line format: event_type|intensity|style_tag|moment_id_or_-|text
        const parts = line.split("|");
        if (parts.length >= 5) {
          const event_type = parts[0].trim().toLowerCase();
          const intensity = parseInt(parts[1].trim(), 10) || 7;
          const style_tag = parts[2].trim();
          const moment_id = parts[3].trim();
          const text = parts.slice(4).join("|").trim();

          if (text && text.length >= 2 && text.length <= 150) {
            messages.push({
              event_type,
              intensity,
              style_tag,
              moment_id,
              text,
            });
          }
        }
      }
    }

    return { moments, messages };
  }

  private async savePinnedMoments(moments: PinnedMoment[]) {
    for (const m of moments) {
      this.pinnedMoments.set(m.id, m);
      if (this.redis) {
        try {
          await this.redis.zadd("moments:pins", m.ts || Date.now(), JSON.stringify(m));
        } catch {}
      }
    }
  }

  public async getPinnedMoments(limit: number = 10): Promise<PinnedMoment[]> {
    if (this.redis) {
      try {
        const raw = await this.redis.zrevrange("moments:pins", 0, limit - 1);
        return raw.map((r) => JSON.parse(r));
      } catch {}
    }
    return Array.from(this.pinnedMoments.values()).slice(-limit);
  }

  private detectSlots(text: string): string[] {
    const slots: string[] = [];
    if (/\{subject\}/i.test(text)) slots.push("subject");
    if (/\{entity\}/i.test(text)) slots.push("entity");
    return slots;
  }
}

export const batchJob = new BatchJobRunner();
