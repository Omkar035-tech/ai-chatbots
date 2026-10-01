import { PersonaProfile } from "../personas/types";

// Emoji Pool
export const EMOJI_POOL = [
  "😂", "🤣", "😭", "💀", "🔥", "😳", "🤨", "👀",
  "🫡", "🥶", "😮", "🙏", "🗿", "😬", "🤡", "👏", "❤️", "😅"
];

// Twitch-style text emotes
export const TWITCH_EMOTES = [
  "KEKW", "LUL", "OMEGALUL", "LULW", "Pog", "PogChamp",
  "monkaS", "Sadge", "Copium", "Clap", "5Head", "ICANT",
  "EZ", "GIGACHAD", "Pepega", "D:"
];

export class ChatHumanizer {
  // Global emoji governance tracking
  private recentEmojis: string[] = []; // Last 50 emojis
  private lastEmojiUsed: string = "";
  private consecutiveSameEmojiCount: number = 0;

  // Anti-repetition & phrase tracking
  private recentShownMessages: string[] = []; // Last 100 shown messages
  private recentPhrases: Map<string, { count: number; blockedUntil: number }> = new Map();
  private recentBroPrefixCount: number = 0;

  // Persona signature emoji assignments (deterministic by persona id)
  private personaEmojis: Map<string, string[]> = new Map();

  constructor() {
    // Initial banned phrases
    const initialBanned = ["chill vibes", "vibes are immaculate", "maximum chill vibes", "bro 💀 w", "vibes bro 💀"];
    const tenMinFromNow = Date.now() + 10 * 60 * 1000;
    for (const phrase of initialBanned) {
      this.recentPhrases.set(phrase.toLowerCase(), { count: 99, blockedUntil: tenMinFromNow });
    }
  }

  /**
   * Returns a deterministic 1-3 emoji signature set for a persona.
   */
  public getPersonaEmojis(personaId: string): string[] {
    if (this.personaEmojis.has(personaId)) {
      return this.personaEmojis.get(personaId)!;
    }

    // Deterministic hash from personaId
    let hash = 0;
    for (let i = 0; i < personaId.length; i++) {
      hash = (hash << 5) - hash + personaId.charCodeAt(i);
      hash |= 0;
    }
    const absHash = Math.abs(hash);

    // 25% of personas use NO emojis at all
    if (absHash % 4 === 0) {
      this.personaEmojis.set(personaId, []);
      return [];
    }

    const count = 1 + (absHash % 2); // 1 or 2 emojis
    const set: string[] = [];
    const pool = [...EMOJI_POOL];
    for (let c = 0; c < count; c++) {
      const idx = (absHash + c * 7) % pool.length;
      set.push(pool[idx]);
    }

    this.personaEmojis.set(personaId, set);
    return set;
  }

  /**
   * Applies the emoji governor rule:
   * - 15-25% of all messages contain an emoji
   * - Max 1 emoji per message (rarely 2-3 repeated for hype spam)
   * - No single emoji may exceed 25% of emoji used in the last 50 messages
   * - Never the same emoji in 3 consecutive messages
   */
  public pickEmoji(persona: PersonaProfile, intensity: number): string | null {
    // Governor: 18% base probability (strict 15-25% range)
    const targetProb = Math.max(0.15, Math.min(0.24, persona.emoji_rate || 0.18));
    if (Math.random() > targetProb) {
      return null;
    }

    const personaSet = this.getPersonaEmojis(persona.id);
    const candidatePool = personaSet.length > 0 ? personaSet : EMOJI_POOL;

    if (this.recentEmojis.length > 50) {
      this.recentEmojis = this.recentEmojis.slice(-50);
    }

    const counts: Record<string, number> = {};
    for (const e of this.recentEmojis) {
      counts[e] = (counts[e] || 0) + 1;
    }

    const allowed = candidatePool.filter((emoji) => {
      const cnt = counts[emoji] || 0;
      // Rule 1: No single emoji > 25% share of last 50 emojis
      if (this.recentEmojis.length >= 4 && (cnt + 1) / (this.recentEmojis.length + 1) > 0.25) {
        return false;
      }
      // Rule 2: Never 2 consecutive identical emojis early on, never 3 anytime
      if (emoji === this.lastEmojiUsed) return false;

      return true;
    });

    if (allowed.length === 0) {
      const fallback = EMOJI_POOL.filter((e) => {
        const cnt = counts[e] || 0;
        return e !== this.lastEmojiUsed && (cnt + 1) / (this.recentEmojis.length + 1) <= 0.25;
      });
      if (fallback.length === 0) return null;
      const chosen = fallback[Math.floor(Math.random() * fallback.length)];
      this.recordEmojiUsage(chosen);
      return chosen;
    }

    const chosen = allowed[Math.floor(Math.random() * allowed.length)];
    this.recordEmojiUsage(chosen);
    return chosen;
  }

