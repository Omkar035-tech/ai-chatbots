import nlp from "compromise";
import fs from "fs";
import path from "path";

export interface SignalBreakdown {
  value: number;        // Raw or normalized signal (0 to 1)
  weight: number;       // Weight factor
  contribution: number; // contribution to hype_score
}

export interface HypeMoment {
  moment_id: string;
  start_ts: number;
  peak_ts: number;
  quote: string;
  event_type: "rage" | "jumpscare" | "fail" | "win" | "funny" | "question" | "greeting" | "story" | "quiet";
  intensity: number;    // 1 to 10
  entities: string[];
  absurd: boolean;
  signals: Record<string, SignalBreakdown>;
  hype_score: number;   // 0 to 10
}

export interface HypeDetectorConfig {
  tHigh: number;
  tLow: number;
  windowSec: number;
  weights: {
    loudness: number;
    speechRate: number;
    capsExclamation: number;
    laughterScream: number;
    keywords: number;
    question: number;
    noveltyAbsurdity: number;
    silenceGap: number;
  };
}

interface TranscriptSample {
  text: string;
  ts: number;
  audioLevel?: number;
  wordCount: number;
  durationSec: number;
}

export class LocalHypeDetector {
  private config: HypeDetectorConfig;
  private keywords: Record<string, string[]> = {};
  private history: TranscriptSample[] = [];
  private recentVocabulary: Map<string, number> = new Map();
  private lastUtteranceTs: number = 0;

  // Hysteresis state machine
  private state: "IDLE" | "MOMENT_START" | "PEAK" | "DECAY" = "IDLE";
  private currentMoment: Partial<HypeMoment> | null = null;
  private consecutiveHighHops: number = 0;
  private consecutiveLowHops: number = 0;
  private peakScore: number = 0;
  private peakQuote: string = "";

  constructor() {
    this.config = {
      tHigh: 6.2,
      tLow: 3.8,
      windowSec: 10,
      weights: {
        loudness: 2.2,
        speechRate: 1.5,
        capsExclamation: 1.5,
        laughterScream: 1.5,
        keywords: 2.2,
        question: 1.0,
        noveltyAbsurdity: 2.2,
        silenceGap: 1.2,
      },
    };

    this.loadKeywords();
  }

  public getConfig(): HypeDetectorConfig {
    return { ...this.config };
  }

  public updateConfig(newCfg: Partial<HypeDetectorConfig>) {
    this.config = { ...this.config, ...newCfg };
  }

  private loadKeywords() {
    try {
      const kwPath = path.join(process.cwd(), "src/server/pipeline/keywords.json");
      if (fs.existsSync(kwPath)) {
        this.keywords = JSON.parse(fs.readFileSync(kwPath, "utf-8"));
      }
    } catch (err: any) {
      console.warn("[HypeDetector] Could not load keywords.json:", err.message);
    }
  }

