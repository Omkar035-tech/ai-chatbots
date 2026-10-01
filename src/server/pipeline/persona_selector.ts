import { PersonaProfile } from "../personas/types";
import { personaStore } from "../personas/store";

export class PersonaSelector {
  public async selectPersonas(
    activePersonas: PersonaProfile[],
    eventType: string,
    intensity: number,
    suggestedReactionTypes: string[]
  ): Promise<PersonaProfile[]> {
    if (activePersonas.length === 0) return [];

    // Calculate number of responders based on intensity
    let targetCount = 2;
    if (intensity <= 3) {
      targetCount = Math.floor(Math.random() * 2) + 1; // 1-2
    } else if (intensity <= 6) {
      targetCount = Math.floor(Math.random() * 3) + 3; // 3-5
    } else {
      targetCount = Math.floor(Math.random() * 7) + 6; // 6-12
    }

    targetCount = Math.min(targetCount, activePersonas.length);

    // Map bias affinities based on event type
    const preferredBiases: string[] = [...suggestedReactionTypes];
    if (eventType === "rage" || eventType === "fail") {
      preferredBiases.push("troll", "skeptic", "backseat");
    } else if (eventType === "win" || eventType === "jumpscare") {
      preferredBiases.push("hype", "joker");
    } else if (eventType === "question") {
      preferredBiases.push("backseat", "supportive");
    }

    // Score active personas
    const scoredPersonas = await Promise.all(
      activePersonas.map(async (p) => {
        let score = Math.random() * 10; // baseline randomness

        // Bias match bonus
        if (preferredBiases.includes(p.reaction_bias)) {
          score += 15;
        }

        // Energy match: high energy personas favor high intensity
        const energyDelta = Math.abs(p.energy - intensity);
        score += Math.max(0, 10 - energyDelta);

        // Recency penalty: penalize personas who spoke very recently to give others a turn
        const recentMsgs = await personaStore.getPersonaRecentMessages(p.id, 2);
        if (recentMsgs.length > 0) {
          score -= 10;
        }

        return { persona: p, score };
      })
    );

    // Sort descending by score
    scoredPersonas.sort((a, b) => b.score - a.score);

    // Pick top candidates, leaving room for 1 wildcard
    const wildcardCount = Math.min(1, Math.max(0, targetCount - 1));
    const mainCount = targetCount - wildcardCount;

    const selected: PersonaProfile[] = scoredPersonas.slice(0, mainCount).map((sp) => sp.persona);

    // Add wildcard from remaining if available
    if (wildcardCount > 0 && scoredPersonas.length > mainCount) {
      const remaining = scoredPersonas.slice(mainCount);
      const randomIdx = Math.floor(Math.random() * remaining.length);
      selected.push(remaining[randomIdx].persona);
    }

    return selected;
  }
}

export const personaSelector = new PersonaSelector();