  private recordEmojiUsage(emoji: string) {
    this.recentEmojis.push(emoji);
    if (emoji === this.lastEmojiUsed) {
      this.consecutiveSameEmojiCount++;
    } else {
      this.lastEmojiUsed = emoji;
      this.consecutiveSameEmojiCount = 1;
    }
  }

  /**
   * Decides whether to append a Twitch text emote (12-16% chance).
   */
  public pickTwitchEmote(intensity: number): string | null {
    const emoteChance = intensity >= 8 ? 0.20 : 0.15;
    if (Math.random() < emoteChance) {
      if (intensity >= 8) {
        const hypeEmotes = ["KEKW", "OMEGALUL", "Pog", "ICANT", "GIGACHAD", "LULW"];
        return hypeEmotes[Math.floor(Math.random() * hypeEmotes.length)];
      }
      return TWITCH_EMOTES[Math.floor(Math.random() * TWITCH_EMOTES.length)];
    }
    return null;
  }

  /**
   * Transforms text according to persona typing style, typos, casing, and contractions.
   */
  public transformTypingStyle(
    text: string,
    persona: PersonaProfile,
    intensity: number
  ): string {
    let out = text.trim();

    // 1. Clean out existing robotic "bro ... 💀 W" boilerplate if present
    out = out.replace(/\s*💀\s*W$/i, "");
    out = out.replace(/\s*W$/i, "");
    out = out.replace(/chill vibes fr/gi, "that's crazy");
    out = out.replace(/chill vibes/gi, "vibes");
    out = out.replace(/vibes are immaculate/gi, "looks clean");

    // 2. Persona Casing & Punctuation
    const style = persona.typing_style || "lowercase_casual";

    if (intensity >= 9 || (intensity >= 7 && (persona.caps_rate || 0.1) > 0.4)) {
      // Hype caps
      out = out.toUpperCase();
    } else if (style === "caps_hype") {
      out = out.toUpperCase();
    } else if (style === "lowercase_casual" || style === "casual") {
      out = out.toLowerCase();
      // Drop trailing period for casual stream chat
      if (out.endsWith(".") && !out.endsWith("..")) {
        out = out.slice(0, -1);
      }
    } else if (style === "middle_age_formal") {
      // Capitalize first letter, keep punctuation
      out = out.charAt(0).toUpperCase() + out.slice(1);
    } else {
      // Default casual lowercase
      out = out.toLowerCase();
      if (out.endsWith(".") && !out.endsWith("..")) {
        out = out.slice(0, -1);
      }
    }

    // 3. Stretched letters for high intensity / excitement (e.g. "broooo", "lmaooo", "noooo")
    if (intensity >= 6 && Math.random() < 0.25) {
      out = out.replace(/\b(bro|lmao|omg|no|rip|wait|yo)\b/gi, (match) => {
        const lastChar = match.charAt(match.length - 1);
        return match + lastChar.repeat(Math.floor(Math.random() * 3) + 2);
      });
    }

    // 4. Common typos (at very low rate ~4% for realism)
    if (Math.random() < 0.04) {
      const typos: Record<string, string> = {
        the: "teh",
        what: "wat",
        and: "adn",
        just: "jst",
        with: "wth",
      };
      for (const [correct, typo] of Object.entries(typos)) {
        if (out.includes(` ${correct} `)) {
          out = out.replace(` ${correct} `, ` ${typo} `);
          break;
        }
      }
    }

    // 5. Question formatting
    if (out.endsWith("?")) {
      if (intensity >= 7) {
        out = out.replace(/\?+$/, "???");
      } else if (Math.random() < 0.4) {
        out = out.replace(/\?+$/, "??");
      }
    }

    return out.trim();
  }

