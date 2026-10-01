import { serverSTT, ServerTranscriptEvent } from "../stt";
import { contextBuffer } from "./context_buffer";
import { preFilter } from "./prefilter";
import { director, DirectorDecisionResult } from "./director";
import { personaSelector } from "./persona_selector";
import { writer } from "./writer";
import { safetyFilter } from "./safety";
import { chatScheduler } from "./scheduler";
import { personaStore } from "../personas/store";
import { llmRouter } from "../llm/router";
import { pubSub } from "../../graphql/pubsub";
import { PersonaProfile } from "../personas/types";

export class PipelineOrchestrator {
  private lastYesTs: number = 0;
  private lastIntensity: number = 0;
  private isProcessing: boolean = false;
  private ambientInterval: NodeJS.Timeout | null = null;
  private statsInterval: NodeJS.Timeout | null = null;
  private nextAmbientThresholdSec: number = 60;

  constructor() {
    // Setup scheduler callback to publish released messages
    chatScheduler.setOnPublish((chatItem) => {
      pubSub.publish("chatMessage", chatItem);
    });

    // Listen to transcripts from serverSTT
    serverSTT.onTranscript((event: ServerTranscriptEvent) => {
      this.handleTranscriptEvent(event);
    });
  }

  public init() {
    this.startAmbientChatterLoop();
    this.startStatsLoop();
  }

  private async handleTranscriptEvent(event: ServerTranscriptEvent) {
    // Publish transcript to GraphQL subscription for live UI feedback
    pubSub.publish("transcript", event.text);

    // Add to rolling context buffer
    contextBuffer.addTranscript(event.text, event.is_final, event.timestamp);

    // Only final transcripts trigger the Director pipeline
    if (event.is_final && event.text.trim()) {
      await this.processTranscript(event.text.trim());
    }
  }

  public async processTranscript(text: string) {
    if (this.isProcessing) {
      console.log("[Pipeline] Currently busy processing a moment, queuing/skipping");
      return;
    }
    this.isProcessing = true;

    try {
      const settings = await personaStore.getSettings();
      if (!settings.enabled) {
        return;
      }

      // 1. Pre-filter evaluation
      const preFilterResult = preFilter.evaluate(
        text,
        settings,
        this.lastYesTs,
        this.lastIntensity
      );

      if (!preFilterResult.shouldEvaluate) {
        console.log(`[Pipeline] Pre-filter skipped: ${preFilterResult.skipReason}`);
        return;
      }

      // 2. Director evaluation
      const recentTranscript = contextBuffer.getRecentTranscriptText(30) || text;
      const rollingSummary = contextBuffer.getRollingSummary();
      const timeSinceLastReaction = Date.now() - this.lastYesTs;

      const decision: DirectorDecisionResult = await director.evaluate(
        recentTranscript,
        rollingSummary,
        preFilterResult.hints,
        timeSinceLastReaction,
        settings.momentDepth
      );

      pubSub.publish("directorDecision", decision);

      if (!decision.react) {
        console.log(`[Pipeline] Director decided NO: ${decision.reason}`);
        return;
      }

      // Record reaction
      this.lastYesTs = Date.now();
      this.lastIntensity = decision.intensity;
      await personaStore.setLastDirectorFireTs(this.lastYesTs);

      // 3. Persona Selector
      const activePersonas = await personaStore.getActivePersonas();
      if (activePersonas.length === 0) return;

      const selectedPersonas = await personaSelector.selectPersonas(
        activePersonas,
        decision.eventType,
        decision.intensity,
        decision.suggestedReactionTypes
      );

      // 4. Writer Batch Generation
      const rawMessages = await writer.generateChatBatch(
        text,
        decision.eventType,
        decision.intensity,
        selectedPersonas
      );

      // 5. Safety Filter & Sanitation
      const safeMessages: {
        personaId: string;
        username: string;
        color: string;
        text: string;
        kind: string;
      }[] = [];

      const personaMap = new Map<string, PersonaProfile>();
      for (const p of activePersonas) {
        personaMap.set(p.id, p);
      }

      for (const raw of rawMessages) {
        const persona = personaMap.get(raw.persona_id) || selectedPersonas[0];
        const validation = await safetyFilter.validateMessage(raw.text, persona.id);

        if (validation.valid) {
          safeMessages.push({
            personaId: persona.id,
            username: persona.name,
            color: persona.color,
            text: validation.cleanedText,
            kind: raw.kind || "hype",
          });
        } else {
          console.warn(`[Pipeline] Safety filter dropped message: "${raw.text}" (${validation.reason})`);
        }
      }

      // 6. Schedule burst
      chatScheduler.scheduleBatch(
        safeMessages,
        decision.intensity,
        settings.speedMultiplier
      );
    } catch (err: any) {
      console.error("[Pipeline] Pipeline execution error:", err.message);
    } finally {
      this.isProcessing = false;
    }
  }

