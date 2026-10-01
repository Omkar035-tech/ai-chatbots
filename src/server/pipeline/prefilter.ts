import { SettingsState } from "../personas/types";

export interface PreFilterResult {
  shouldEvaluate: boolean;
  skipReason?: string;
  isLikelyHype: boolean;
  hints: string[];
}

const HYPE_KEYWORDS = [
  "what the",
  "no way",
  "let's go",
  "lets go",
  "i died",
  "help",
  "oh my god",
  "omg",
  "hate this",
  "run",
  "look at that",
  "behind",
  "holy",
  "bro",
  "scream",
  "gg",
  "wtf",
  "shiii",
  "damn",
  "unreal",
  "dead",
];

export class PreFilter {
  private lastEvaluationTs: number = 0;
  private lastFinalTextTs: number = Date.now();

  public evaluate(
    chunkText: string,
    settings: SettingsState,
    lastYesTs: number,
    lastIntensity: number
  ): PreFilterResult {
    const hints: string[] = [];

    if (!settings.enabled) {
      return { shouldEvaluate: false, skipReason: "Chat is disabled", isLikelyHype: false, hints };
    }

    const trimmed = chunkText.trim();
    const words = trimmed.split(/\s+/).filter(Boolean);

    // Check for silence before this speech
    const silenceDurationMs = Date.now() - this.lastFinalTextTs;
    this.lastFinalTextTs = Date.now();
    if (silenceDurationMs > 15000) {
      hints.push("sudden speech after long silence");
    }

    // Cooldown check: base cooldown ~6s, scaled down for high previous intensity
    const baseCooldownMs = Math.max(3000, 10000 - lastIntensity * 700);
    const timeSinceLastYes = Date.now() - lastYesTs;
    const inCooldown = timeSinceLastYes < baseCooldownMs;

    // Check hype indicators
    const lower = trimmed.toLowerCase();
    const hasHypeKeyword = HYPE_KEYWORDS.some((kw) => lower.includes(kw));
    if (hasHypeKeyword) hints.push("matched hype keywords");

    // Caps check
    const uppercaseLetters = trimmed.replace(/[^A-Z]/g, "").length;
    const totalLetters = trimmed.replace(/[^a-zA-Z]/g, "").length;
    const isCapsHeavy = totalLetters > 4 && uppercaseLetters / totalLetters > 0.45;
    if (isCapsHeavy) hints.push("shouting / caps-heavy");

    // Exclamation / repetitions
    if (trimmed.includes("!") || /(.)\1{3,}/.test(trimmed) || /\b(\w+)\s+\1\b/i.test(trimmed)) {
      hints.push("exclamation or repeated words");
    }

    const isLikelyHype = hasHypeKeyword || isCapsHeavy || hints.length >= 2;

    // If in cooldown, allow through ONLY if it's very likely hype
    if (inCooldown && !isLikelyHype) {
      return {
        shouldEvaluate: false,
        skipReason: `In cooldown (${Math.round((baseCooldownMs - timeSinceLastYes) / 1000)}s left)`,
        isLikelyHype,
        hints,
      };
    }

    // Check minimum length (skip if < 4 words and no hype keyword)
    if (words.length < 4 && !hasHypeKeyword && !isLikelyHype) {
      return {
        shouldEvaluate: false,
        skipReason: "Under 4 words and no hype keywords",
        isLikelyHype: false,
        hints,
      };
    }

    return {
      shouldEvaluate: true,
      isLikelyHype,
      hints,
    };
  }
}

export const preFilter = new PreFilter();
