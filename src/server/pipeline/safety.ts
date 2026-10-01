import { personaStore } from "../personas/store";

// Common prohibited patterns for Twitch/YouTube stream TOS
const PROHIBITED_REGEXES = [
  // URLs, domains, links, advertising
  /\b(?:https?:\/\/|www\.)\S+/i,
  /\b[a-zA-Z0-9-]+\.(?:com|org|net|xyz|ru|to|gg|io|link|cc|tk)\b/i,
  // Doxxing indicators (phone numbers, ip addresses)
  /\b\d{3}[-.\s]??\d{3}[-.\s]??\d{4}\b/,
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  // Self harm and violence encouragement
  /\b(kill\s+your\s*self|kms|kys|hang\s+your\s*self|die\s+irl)\b/i,
  // Slurs & severe hate speech patterns
  /\b(nigg|fag|retard|cunt|tranny|kike|chink|spic)\w*/i,
  // Explicit sexual / NSFW phrases
  /\b(porn|onlyfans|blowjob|cock|pussy|nsfw|sex\s+cam)\b/i,
];

export class SafetyFilter {
  public async validateMessage(text: string, personaId?: string): Promise<{ valid: boolean; cleanedText: string; reason?: string }> {
    if (!text || !text.trim()) {
      return { valid: false, cleanedText: "", reason: "Empty message" };
    }

    let cleaned = text.trim();

    // Cap message length at 120 chars
    if (cleaned.length > 120) {
      cleaned = cleaned.substring(0, 120).trim();
    }

    // Prohibited words and regexes
    for (const regex of PROHIBITED_REGEXES) {
      if (regex.test(cleaned)) {
        return { valid: false, cleanedText: "", reason: "Violated TOS safety filter" };
      }
    }

    // Deduplication check against recent chat
    const recent = await personaStore.getRecentChat(10);
    const isDuplicate = recent.some(
      (m) => m.text.toLowerCase().trim() === cleaned.toLowerCase().trim()
    );

    if (isDuplicate) {
      return { valid: false, cleanedText: "", reason: "Duplicate of recent message" };
    }

    // Check if the same persona recently posted this exact text
    if (personaId) {
      const personaPast = await personaStore.getPersonaRecentMessages(personaId, 3);
      if (personaPast.some((m) => m.toLowerCase().trim() === cleaned.toLowerCase().trim())) {
        return { valid: false, cleanedText: "", reason: "Persona self-repetition" };
      }
    }

    return { valid: true, cleanedText: cleaned };
  }
}

export const safetyFilter = new SafetyFilter();