  public async triggerManualReaction(kind: string, customText?: string): Promise<boolean> {
    const settings = await personaStore.getSettings();
    const activePersonas = await personaStore.getActivePersonas();
    if (activePersonas.length === 0) return false;

    let eventType = "hype";
    let intensity = 7;
    let suggestedReactions = ["hype"];

    if (kind === "troll") {
      eventType = "rage";
      intensity = 8;
      suggestedReactions = ["troll"];
    } else if (kind === "question") {
      eventType = "question";
      intensity = 5;
      suggestedReactions = ["backseat", "supportive"];
    } else if (kind === "simulated") {
      if (customText) {
        await this.processTranscript(customText);
        return true;
      }
    }

    const decision: DirectorDecisionResult = {
      react: true,
      eventType,
      intensity,
      reason: `Manual trigger: ${kind}`,
      suggestedReactionTypes: suggestedReactions,
      ts: Date.now(),
    };

    pubSub.publish("directorDecision", decision);

    const selectedPersonas = await personaSelector.selectPersonas(
      activePersonas,
      eventType,
      intensity,
      suggestedReactions
    );

    const speechContext = customText || `Streamer triggered ${kind} event!`;
    const rawMessages = await writer.generateChatBatch(
      speechContext,
      eventType,
      intensity,
      selectedPersonas
    );

    const safeMessages: {
      personaId: string;
      username: string;
      color: string;
      text: string;
      kind: string;
    }[] = [];

    const personaMap = new Map<string, PersonaProfile>();
    for (const p of activePersonas) personaMap.set(p.id, p);

    for (const raw of rawMessages) {
      const p = personaMap.get(raw.persona_id) || selectedPersonas[0];
      const valid = await safetyFilter.validateMessage(raw.text, p.id);
      if (valid.valid) {
        safeMessages.push({
          personaId: p.id,
          username: p.name,
          color: p.color,
          text: valid.cleanedText,
          kind: raw.kind || kind,
        });
      }
    }

    chatScheduler.scheduleBatch(safeMessages, intensity, settings.speedMultiplier);
    return true;
  }

  private startAmbientChatterLoop() {
    if (this.ambientInterval) clearInterval(this.ambientInterval);

    this.nextAmbientThresholdSec = Math.floor(Math.random() * 75) + 45; // 45-120 seconds

    this.ambientInterval = setInterval(async () => {
      try {
        const settings = await personaStore.getSettings();
        if (!settings.enabled || !settings.ambientChatter) return;

        const timeSinceLastReactionSec = (Date.now() - this.lastYesTs) / 1000;
        if (timeSinceLastReactionSec >= this.nextAmbientThresholdSec) {
          console.log("[Pipeline] Triggering ambient idle chatter...");
          this.nextAmbientThresholdSec = Math.floor(Math.random() * 75) + 45;

          const activePersonas = await personaStore.getActivePersonas();
          if (activePersonas.length === 0) return;

          // Pick 1 persona for quiet idle comment
          const randomPersona = activePersonas[Math.floor(Math.random() * activePersonas.length)];
          const rawMsgs = await writer.generateChatBatch(
            "Stream is quiet right now, chill gaming moment.",
            "boring",
            1,
            [randomPersona]
          );

          if (rawMsgs.length > 0) {
            const valid = await safetyFilter.validateMessage(rawMsgs[0].text, randomPersona.id);
            if (valid.valid) {
              chatScheduler.scheduleBatch(
                [
                  {
                    personaId: randomPersona.id,
                    username: randomPersona.name,
                    color: randomPersona.color,
                    text: valid.cleanedText,
                    kind: rawMsgs[0].kind || "supportive",
                  },
                ],
                1,
                settings.speedMultiplier
              );
            }
          }
        }
      } catch {
        // ignore ambient chatter error
      }
    }, 15000);
  }

  private startStatsLoop() {
    if (this.statsInterval) clearInterval(this.statsInterval);

    this.statsInterval = setInterval(() => {
      const stats = llmRouter.getProviderStats();
      pubSub.publish("providerStats", stats);
    }, 5000);
  }
}

export const pipelineOrchestrator = new PipelineOrchestrator();
