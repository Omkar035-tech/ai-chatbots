import { config } from "../config";
import { LLMProvider, LLMRequestOptions, LLMTask, ProviderHealth, ProviderStat } from "./types";
import { GeminiProvider } from "./providers/gemini";
import { GroqProvider } from "./providers/groq";
import { OpenRouterProvider } from "./providers/openrouter";
import { getLocalFallbackResponse } from "./fallback";
import Redis from "ioredis";

export class LLMRouter {
  private providers: Map<string, LLMProvider> = new Map();
  private healthState: Map<string, ProviderHealth> = new Map();
  private redis: Redis | null = null;
  private activeProviderName: string = "none";

  constructor(redisClient?: Redis) {
    if (redisClient) {
      this.redis = redisClient;
    }

    const gemini = new GeminiProvider();
    const groq = new GroqProvider();
    const openrouter = new OpenRouterProvider();

    this.providers.set(gemini.name, gemini);
    this.providers.set(groq.name, groq);
    this.providers.set(openrouter.name, openrouter);

    for (const name of ["gemini", "groq", "openrouter"]) {
      this.healthState.set(name, {
        name,
        healthy: true,
        cooldownUntil: null,
        failCount: 0,
        lastError: null,
        callsThisMinute: 0,
        lastMinuteReset: Date.now(),
        totalCalls: 0,
      });
    }

    this.loadHealthFromRedis();
  }

  public setRedis(redisClient: Redis) {
    this.redis = redisClient;
    this.loadHealthFromRedis();
  }

  private async loadHealthFromRedis() {
    if (!this.redis) return;
    try {
      for (const name of ["gemini", "groq", "openrouter"]) {
        const data = await this.redis.hgetall(`llm:health:${name}`);
        if (data && data.cooldown_until) {
          const cooldownUntil = parseInt(data.cooldown_until, 10);
          const failCount = parseInt(data.fail_count || "0", 10);
          const current = this.healthState.get(name);
          if (current) {
            current.cooldownUntil = cooldownUntil > Date.now() ? cooldownUntil : null;
            current.healthy = current.cooldownUntil === null;
            current.failCount = failCount;
            current.lastError = data.last_error || null;
          }
        }
      }
    } catch {
      // ignore redis load error
    }
  }

  private async syncHealthToRedis(name: string) {
    if (!this.redis) return;
    const health = this.healthState.get(name);
    if (!health) return;
    try {
      await this.redis.hset(`llm:health:${name}`, {
        cooldown_until: health.cooldownUntil?.toString() || "",
        fail_count: health.failCount.toString(),
        last_error: health.lastError || "",
      });
    } catch {
      // ignore redis write error
    }
  }

  private updateRateLimitWindow(health: ProviderHealth) {
    const now = Date.now();
    if (now - health.lastMinuteReset > 60000) {
      health.callsThisMinute = 0;
      health.lastMinuteReset = now;
    }
  }

  private isProviderAvailable(name: string): boolean {
    const health = this.healthState.get(name);
    if (!health) return false;

    this.updateRateLimitWindow(health);

    const now = Date.now();
    if (health.cooldownUntil) {
      if (now >= health.cooldownUntil) {
        // Cooldown has elapsed -> auto re-enable
        health.cooldownUntil = null;
        health.healthy = true;
        health.failCount = 0;
        this.syncHealthToRedis(name);
        return true;
      }
      return false;
    }

    // Budget awareness: if > 14 calls per minute on free tier, rotate out
    if (health.callsThisMinute >= 14) {
      return false;
    }

    return health.healthy;
  }

  private recordSuccess(name: string) {
    const health = this.healthState.get(name);
    if (!health) return;
    health.failCount = 0;
    health.healthy = true;
    health.cooldownUntil = null;
    health.callsThisMinute++;
    health.totalCalls++;
    this.activeProviderName = name;
    this.syncHealthToRedis(name);
  }

  private recordFailure(name: string, error: any) {
    const health = this.healthState.get(name);
    if (!health) return;

    health.failCount++;
    const retrySec = error?.retryAfterSec || Math.min(30 * Math.pow(2, health.failCount - 1), 300);
    health.cooldownUntil = Date.now() + retrySec * 1000;
    health.healthy = false;
    health.lastError = error?.message || "Unknown error";

    console.warn(
      `[LLMRouter] Provider "${name}" failed (${health.failCount}x). Cooling down for ${retrySec}s. Reason: ${health.lastError}`
    );

    this.syncHealthToRedis(name);
  }

  public getProviderStats(): ProviderStat[] {
    const stats: ProviderStat[] = [];
    for (const [name, health] of this.healthState.entries()) {
      this.updateRateLimitWindow(health);
      stats.push({
        name,
        healthy: this.isProviderAvailable(name),
        cooldownUntil: health.cooldownUntil,
        callsPerMin: health.callsThisMinute,
        active: this.activeProviderName === name,
      });
    }
    return stats;
  }

  public async complete_json(
    task: LLMTask,
    systemPrompt: string,
    userPrompt: string,
    schema?: any,
    extraContext?: any
  ): Promise<any> {
    const taskPriority =
      task === "director" ? config.priority.director : config.priority.writer;

    const timeoutMs = task === "director" ? 6000 : 10000;

    // Filter candidate providers according to priority order
    const orderedCandidateNames: string[] = [];
    for (const p of taskPriority) {
      if (this.providers.has(p)) {
        orderedCandidateNames.push(p);
      }
    }
    for (const p of ["gemini", "groq", "openrouter"]) {
      if (!orderedCandidateNames.includes(p) && this.providers.has(p)) {
        orderedCandidateNames.push(p);
      }
    }

    // Try healthy providers in order
    for (const providerName of orderedCandidateNames) {
      if (!this.isProviderAvailable(providerName)) {
        continue;
      }

      const provider = this.providers.get(providerName)!;
      try {
        const result = await provider.completeJson({
          task,
          systemPrompt,
          userPrompt,
          schema,
          timeoutMs,
        });

        // Basic verification
        if (!result || typeof result !== "object") {
          throw new Error("Invalid non-object JSON returned from LLM provider");
        }

        this.recordSuccess(providerName);
        return result;
      } catch (err: any) {
        this.recordFailure(providerName, err);
        // Failover: loop immediately proceeds to next provider in priority order
      }
    }

    // If all healthy providers failed or none are available, log warning and use local fallback
    console.warn(`[LLMRouter] All providers exhausted or in cooldown for task "${task}". Using local fallback template.`);
    this.activeProviderName = "local_fallback";
    return getLocalFallbackResponse(task, userPrompt, extraContext);
  }
}

export const llmRouter = new LLMRouter();
