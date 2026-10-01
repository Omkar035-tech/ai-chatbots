import Redis from "ioredis";
import fs from "fs";
import path from "path";

export interface BankMessage {
  id: string;
  text: string;
  event_type: string;
  intensity: number;
  style_tag: string;
  moment_id?: string;
  slots?: string[];
  created_at: number;
  used_count: number;
  last_used: number;
}

export class MessageBankStore {
  private redis: Redis | null = null;
  private isConnected: boolean = false;

  // In-memory fallback
  private memoryMessages: Map<string, BankMessage> = new Map();
  private memoryIndex: Map<string, Set<string>> = new Map(); // key: `${event_type}:${bucket}`
  private lowWaterThreshold: number = 120;

  constructor(redisClient?: Redis | null) {
    if (redisClient) {
      this.redis = redisClient;
    }
  }

  public setRedis(redisClient: Redis) {
    this.redis = redisClient;
    this.isConnected = true;
  }

  public getBucket(intensity: number): "low" | "mid" | "high" {
    if (intensity <= 3) return "low";
    if (intensity <= 6) return "mid";
    return "high";
  }

  public async init(): Promise<void> {
    const unusedCount = await this.getUnusedCount();
    if (unusedCount < this.lowWaterThreshold) {
      console.log(`[MessageBank] Bank unused count (${unusedCount}) below threshold. Seeding from seed-bank.json...`);
      await this.seedFromLocalFile();
    }
  }

  private async seedFromLocalFile() {
    try {
      const seedPath = path.join(process.cwd(), "src/server/bank/seed-bank.json");
      if (!fs.existsSync(seedPath)) {
        console.warn("[MessageBank] seed-bank.json not found at", seedPath);
        return;
      }
      const raw = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
      if (Array.isArray(raw)) {
        const messages: BankMessage[] = raw.map((item: any, idx: number) => ({
          id: item.id || `seed_${Date.now()}_${idx}`,
          text: item.text,
          event_type: item.event_type || "funny",
          intensity: item.intensity || 7,
          style_tag: item.style_tag || "lowercase_casual",
          moment_id: item.moment_id || "-",
          slots: Array.isArray(item.slots) ? item.slots : [],
          created_at: Date.now(),
          used_count: 0,
          last_used: 0,
        }));

        await this.addBatch(messages);
        console.log(`[MessageBank] Successfully loaded ${messages.length} messages into bank.`);
      }
    } catch (err: any) {
      console.warn("[MessageBank] Error seeding messages:", err.message);
    }
  }

  public async addBatch(items: BankMessage[]): Promise<number> {
    let addedCount = 0;

    if (this.redis) {
      try {
        const pipeline = this.redis.pipeline();
        for (const msg of items) {
          const bucket = this.getBucket(msg.intensity);
          const indexKey = `bank:idx:${msg.event_type}:${bucket}`;

          pipeline.hset(`bank:msg:${msg.id}`, {
            id: msg.id,
            text: msg.text,
            event_type: msg.event_type,
            intensity: msg.intensity.toString(),
            style_tag: msg.style_tag,
            moment_id: msg.moment_id || "-",
            slots: JSON.stringify(msg.slots || []),
            created_at: msg.created_at.toString(),
            used_count: msg.used_count.toString(),
            last_used: msg.last_used.toString(),
          });

          pipeline.sadd(indexKey, msg.id);
          pipeline.sadd("bank:unused:set", msg.id);
        }
        await pipeline.exec();
        addedCount = items.length;
      } catch (err: any) {
        console.warn("[MessageBank] Redis addBatch failed, falling back to memory:", err.message);
      }
    }

    // Always mirror to memory
    for (const msg of items) {
      this.memoryMessages.set(msg.id, { ...msg });
      const bucket = this.getBucket(msg.intensity);
      const indexKey = `${msg.event_type}:${bucket}`;
      if (!this.memoryIndex.has(indexKey)) {
        this.memoryIndex.set(indexKey, new Set());
      }
      this.memoryIndex.get(indexKey)!.add(msg.id);
    }

    return addedCount || items.length;
  }

  public async getUnusedCount(): Promise<number> {
    if (this.redis) {
      try {
        const count = await this.redis.scard("bank:unused:set");
        return count;
      } catch {}
    }

    let count = 0;
    for (const msg of this.memoryMessages.values()) {
      if (msg.used_count === 0) count++;
    }
    return count;
  }