  /**
   * Evaluates the latest utterance and sliding window.
   */
  public evaluate(
    text: string,
    audioLevel: number = 0,
    timestamp: number = Date.now()
  ): {
    score: number;
    signals: Record<string, SignalBreakdown>;
    moment: HypeMoment | null;
    state: string;
  } {
    const cleanText = text.trim();
    if (!cleanText) {
      return {
        score: 0,
        signals: {},
        moment: null,
        state: this.state,
      };
    }

    const words = cleanText.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const gapFromLastSec = this.lastUtteranceTs > 0 ? (timestamp - this.lastUtteranceTs) / 1000 : 0;
    const durationSec = Math.max(1, wordCount * 0.35); // Estimated duration if not provided

    const sample: TranscriptSample = {
      text: cleanText,
      ts: timestamp,
      audioLevel,
      wordCount,
      durationSec,
    };

    this.addSampleToHistory(sample);
    this.lastUtteranceTs = timestamp;

    // 1. Mic Loudness Signal (Z-score vs 5-minute rolling baseline)
    const loudnessSignal = this.computeLoudnessSignal(audioLevel);

    // 2. Speech Rate Signal (Words per second vs rolling baseline)
    const speechRateSignal = this.computeSpeechRateSignal(wordCount, durationSec);

    // 3. Exclamations / ALL CAPS / Repeated Words
    const capsExclamationSignal = this.computeCapsAndRepeatsSignal(cleanText);

    // 4. Laughter / Scream Tokens
    const laughterScreamSignal = this.computeLaughterScreamSignal(cleanText);

    // 5. Keyword Matching & Classification
    const { keywordScore, detectedEvent } = this.computeKeywordSignal(cleanText);

    // 6. Question Detection
    const questionSignal = this.computeQuestionSignal(cleanText);

    // 7. Novelty / Absurdity (semantic divergence from rolling 5-minute transcript)
    const { noveltyScore, isAbsurd } = this.computeNoveltySignal(cleanText, words);

    // 8. Gap Analysis (Sudden speech after silence)
    const gapSignal = gapFromLastSec >= 3.5 ? Math.min(1.0, gapFromLastSec / 8.0) : 0;

    // Weighted aggregation normalized to 0 - 10
    const rawSignals: Record<string, { value: number; weight: number }> = {
      loudness: { value: loudnessSignal, weight: this.config.weights.loudness },
      speechRate: { value: speechRateSignal, weight: this.config.weights.speechRate },
      capsExclamation: { value: capsExclamationSignal, weight: this.config.weights.capsExclamation },
      laughterScream: { value: laughterScreamSignal, weight: this.config.weights.laughterScream },
      keywords: { value: keywordScore, weight: this.config.weights.keywords },
      question: { value: questionSignal, weight: this.config.weights.question },
      noveltyAbsurdity: { value: noveltyScore, weight: this.config.weights.noveltyAbsurdity },
      silenceGap: { value: gapSignal, weight: this.config.weights.silenceGap },
    };

    let totalWeight = 0;
    let weightedSum = 0;
    const signals: Record<string, SignalBreakdown> = {};

    for (const [name, s] of Object.entries(rawSignals)) {
      totalWeight += s.weight;
      const contrib = s.value * s.weight;
      weightedSum += contrib;
      signals[name] = {
        value: Math.round(s.value * 100) / 100,
        weight: s.weight,
        contribution: Math.round(contrib * 100) / 100,
      };
    }

    // Top contributing signals aggregation
    const sortedContribs = Object.values(rawSignals)
      .map((s) => ({ val: s.value, w: s.weight, contrib: s.value * s.weight }))
      .sort((a, b) => b.contrib - a.contrib);

    const top4 = sortedContribs.slice(0, 4);
    const topWeight = top4.reduce((acc, cur) => acc + cur.w, 0);
    const topSum = top4.reduce((acc, cur) => acc + cur.contrib, 0);
    const baseScore = topWeight > 0 ? (topSum / topWeight) * 10 : 0;

    // Boost if multiple high-intensity signals co-occur (e.g. keywords + novelty + loudness)
    const coOccurrenceBoost =
      (keywordScore > 0.4 && noveltyScore > 0.5) ||
      (loudnessSignal > 0.5 && (keywordScore > 0.4 || isAbsurd)) ||
      (capsExclamationSignal > 0.5 && loudnessSignal > 0.5)
        ? 1.5
        : 0;
    const finalScore = Math.min(10.0, Math.round((baseScore + coOccurrenceBoost) * 10) / 10);

    // Extract entities with Compromise
    const entities = this.extractEntities(cleanText);

    // Hysteresis Moment Tracking
    let emittedMoment: HypeMoment | null = null;

    if (finalScore >= this.config.tHigh) {
      this.consecutiveHighHops++;
      this.consecutiveLowHops = 0;

      if (this.state === "IDLE" && this.consecutiveHighHops >= 1) {
        this.state = "MOMENT_START";
        this.peakScore = finalScore;
        this.peakQuote = cleanText;
        this.currentMoment = {
          moment_id: `m_${timestamp}_${Math.random().toString(36).substring(2, 6)}`,
          start_ts: timestamp,
          quote: cleanText,
          event_type: detectedEvent || (isAbsurd ? "funny" : "win"),
          intensity: Math.min(10, Math.max(1, Math.round(finalScore))),
          entities,
          absurd: isAbsurd,
          signals,
          hype_score: finalScore,
        };
      } else if (this.state === "MOMENT_START" || this.state === "PEAK") {
        this.state = "PEAK";
        if (finalScore > this.peakScore) {
          this.peakScore = finalScore;
          this.peakQuote = cleanText;
        }
        if (this.currentMoment) {
          this.currentMoment.intensity = Math.max(this.currentMoment.intensity || 5, Math.round(finalScore));
          this.currentMoment.peak_ts = timestamp;
          if (entities.length > (this.currentMoment.entities?.length || 0)) {
            this.currentMoment.entities = entities;
          }
        }
      }

      // Emitted on high moment
      if (this.currentMoment && (this.state === "MOMENT_START" || this.state === "PEAK")) {
        emittedMoment = {
          moment_id: this.currentMoment.moment_id || `m_${timestamp}`,
          start_ts: this.currentMoment.start_ts || timestamp,
          peak_ts: timestamp,
          quote: cleanText,
          event_type: this.currentMoment.event_type || detectedEvent || "funny",
          intensity: Math.min(10, Math.max(1, Math.round(finalScore))),
          entities,
          absurd: isAbsurd || (this.currentMoment.absurd ?? false),
          signals,
          hype_score: finalScore,
        };
      }
    } else if (finalScore <= this.config.tLow) {
      this.consecutiveLowHops++;
      this.consecutiveHighHops = 0;

      if (this.state === "PEAK" || this.state === "MOMENT_START") {
        this.state = "DECAY";
      } else if (this.state === "DECAY" && this.consecutiveLowHops >= 2) {
        this.state = "IDLE";
        this.currentMoment = null;
        this.peakScore = 0;
      }
    } else {
      // Score in intermediate band [tLow, tHigh]
      this.consecutiveHighHops = 0;
      this.consecutiveLowHops = 0;
    }

    return {
      score: finalScore,
      signals,
      moment: emittedMoment,
      state: this.state,
    };
  }

