import Redis from "ioredis";

export interface BudgetTelemetry {
  batchCyclesLastHour: number;
  reactiveCallsLastHour: number;
  totalCallsLastHour: number;
  canRunBatch: boolean;
  canRunReactive: boolean;
  reactiveCooldownRemainingSec: number;
}

export class ApiBudgetGovernor {
  private redis: Redis | null = null;

  // Configuration caps
  private maxBatchPerHour: number = 20;
  private maxReactivePerHour: number = 20;
  private minReactiveIntervalMs: number = 90 * 1000; // 90 seconds

  // Memory fallback state
  private batchTimestamps: number[] = [];
  private reactiveTimestamps: number[] = [];
  private lastReactiveCallTs: number = 0;

  constructor(redisClient?: Redis | null) {
    if (redisClient) this.redis = redisClient;
  }

  public setRedis(redisClient: Redis) {
    this.redis = redisClient;
  }

  public canRunBatchCycle(): boolean {
    this.pruneOldTimestamps();
    return this.batchTimestamps.length < this.maxBatchPerHour;
  }

  public canRunReactiveCall(): boolean {
    if (process.env.REACTIVE_CALLS === "off") {
      return false;
    }

    this.pruneOldTimestamps();
    const now = Date.now();
    const timeSinceLast = now - this.lastReactiveCallTs;
    if (timeSinceLast < this.minReactiveIntervalMs) {
      return false;
    }

    return this.reactiveTimestamps.length < this.maxReactivePerHour;
  }

  public recordBatchCycle(provider: string = "default") {
    const now = Date.now();
    this.batchTimestamps.push(now);
    this.incrementRedisCounters("batch", provider, now);
  }

  public recordReactiveCall(provider: string = "default") {
    const now = Date.now();
    this.reactiveTimestamps.push(now);
    this.lastReactiveCallTs = now;
    this.incrementRedisCounters("reactive", provider, now);
  }

  private pruneOldTimestamps() {
    const oneHourAgo = Date.now() - 3600 * 1000;
    this.batchTimestamps = this.batchTimestamps.filter((t) => t >= oneHourAgo);
    this.reactiveTimestamps = this.reactiveTimestamps.filter((t) => t >= oneHourAgo);
  }

  private async incrementRedisCounters(type: "batch" | "reactive", provider: string, now: number) {
    if (!this.redis) return;
    try {
      const hourKey = `api:budget:${provider}:hour`;
      const minKey = `api:budget:${provider}:minute`;
      const typeKey = `api:budget:${type}:hour`;

      const p = this.redis.pipeline();
      p.incr(hourKey);
      p.expire(hourKey, 3600);
      p.incr(minKey);
      p.expire(minKey, 60);
      p.incr(typeKey);
      p.expire(typeKey, 3600);
      await p.exec();
    } catch {}
  }

  public getTelemetry(): BudgetTelemetry {
    this.pruneOldTimestamps();
    const now = Date.now();
    const timeSinceLastReactive = now - this.lastReactiveCallTs;
    const cooldownRemaining = Math.max(0, Math.ceil((this.minReactiveIntervalMs - timeSinceLastReactive) / 1000));

    return {
      batchCyclesLastHour: this.batchTimestamps.length,
      reactiveCallsLastHour: this.reactiveTimestamps.length,
      totalCallsLastHour: this.batchTimestamps.length + this.reactiveTimestamps.length,
      canRunBatch: this.canRunBatchCycle(),
      canRunReactive: this.canRunReactiveCall(),
      reactiveCooldownRemainingSec: cooldownRemaining,
    };
  }
}

export const apiBudget = new ApiBudgetGovernor();
