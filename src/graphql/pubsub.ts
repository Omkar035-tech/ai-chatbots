import { createPubSub } from "graphql-yoga";
import { ChatMessageItem, PersonaProfile } from "../server/personas/types";
import { DirectorDecisionResult } from "../server/pipeline/director";
import { ProviderStat } from "../server/llm/types";

export type PubSubEvents = {
  chatMessage: [ChatMessageItem];
  transcript: [string];
  directorDecision: [DirectorDecisionResult];
  rosterUpdated: [PersonaProfile[]];
  providerStats: [ProviderStat[]];
};

export const pubSub = createPubSub<PubSubEvents>();