  /**
   * Applies the complete Humanizer pipeline:
   * - Typing transforms
   * - Emoji governor & Twitch emote insertion
   * - Anti-repetition validation (trigrams, banned phrase tracking, max 10% "bro")
   */
  public humanizeMessage(
    rawText: string,
    persona: PersonaProfile,
    intensity: number
  ): { text: string; accepted: boolean; reason?: string } {
    let processed = this.transformTypingStyle(rawText, persona, intensity);

    // 1. Trigram similarity check against last 100 shown messages
    for (const prev of this.recentShownMessages) {
      if (this.computeTrigramSimilarity(processed, prev) > 0.6) {
        return { text: processed, accepted: false, reason: "trigram_similarity_exceeded" };
      }
    }

    // 2. Banned & Overused Phrase Tracking
    const now = Date.now();
    for (const [phrase, info] of this.recentPhrases.entries()) {
      if (now < info.blockedUntil) {
        if (processed.toLowerCase().includes(phrase)) {
          return { text: processed, accepted: false, reason: `banned_phrase_${phrase}` };
        }
      }
    }

    // 3. Max 10% messages starting with "bro" rule
    const startsWithBro = /^bro\b/i.test(processed);
    if (startsWithBro) {
      const recentCount = this.recentShownMessages.slice(-20);
      let broCount = 0;
      for (const m of recentCount) {
        if (/^bro\b/i.test(m)) broCount++;
      }
      if (recentCount.length >= 10 && broCount / recentCount.length >= 0.1) {
        // Strip or replace "bro"
        processed = processed.replace(/^bro\s+/i, "");
      }
    }

    // 4. Attach Twitch emote or Emoji (not both simultaneously on normal messages)
    const emote = this.pickTwitchEmote(intensity);
    const emoji = this.pickEmoji(persona, intensity);

    if (emote) {
      processed = `${processed} ${emote}`;
    } else if (emoji) {
      processed = `${processed} ${emoji}`;
    }

    // 5. Update phrase tracking for automatic 10-minute bans on repeating structures
    this.trackPhraseFrequency(processed);

    // 6. Record into recent shown messages
    this.recentShownMessages.push(processed);
    if (this.recentShownMessages.length > 100) {
      this.recentShownMessages = this.recentShownMessages.slice(-100);
    }

    return { text: processed, accepted: true };
  }

  /**
   * Tracks repeating 2-word phrases and bans them for 10 minutes if seen > 3 times in last 50 messages.
   */
  private trackPhraseFrequency(msg: string) {
    const words = msg.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
    if (words.length < 2) return;

    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      // Ignore very common stream stopwords
      if (["what are", "is a", "in the", "on the", "to the", "did he"].includes(bigram)) continue;

      const current = this.recentPhrases.get(bigram) || { count: 0, blockedUntil: 0 };
      current.count++;
      if (current.count > 3 && current.blockedUntil < Date.now()) {
        current.blockedUntil = Date.now() + 10 * 60 * 1000; // 10 min ban
        console.log(`[Humanizer] Auto-banning repetitive phrase "${bigram}" for 10 minutes.`);
      }
      this.recentPhrases.set(bigram, current);
    }
  }

  /**
   * Calculates character trigram Jaccard similarity between two strings.
   */
  public computeTrigramSimilarity(a: string, b: string): number {
    const sa = a.toLowerCase().replace(/\s+/g, " ");
    const sb = b.toLowerCase().replace(/\s+/g, " ");
    if (sa === sb) return 1.0;
    if (sa.length < 3 || sb.length < 3) {
      return sa === sb ? 1.0 : 0.0;
    }

    const trigramsA = new Set<string>();
    for (let i = 0; i <= sa.length - 3; i++) {
      trigramsA.add(sa.substring(i, i + 3));
    }

    const trigramsB = new Set<string>();
    for (let i = 0; i <= sb.length - 3; i++) {
      trigramsB.add(sb.substring(i, i + 3));
    }

    let intersection = 0;
    for (const t of trigramsA) {
      if (trigramsB.has(t)) intersection++;
    }

    const union = trigramsA.size + trigramsB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  public getRecentEmojiStats(): { total: number; counts: Record<string, number>; shares: Record<string, number> } {
    const counts: Record<string, number> = {};
    for (const e of this.recentEmojis) {
      counts[e] = (counts[e] || 0) + 1;
    }
    const shares: Record<string, number> = {};
    const total = this.recentEmojis.length;
    for (const [k, v] of Object.entries(counts)) {
      shares[k] = total > 0 ? Math.round((v / total) * 100) / 100 : 0;
    }
    return { total, counts, shares };
  }
}

export const chatHumanizer = new ChatHumanizer();