  public async getTotalCount(): Promise<number> {
    if (this.redis) {
      try {
        const keys = await this.redis.keys("bank:msg:*");
        if (keys.length > 0) return keys.length;
      } catch {}
    }
    return this.memoryMessages.size;
  }

  public async fetchCandidates(
    eventType: string,
    intensity: number,
    limit: number = 20,
    excludeIds: Set<string> = new Set()
  ): Promise<BankMessage[]> {
    const primaryBucket = this.getBucket(intensity);
    const adjacentBuckets: Array<"low" | "mid" | "high"> =
      primaryBucket === "mid" ? ["mid", "high", "low"] : primaryBucket === "high" ? ["high", "mid"] : ["low", "mid"];

    const candidateIds: string[] = [];

    if (this.redis) {
      try {
        for (const bucket of adjacentBuckets) {
          const indexKey = `bank:idx:${eventType}:${bucket}`;
          const ids = await this.redis.smembers(indexKey);
          for (const id of ids) {
            if (!excludeIds.has(id)) {
              candidateIds.push(id);
              if (candidateIds.length >= limit * 3) break;
            }
          }
          if (candidateIds.length >= limit * 2) break;
        }

        // If not enough event-specific candidates, mix in generic funny/win
        if (candidateIds.length < limit && eventType !== "funny") {
          const fallbackIds = await this.redis.smembers(`bank:idx:funny:${primaryBucket}`);
          for (const id of fallbackIds) {
            if (!excludeIds.has(id) && !candidateIds.includes(id)) {
              candidateIds.push(id);
            }
          }
        }

        // Hydrate from Redis
        const results: BankMessage[] = [];
        for (const id of candidateIds) {
          const data = await this.redis.hgetall(`bank:msg:${id}`);
          if (data && data.id) {
            results.push({
              id: data.id,
              text: data.text,
              event_type: data.event_type,
              intensity: parseInt(data.intensity || "5", 10),
              style_tag: data.style_tag || "lowercase_casual",
              moment_id: data.moment_id,
              slots: data.slots ? JSON.parse(data.slots) : [],
              created_at: parseInt(data.created_at || "0", 10),
              used_count: parseInt(data.used_count || "0", 10),
              last_used: parseInt(data.last_used || "0", 10),
            });
          }
          if (results.length >= limit * 2) break;
        }

        if (results.length > 0) {
          // Sort unused first, then by least recently used
          results.sort((a, b) => a.used_count - b.used_count || a.last_used - b.last_used);
          return results.slice(0, limit);
        }
      } catch (err: any) {
        console.warn("[MessageBank] Redis fetch failed, using memory:", err.message);
      }
    }

    // Memory fallback
    const memResults: BankMessage[] = [];
    for (const bucket of adjacentBuckets) {
      const idxKey = `${eventType}:${bucket}`;
      const ids = this.memoryIndex.get(idxKey) || new Set();
      for (const id of ids) {
        if (!excludeIds.has(id)) {
          const msg = this.memoryMessages.get(id);
          if (msg) memResults.push(msg);
        }
      }
    }

    if (memResults.length === 0) {
      // Return any available memory messages
      for (const msg of this.memoryMessages.values()) {
        if (!excludeIds.has(msg.id)) {
          memResults.push(msg);
          if (memResults.length >= limit) break;
        }
      }
    }

    memResults.sort((a, b) => a.used_count - b.used_count || a.last_used - b.last_used);
    return memResults.slice(0, limit);
  }

  public async markUsed(id: string): Promise<void> {
    const now = Date.now();
    if (this.redis) {
      try {
        await this.redis.hincrby(`bank:msg:${id}`, "used_count", 1);
        await this.redis.hset(`bank:msg:${id}`, "last_used", now.toString());
        await this.redis.srem("bank:unused:set", id);
      } catch {}
    }

    const mem = this.memoryMessages.get(id);
    if (mem) {
      mem.used_count++;
      mem.last_used = now;
    }
  }

  public isLowWater(count?: number): boolean {
    const c = count !== undefined ? count : this.memoryMessages.size;
    return c < this.lowWaterThreshold;
  }
}

export const messageBank = new MessageBankStore();
