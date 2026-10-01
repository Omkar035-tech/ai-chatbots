import { llmRouter } from "../llm/router";
import { PersonaProfile } from "../personas/types";
import { personaStore } from "../personas/store";
import fs from "fs";
import path from "path";

export interface WriterOutputMessage {
  persona_id: string;
  text: string;
  kind: string;
}

export class Writer {
  private systemPrompt: string = "";

  constructor() {
    try {
      const promptPath = path.join(process.cwd(), "src/server/llm/prompts/writer.txt");
      if (fs.existsSync(promptPath)) {
        this.systemPrompt = fs.readFileSync(promptPath, "utf-8");
      }
    } catch {
      // fallback in router
    }
  }

  public async generateChatBatch(
    streamerSpeech: string,
    eventType: string,
    intensity: number,
    selectedPersonas: PersonaProfile[]
  ): Promise<WriterOutputMessage[]> {
    if (selectedPersonas.length === 0) return [];

    // Get last 15 chat messages for context deduplication
    const recentChat = await personaStore.getRecentChat(15);
    const recentChatTexts = recentChat.map((m) => `${m.username}: ${m.text}`);

    // Gather selected personas with their last 3 messages
    const personaContexts = await Promise.all(
      selectedPersonas.map(async (p) => {
        const pastMsgs = await personaStore.getPersonaRecentMessages(p.id, 3);
        return {
          id: p.id,
          username: p.name,
          age_group: p.age_group,
          vibe: p.vibe,
          slang_style: p.slang_style,
          typing_style: p.typing_style,
          reaction_bias: p.reaction_bias,
          catchphrases: p.catchphrases,
          energy: p.energy,
          recent_messages: pastMsgs,
        };
      })
    );

    const userPayload = {
      streamer_speech: streamerSpeech,
      event_type: eventType,
      intensity: intensity,
      recent_chat_history: recentChatTexts,
      selected_personas: personaContexts,
    };

    try {
      const result = await llmRouter.complete_json(
        "writer",
        this.systemPrompt,
        `Generate realistic stream chat messages for these selected personas reacting to the streamer:\n${JSON.stringify(
          userPayload
        )}`,
        undefined,
        { selectedPersonas }
      );

      if (result && Array.isArray(result.messages)) {
        return result.messages;
      }
    } catch (err: any) {
      console.warn("[Writer] Batch generation failed:", err.message);
    }

    // Fallback if failed
    return selectedPersonas.map((p) => ({
      persona_id: p.id,
      text: p.reaction_bias === "hype" ? "W" : "bro 💀",
      kind: p.reaction_bias === "hype" ? "hype" : "troll",
    }));
  }
}

export const writer = new Writer();
