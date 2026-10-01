import { personaStore } from "../../server/personas/store";
import { llmRouter } from "../../server/llm/router";
import { serverSTT } from "../../server/stt";
import { pipelineOrchestrator } from "../../server/pipeline/orchestrator";
import { pubSub } from "../pubsub";
import { chatScheduler } from "../../server/pipeline/scheduler";

export const resolvers = {
  Query: {
    settings: async () => {
      return await personaStore.getSettings();
    },
    activePersonas: async () => {
      const personas = await personaStore.getActivePersonas();
      return personas.map((p) => ({
        id: p.id,
        username: p.name,
        color: p.color,
        ageGroup: p.age_group,
        vibe: p.vibe,
        energy: p.energy,
      }));
    },
    providerStats: () => {
      return llmRouter.getProviderStats();
    },
    recentChat: async (_: any, { limit = 25 }: { limit?: number }) => {
      return await personaStore.getRecentChat(limit);
    },
    hypeTelemetry: () => {
      return pipelineOrchestrator.getTelemetry();
    },
  },
  Mutation: {
    updateSettings: async (_: any, { input }: { input: any }) => {
      const updated = await personaStore.saveSettings(input);
      if (input.botCount !== undefined) {
        const active = await personaStore.getActivePersonas();
        pubSub.publish(
          "rosterUpdated",
          active.map((p) => ({
            id: p.id,
            username: p.name,
            color: p.color,
            ageGroup: p.age_group,
            vibe: p.vibe,
            energy: p.energy,
          })) as any
        );
      }
      return updated;
    },
    submitTranscript: (_: any, { text, isFinal }: { text: string; isFinal: boolean }) => {
      serverSTT.emitTranscript(text, isFinal);
      return true;
    },
    triggerReaction: async (_: any, { kind, text }: { kind: string; text?: string }) => {
      return await pipelineOrchestrator.triggerManualReaction(kind, text);
    },
    clearChat: async () => {
      chatScheduler.clearPending();
      await personaStore.clearChat();
      return true;
    },
  },
  Subscription: {
    chatMessage: {
      subscribe: () => pubSub.subscribe("chatMessage"),
      resolve: (payload: any) => payload,
    },
    transcript: {
      subscribe: () => pubSub.subscribe("transcript"),
      resolve: (payload: any) => payload,
    },
    directorDecision: {
      subscribe: () => pubSub.subscribe("directorDecision"),
      resolve: (payload: any) => payload,
    },
    rosterUpdated: {
      subscribe: () => pubSub.subscribe("rosterUpdated"),
      resolve: (payload: any) => payload,
    },
    providerStats: {
      subscribe: () => pubSub.subscribe("providerStats"),
      resolve: (payload: any) => payload,
    },
    hypeTelemetry: {
      subscribe: () => pubSub.subscribe("hypeTelemetry"),
      resolve: (payload: any) => payload,
    },
  },
};
