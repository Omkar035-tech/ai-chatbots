import { serverSTT, ServerTranscriptEvent } from "../stt";
import { localHypeDetector, HypeMoment, SignalBreakdown } from "./hype_detector";
import { localMatcher } from "./local_matcher";
import { chatHumanizer } from "./humanizer";
import { chatScheduler } from "./scheduler";
import { personaStore } from "../personas/store";
import { messageBank } from "../bank/store";
import { batchJob } from "./batch_job";
import { callbackManager } from "./callbacks";
import { apiBudget } from "../llm/budget";
import { reactiveCallGenerator } from "./reactive_call";
import { pubSub } from "../../graphql/pubsub";
import { llmRouter } from "../llm/router";

export interface HypeTelemetryPayload {
  score: number;
  state: string;
  signals: Array<{ name: string; value: number; weight: number; contribution: number }>;
  momentQuote: string | null;
  eventType: string | null;
  intensity: number | null;
  tierUsed: string;
  bankTotalCount: number;
  bankUnusedCount: number;
  batchCyclesLastHour: number;
  reactiveCallsLastHour: number;
  totalApiCallsLastHour: number;
  blockedRequestsCount: number;
  ts: number;
}

export class PipelineOrchestrator {
  private lastReactionTs: number = 0;
  private lastTierUsed: string = "tier0";
  private latestTelemetry: HypeTelemetryPayload;
  private isProcessing: boolean = false;
  private ambientInterval: NodeJS.Timeout | null = null;
  private statsInterval: NodeJS.Timeout | null = null;
  private nextAmbientThresholdSec: number = 60;

  constructor() {
    this.latestTelemetry = {
      score: 0,
      state: "IDLE",
      signals: [],
      momentQuote: null,
      eventType: null,
      intensity: null,
      tierUsed: "none",
      bankTotalCount: 500,
      bankUnusedCount: 500,
      batchCyclesLastHour: 0,
      reactiveCallsLastHour: 0,
      totalApiCallsLastHour: 0,
      blockedRequestsCount: 0,
      ts: Date.now(),
    };

    // Scheduler callback to publish released messages
    chatScheduler.setOnPublish((chatItem) => {
      pubSub.publish("chatMessage", chatItem);
    });

    // Listen to transcripts from serverSTT
    serverSTT.onTranscript((event: ServerTranscriptEvent) => {
      this.handleTranscriptEvent(event);
    });
  }

  public init() {
    // Start background batch refills
    batchJob.startSchedule();
    this.startAmbientChatterLoop();
    this.startStatsLoop();
    console.log("[Pipeline] Local Orchestrator initialized (Tier 0 Live + Tier 1 Batch + Tier 2 Reactive).");
  }

  public getTelemetry(): HypeTelemetryPayload {
    return this.latestTelemetry;
  }

  private async handleTranscriptEvent(event: ServerTranscriptEvent) {
    // Publish transcript to GraphQL subscription for live UI feedback
    pubSub.publish("transcript", event.text);

    // Ingest into Redis Stream / memory buffer for Tier 1 batch processing
    const audioLevel = (event as any).audioLevel || 0;
    batchJob.appendTranscript(event.text, event.timestamp, audioLevel);

    // Evaluate live transcript locally (0 API calls)
    if (event.text.trim()) {
      await this.processTranscript(event.text.trim(), audioLevel, event.timestamp, event.is_final);
    }
  }

  public async processTranscript(
    text: string,
    audioLevel: number = 0,
    timestamp: number = Date.now(),
    isFinal: boolean = true
  ) {
    const settings = await personaStore.getSettings();
    if (!settings.enabled) return;

    // 1. Evaluate with local multi-signal Hype Detector (0 LLM calls)
    const evaluated = localHypeDetector.evaluate(text, audioLevel, timestamp);

    // Prepare signals list for telemetry
    const signalsList = Object.entries(evaluated.signals).map(([name, s]) => ({
      name,
      value: s.value,
      weight: s.weight,
      contribution: s.contribution,
    }));

    // Update telemetry state
    const budgetTelem = apiBudget.getTelemetry();
    const bankUnused = await messageBank.getUnusedCount();
    const bankTotal = await messageBank.getTotalCount();

    this.latestTelemetry = {
      score: evaluated.score,
      state: evaluated.state,
      signals: signalsList,
      momentQuote: evaluated.moment?.quote || null,
      eventType: evaluated.moment?.event_type || null,
      intensity: evaluated.moment?.intensity || null,
      tierUsed: this.lastTierUsed,
      bankTotalCount: bankTotal,
      bankUnusedCount: bankUnused,
      batchCyclesLastHour: budgetTelem.batchCyclesLastHour,
      reactiveCallsLastHour: budgetTelem.reactiveCallsLastHour,
      totalApiCallsLastHour: budgetTelem.totalCallsLastHour,
      blockedRequestsCount: reactiveCallGenerator.getBlockedCount(),
      ts: Date.now(),
    };

    pubSub.publish("hypeTelemetry", this.latestTelemetry);

    // 2. If a moment is detected or peaked, trigger live reaction
    if (evaluated.moment && isFinal) {
      if (this.isProcessing) return;
      this.isProcessing = true;

      try {
        const activePersonas = await personaStore.getActivePersonas();
        if (activePersonas.length === 0) return;

        // Match messages locally, fill slots, humanize, or escalate to Tier 2
        const matchResult = await localMatcher.match(evaluated.moment, activePersonas, settings);

        if (matchResult.messages.length > 0) {
          this.lastReactionTs = Date.now();
          this.lastTierUsed = matchResult.tierUsed;
          this.latestTelemetry.tierUsed = matchResult.tierUsed;
          pubSub.publish("hypeTelemetry", this.latestTelemetry);

          // Schedule callback running jokes 20s to 5min later
          if (evaluated.moment.entities && evaluated.moment.entities.length > 0) {
            callbackManager.scheduleCallbacksForMoment(
              evaluated.moment.moment_id,
              evaluated.moment.entities,
              settings.speedMultiplier
            );
          }

          // Schedule chat burst
          chatScheduler.scheduleBatch(
            matchResult.messages,
            evaluated.moment.intensity,
            settings.speedMultiplier
          );

          // Check if message bank requires early refill
          batchJob.checkLowWaterRefill().catch(() => {});
        }
      } catch (err: any) {
        console.error("[Pipeline] Error processing moment reaction:", err.message);
      } finally {
        this.isProcessing = false;
      }
    }
  }

