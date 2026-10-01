import { HypeMoment } from "./hype_detector";
import { messageBank, BankMessage } from "../bank/store";
import { PersonaProfile, SettingsState } from "../personas/types";
import { chatHumanizer } from "./humanizer";
import { reactiveCallGenerator } from "./reactive_call";

export interface MatchedChatMessage {
  personaId: string;
  username: string;
  color: string;
  text: string;
  kind: string;
}

export class LocalMatcher {
  private recentUsedIds: Set<string> = new Set();
  private streamerName: string = "omkar"; // Default streamer name or from env

  /**
   * Matches candidate messages from the Message Bank, fills slots,
   * humanizes them per persona, and generates dynamic chat bursts.
   */
  public async match(
    moment: HypeMoment,
    activePersonas: PersonaProfile[],
    settings: SettingsState
  ): Promise<{ messages: MatchedChatMessage[]; tierUsed: "tier0" | "tier1" | "tier2" }> {
    if (activePersonas.length === 0) {
      return { messages: [], tierUsed: "tier0" };
    }

    let tierUsed: "tier0" | "tier1" | "tier2" = "tier0";

    // 1. Determine number of responders based on intensity and moment depth
    const baseCount =
      moment.intensity >= 8
        ? Math.floor(Math.random() * 5) + 8 // 8 - 12 bots
        : moment.intensity >= 5
        ? Math.floor(Math.random() * 4) + 4 // 4 - 7 bots
        : Math.floor(Math.random() * 2) + 2; // 2 - 3 bots

    const depthMultiplier = Math.max(0.4, (settings.momentDepth || 5) / 5.0);
    const targetCount = Math.max(2, Math.min(activePersonas.length, Math.round(baseCount * depthMultiplier)));

    // 2. Fetch candidates from Message Bank
    let candidates = await messageBank.fetchCandidates(
      moment.event_type,
      moment.intensity,
      Math.max(40, targetCount * 5),
      this.recentUsedIds
    );

    // 3. Check if match is weak for Absurd / High Intensity moments -> Trigger Tier 2
    const hasEntities = moment.entities && moment.entities.length > 0;
    const candidatesWithEntity = candidates.filter((c) => {
      if (!hasEntities) return true;
      const lower = c.text.toLowerCase();
      return moment.entities.some((e) => lower.includes(e.toLowerCase()) || lower.includes("{subject}"));
    });

    const isWeakMatch = (moment.absurd || moment.intensity >= 8) && candidatesWithEntity.length < 3;

    if (isWeakMatch) {
      // Attempt Tier 2 reactive micro-call if enabled
      try {
        const reactiveMessages = await reactiveCallGenerator.generateForMoment(moment);
        if (reactiveMessages.length > 0) {
          tierUsed = "tier2";
          candidates = [...reactiveMessages, ...candidates];
        }
      } catch (err: any) {
        console.warn("[LocalMatcher] Tier 2 attempt failed, staying on Tier 0 bank:", err.message);
      }
    }

    // 4. Slot filling with extracted entities
    const primaryEntity = moment.entities && moment.entities.length > 0 ? moment.entities[0] : "";
    const secondaryEntity = moment.entities && moment.entities.length > 1 ? moment.entities[1] : "";
    const preparedCandidates: Array<{ id: string; text: string; style_tag: string }> = [];

    for (const c of candidates) {
      let filledText = c.text;
      if (filledText.includes("{subject}") || filledText.includes("{entity}")) {
        if (primaryEntity) {
          filledText = filledText.replace(/\{subject\}/gi, primaryEntity);
          filledText = filledText.replace(/\{entity\}/gi, secondaryEntity || primaryEntity);
        } else {
          filledText = filledText.replace(/\{subject\}/gi, "that");
          filledText = filledText.replace(/\{entity\}/gi, "it");
        }
      }
      preparedCandidates.push({ id: c.id, text: filledText, style_tag: c.style_tag });
    }

    // Prioritize candidates that contain the extracted entities or key absurd words
    preparedCandidates.sort((a, b) => {
      const aLower = a.text.toLowerCase();
      const bLower = b.text.toLowerCase();
      const aHasEntity = moment.entities.some((e) => aLower.includes(e.toLowerCase()));
      const bHasEntity = moment.entities.some((e) => bLower.includes(e.toLowerCase()));
      if (aHasEntity && !bHasEntity) return -1;
      if (!aHasEntity && bHasEntity) return 1;
      return 0;
    });

    // 5. Select active personas based on engagement probability
    const candidatePersonas = [...activePersonas];
    candidatePersonas.sort((a, b) => {
      const aBiasMatch = a.reaction_bias.toLowerCase() === moment.event_type ? 2 : 1;
      const bBiasMatch = b.reaction_bias.toLowerCase() === moment.event_type ? 2 : 1;
      return b.energy * bBiasMatch - a.energy * aBiasMatch;
    });

    const selectedPersonas = candidatePersonas.slice(0, targetCount);

    // 6. Generate messages and apply Humanizer
    const outMessages: MatchedChatMessage[] = [];
    const usedCandidateIds: string[] = [];

    // Optional Twitch Emote Spam Chain for high intensity (3-4 bots posting hype emotes)
    const shouldSpamChain = moment.intensity >= 8 && selectedPersonas.length >= 6 && Math.random() < 0.5;
    const spamTokens = ["KEKW", "OMEGALUL", "Pog", "ICANT", "LUL", "GIGACHAD"];
    const chosenSpamEmote = spamTokens[Math.floor(Math.random() * spamTokens.length)];
    const spamCount = shouldSpamChain ? 3 : 0;

    for (let i = 0; i < selectedPersonas.length; i++) {
      const persona = selectedPersonas[i];

      // Handle emote spam chain
      if (i < spamCount && chosenSpamEmote) {
        // Vary casing or slight repetition for realism
        const emoteVariants = [chosenSpamEmote, `${chosenSpamEmote} ${chosenSpamEmote}`, chosenSpamEmote.toLowerCase()];
        const variant = emoteVariants[i % emoteVariants.length];
        outMessages.push({
          personaId: persona.id,
          username: persona.name,
          color: persona.color,
          text: variant,
          kind: "spam",
        });
        continue;
      }

      // Pick an unused candidate message
      let chosenCandidate = preparedCandidates.find(
        (c) => !usedCandidateIds.includes(c.id) && c.style_tag === persona.typing_style
      );
      if (!chosenCandidate) {
        chosenCandidate = preparedCandidates.find((c) => !usedCandidateIds.includes(c.id));
      }

      if (!chosenCandidate) {
        const fallbacks = ["wait what", "no way", "huh", "classic", "rip", "is this real", "did he really"];
        const fbText = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        chosenCandidate = { id: `fb_${Date.now()}_${i}`, text: fbText, style_tag: "short_lurker" };
      }

      usedCandidateIds.push(chosenCandidate.id);
      this.recentUsedIds.add(chosenCandidate.id);
      if (this.recentUsedIds.size > 250) {
        const first = this.recentUsedIds.values().next().value;
        if (first) this.recentUsedIds.delete(first);
      }

      // Mark candidate as used in message bank
      messageBank.markUsed(chosenCandidate.id).catch(() => {});

      let rawText = chosenCandidate.text;
      if (i > 2 && Math.random() < 0.12 && outMessages.length > 0) {
        const targetUsername = outMessages[outMessages.length - 1].username;
        rawText = `@${targetUsername} ${rawText}`;
      } else if (Math.random() < 0.04) {
        rawText = `@${this.streamerName} ${rawText}`;
      }

      // Apply ChatHumanizer
      const humanized = chatHumanizer.humanizeMessage(rawText, persona, moment.intensity);
      if (humanized.accepted) {
        // Double check against messages already queued in this burst to prevent duplicate lines
        let duplicateInBatch = false;
        for (const prev of outMessages) {
          if (chatHumanizer.computeTrigramSimilarity(humanized.text, prev.text) > 0.6) {
            duplicateInBatch = true;
            break;
          }
        }

        if (!duplicateInBatch) {
          outMessages.push({
            personaId: persona.id,
            username: persona.name,
            color: persona.color,
            text: humanized.text,
            kind: "reaction",
          });
        }
      }
    }

    return { messages: outMessages, tierUsed };
  }
}

export const localMatcher = new LocalMatcher();