  private addSampleToHistory(sample: TranscriptSample) {
    this.history.push(sample);
    // Trim history to rolling 5 minutes (~300 seconds)
    const cutoff = Date.now() - 300000;
    this.history = this.history.filter((s) => s.ts >= cutoff);

    // Update vocabulary frequency table
    const words = sample.text.toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length > 2);
    for (const w of words) {
      this.recentVocabulary.set(w, (this.recentVocabulary.get(w) || 0) + 1);
    }
  }

  private computeLoudnessSignal(currentLevel: number): number {
    if (this.history.length < 3 || currentLevel === 0) {
      return Math.min(1.0, currentLevel / 80.0);
    }

    const levels = this.history.map((h) => h.audioLevel || 0).filter((l) => l > 0);
    if (levels.length === 0) return Math.min(1.0, currentLevel / 80.0);

    const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
    const variance = levels.reduce((acc, l) => acc + Math.pow(l - mean, 2), 0) / levels.length;
    const stdDev = Math.sqrt(variance) || 10;

    const zScore = (currentLevel - mean) / stdDev;
    // Map zScore (-1 to +3) into 0.0 to 1.0
    return Math.max(0, Math.min(1.0, (zScore + 0.5) / 3.0));
  }

  private computeSpeechRateSignal(wordCount: number, durationSec: number): number {
    const rate = wordCount / Math.max(1, durationSec); // words per second
    if (this.history.length < 3) {
      return Math.min(1.0, rate / 4.0);
    }

    const rates = this.history.map((h) => h.wordCount / Math.max(1, h.durationSec));
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    const variance = rates.reduce((acc, r) => acc + Math.pow(r - mean, 2), 0) / rates.length;
    const stdDev = Math.sqrt(variance) || 1.0;

    const zScore = (rate - mean) / stdDev;
    return Math.max(0, Math.min(1.0, (zScore + 0.5) / 2.5));
  }

  private computeCapsAndRepeatsSignal(text: string): number {
    let score = 0;
    // Repeated words (e.g. "no no no", "why why", "stop stop")
    if (/\b(\w+)\s+\1\b/i.test(text)) score += 0.45;
    if (/\b(\w+)\s+\1\s+\1\b/i.test(text)) score += 0.35;

    // Multiple exclamations or question marks
    if (/[!?]{2,}/.test(text)) score += 0.35;

    // CAPS ratio
    const letters = text.replace(/[^a-zA-Z]/g, "");
    if (letters.length >= 4) {
      const upper = letters.replace(/[^A-Z]/g, "").length;
      const capsRatio = upper / letters.length;
      if (capsRatio > 0.5) score += capsRatio * 0.6;
    }

    // Common profanities / intense interjections
    if (/\b(fuck|shit|damn|hell|ass|wtf|stfu)\b/i.test(text)) score += 0.4;

    return Math.min(1.0, score);
  }

  private computeLaughterScreamSignal(text: string): number {
    const lower = text.toLowerCase();
    let score = 0;
    if (/ha(ha)+|lmao+|rofl|lol+|xd+/i.test(lower)) score += 0.8;
    if (/a{3,}h*|o{3,}h*|n{2,}o{3,}/i.test(lower)) score += 0.8;
    if (/bro\s+what|what\s+the\s+hell|are\s+you\s+serious/i.test(lower)) score += 0.5;
    return Math.min(1.0, score);
  }

  private computeKeywordSignal(text: string): { keywordScore: number; detectedEvent: any } {
    const lower = text.toLowerCase();
    let bestEvent: any = null;
    let maxMatches = 0;

    for (const [event, list] of Object.entries(this.keywords)) {
      let matches = 0;
      for (const kw of list) {
        if (lower.includes(kw.toLowerCase())) {
          matches++;
        }
      }
      if (matches > maxMatches) {
        maxMatches = matches;
        bestEvent = event;
      }
    }

    const keywordScore = maxMatches > 0 ? Math.min(1.0, 0.4 + maxMatches * 0.3) : 0;
    return { keywordScore, detectedEvent: bestEvent };
  }

  private computeQuestionSignal(text: string): number {
    if (/\bchat\b.*\?/i.test(text)) return 1.0;
    if (/\?(?!\?)/.test(text) && /\b(what|should|how|who|which|where|why|can)\b/i.test(text)) return 0.8;
    if (/\b(what do you think|is this real|should i do this)\b/i.test(text)) return 0.9;
    return 0;
  }

  private computeNoveltySignal(text: string, words: string[]): { noveltyScore: number; isAbsurd: boolean } {
    const lower = text.toLowerCase();
    // Known absurd pairings and bizarre concepts (e.g. "george fell" + "pregnant", "turned into a potato", "cooked without oil")
    const absurdPhrases = [
      /pregnant/i,
      /cooked without oil/i,
      /potato/i,
      /turned into/i,
      /fell (off|from)/i,
      /table.*potato/i,
      /ate my.*homework/i,
      /gave birth/i,
      /married a/i,
      /ghost.*stole/i,
      /alien.*abducted/i,
    ];

    let isAbsurd = false;
    for (const rx of absurdPhrases) {
      if (rx.test(lower)) {
        isAbsurd = true;
        break;
      }
    }

    if (this.recentVocabulary.size < 10) {
      return { noveltyScore: isAbsurd ? 0.95 : 0.4, isAbsurd };
    }

    // Calculate rare words not seen in rolling transcript
    const cleanTokens = words.map((w) => w.toLowerCase().replace(/[^a-z]/g, "")).filter((w) => w.length > 2);
    let rareCount = 0;
    for (const token of cleanTokens) {
      const count = this.recentVocabulary.get(token) || 0;
      if (count <= 1) {
        rareCount++;
      }
    }

    const rarityRatio = cleanTokens.length > 0 ? rareCount / cleanTokens.length : 0;
    let score = rarityRatio * 0.8;
    if (isAbsurd) {
      score = Math.max(score, 0.95);
    }

    return { noveltyScore: Math.min(1.0, score), isAbsurd };
  }

  public extractEntities(text: string): string[] {
    try {
      const doc = nlp(text);
      const people = doc.people().out("array");
      const nouns = doc.nouns().out("array");

      const rawEntities = [...people, ...nouns];
      const filtered = rawEntities
        .map((e) => e.trim())
        .filter((e) => {
          const l = e.toLowerCase();
          return (
            l.length >= 3 &&
            !["the", "this", "that", "game", "chat", "stream", "thing", "someone", "anyone"].includes(l)
          );
        });

      // Special check: look for capitalized words or key entities like "George"
      const capitalizedWords = text.match(/\b[A-Z][a-z]{2,}\b/g) || [];
      for (const cap of capitalizedWords) {
        if (!filtered.includes(cap) && !["The", "This", "That", "What", "When", "Where", "How"].includes(cap)) {
          filtered.unshift(cap);
        }
      }

      return Array.from(new Set(filtered)).slice(0, 4);
    } catch {
      return [];
    }
  }
}

export const localHypeDetector = new LocalHypeDetector();