  public async triggerManualReaction(kind: string, customText?: string): Promise<boolean> {
    const settings = await personaStore.getSettings();
    const activePersonas = await personaStore.getActivePersonas();
    if (activePersonas.length === 0) return false;

    let eventType: any = "win";
    let intensity = 7;
    let quote = customText || `Streamer triggered ${kind} event!`;

    if (kind === "troll") {
      eventType = "rage";
      intensity = 8;
    } else if (kind === "question") {
      eventType = "question";
      intensity = 5;
    } else if (kind === "funny" || kind === "absurd") {
      eventType = "funny";
      intensity = 8;
    }

    const syntheticMoment: HypeMoment = {
      moment_id: `manual_${Date.now()}`,
      start_ts: Date.now(),
      peak_ts: Date.now(),
      quote,
      event_type: eventType,
      intensity,
      entities: localHypeDetector.extractEntities(quote),
      absurd: kind === "absurd",
      signals: {},
      hype_score: intensity,
    };

    const matchResult = await localMatcher.match(syntheticMoment, activePersonas, settings);

    if (matchResult.messages.length > 0) {
      this.lastReactionTs = Date.now();
      this.lastTierUsed = matchResult.tierUsed;
      chatScheduler.scheduleBatch(matchResult.messages, intensity, settings.speedMultiplier);
      return true;
    }

    return false;
  }

  private startAmbientChatterLoop() {
    if (this.ambientInterval) clearInterval(this.ambientInterval);

    this.nextAmbientThresholdSec = Math.floor(Math.random() * 45) + 35; // 35-80 seconds

    this.ambientInterval = setInterval(async () => {
      try {
        const settings = await personaStore.getSettings();
        if (!settings.enabled || !settings.ambientChatter) return;

        const timeSinceLastReactionSec = (Date.now() - this.lastReactionTs) / 1000;
        if (timeSinceLastReactionSec >= this.nextAmbientThresholdSec) {
          this.nextAmbientThresholdSec = Math.floor(Math.random() * 50) + 35;

          const activePersonas = await personaStore.getActivePersonas();
          if (activePersonas.length === 0) return;

          // Pull candidate ambient message from Message Bank (0 API calls!)
          const candidates = await messageBank.fetchCandidates("quiet", 1, 5);
          if (candidates.length === 0) return;

          const chosen = candidates[Math.floor(Math.random() * candidates.length)];
          const persona = activePersonas[Math.floor(Math.random() * activePersonas.length)];

          const humanized = chatHumanizer.humanizeMessage(chosen.text, persona, 1);
          if (humanized.accepted) {
            await messageBank.markUsed(chosen.id);
            chatScheduler.scheduleBatch(
              [
                {
                  personaId: persona.id,
                  username: persona.name,
                  color: persona.color,
                  text: humanized.text,
                  kind: "ambient",
                },
              ],
              1,
              settings.speedMultiplier
            );
          }
        }
      } catch (err: any) {
        console.warn("[Pipeline] Ambient loop error:", err.message);
      }
    }, 12000);
  }

  private startStatsLoop() {
    if (this.statsInterval) clearInterval(this.statsInterval);

    this.statsInterval = setInterval(async () => {
      const stats = llmRouter.getProviderStats();
      pubSub.publish("providerStats", stats);

      const budgetTelem = apiBudget.getTelemetry();
      const bankUnused = await messageBank.getUnusedCount();
      const bankTotal = await messageBank.getTotalCount();

      this.latestTelemetry.batchCyclesLastHour = budgetTelem.batchCyclesLastHour;
      this.latestTelemetry.reactiveCallsLastHour = budgetTelem.reactiveCallsLastHour;
      this.latestTelemetry.totalApiCallsLastHour = budgetTelem.totalCallsLastHour;
      this.latestTelemetry.bankTotalCount = bankTotal;
      this.latestTelemetry.bankUnusedCount = bankUnused;
      this.latestTelemetry.blockedRequestsCount = reactiveCallGenerator.getBlockedCount();

      pubSub.publish("hypeTelemetry", this.latestTelemetry);
    }, 3000);
  }
}

export const pipelineOrchestrator = new PipelineOrchestrator();
