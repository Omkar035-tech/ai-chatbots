import { llmRouter } from "../llm/router";
import Redis from "ioredis";

// Disallow user_##### or viewer_##### patterns
export const FORBIDDEN_USERNAME_REGEX = /^(user|viewer|chat_user|bot)_?\d+$/i;

// Procedural word pools for generating 1000+ organic, funny, natural stream usernames
const FUNNY_PHRASES = [
  "pickthatsamosa34", "normandead53", "keyboard_warrior9", "couch_commander",
  "potatoking99", "toast_with_butter", "crying_in_the_club", "lag_is_my_excuse",
  "wifi_went_out", "cereal_first", "sleepy_sloth", "dusty_cartridge",
  "alt_f4_believer", "milk_before_cereal", "spicy_ramen_god", "wholesome_potato",
  "buffering_forever", "dropped_my_pie", "sneaky_penguin", "rubber_duck_debug",
  "no_cap_fr", "certified_yapper", "overcooked_rice", "forgot_my_password",
  "sleepwalking_panda", "desk_slammer_99", "water_cooler_gossip", "crying_in_4k"
];

const NAME_WORDS = [
  "devid_rascal", "alex_offline", "sammy_lost", "vikram_gaming", "jordan_runs",
  "marcus_streams", "elena_lurks", "lucas_afk", "maya_chats", "felix_jumps",
  "charlie_vibes", "leo_lost_again", "omkar_fan99", "omkar_enjoyer", "omkar_sub_01"
];

const GAMER_TAGS = [
  "xX_snipez_Xx", "NoScopeNinja", "VoidWalker99", "PhantomPixel", "AimAssistAbuser",
  "SilentHeadshot", "ShadowStrike", "HeadshotHoney", "VortexSlayer", "PixelReaper",
  "HyperDash", "StealthByte", "GlitchMatrix", "IronSightsOnly", "ApexPredator_01",
  "RespawnDenier", "ClutchOrKick99", "ZeroPingGod", "WallBangBilly", "QuickScopeKing"
];

const DESI_HINGLISH = [
  "chaiandchill", "bhaiyakabhai", "samosa_sniper", "jalebi_baby9", "paneer_enjoyer",
  "biryani_bandit", "golgappa_gang", "masala_dosa_fan", "paratha_papi", "kadai_paneer_op",
  "gulab_jamun_w", "desidrip99", "butter_chicken_bro", "chole_bhature_fan", "chai_pe_charcha"
];

const CAMEL_CASE = [
  "NeonViper", "PixelDrifter", "FrostedFlakes", "DarkMatter", "ByteMe", "CosmicRider",
  "ZeroGravity", "VelvetThunder", "QuickSilver", "IronClad", "StaticShock", "SolarFlare",
  "QuantumLeap", "SilverFox", "ShadowDancer", "EchoChamber", "ThunderStorm", "NovaBlaze"
];

const LOWERCASE_DIGITS = [
  "harsh0407", "rohan99", "zack2003", "milo02", "kyle98", "danny04", "noah2001",
  "lucas97", "leo05", "liam2000", "aravind03", "nikhil98", "toby04", "marcus99"
];

const PLAIN_NAMES = [
  "mike_2003", "sarah_m98", "chris_b21", "david_k_01", "emily_w99", "johnny_b_good",
  "matthew_r95", "jessica_t02", "dan_w_99", "ryan_p04", "emma_rose99", "ben_dover_not"
];

export class UsernameGenerator {
  private redis: Redis | null = null;
  private memoryPool: Set<string> = new Set();
  private assignedMap: Map<string, string> = new Map();

  constructor(redisClient?: Redis | null) {
    if (redisClient) this.redis = redisClient;
    this.seedProceduralPool();
  }

  public setRedis(redisClient: Redis) {
    this.redis = redisClient;
  }

  private seedProceduralPool() {
    const all = [
      ...FUNNY_PHRASES,
      ...NAME_WORDS,
      ...GAMER_TAGS,
      ...DESI_HINGLISH,
      ...CAMEL_CASE,
      ...LOWERCASE_DIGITS,
      ...PLAIN_NAMES,
    ];

    for (const name of all) {
      if (this.isValidUsername(name)) {
        this.memoryPool.add(name);
      }
    }

    // Synthesize combinatorial combinations to reach 600+ unique procedural names
    const prefixes = ["chill", "epic", "sneaky", "toxic", "wild", "lazy", "pure", "lost", "super", "hyper", "salty", "mini", "crazy", "sleepy"];
    const nouns = ["panda", "koala", "waffle", "muffin", "gamer", "sloth", "duck", "ninja", "sniper", "bhai", "rascal", "wizard", "cookie", "cactus", "potato"];
    const suffixes = ["99", "04", "07", "2003", "2001", "42", "77", "_", "x", "tv", "hd", ""];

    for (const p of prefixes) {
      for (const n of nouns) {
        for (const s of suffixes) {
          const candidate = `${p}_${n}${s}`;
          if (this.isValidUsername(candidate)) {
            this.memoryPool.add(candidate);
          }
        }
      }
    }
  }

  public isValidUsername(name: string): boolean {
    if (!name || typeof name !== "string") return false;
    const clean = name.trim();
    if (clean.length < 4 || clean.length > 22) return false;
    if (FORBIDDEN_USERNAME_REGEX.test(clean)) return false;
    // Check for slurs or inappropriate words
    const lower = clean.toLowerCase();
    const banned = ["nigger", "faggot", "retard", "hitler", "nazi", "pedophile"];
    if (banned.some((b) => lower.includes(b))) return false;
    return true;
  }

  public async initPool(): Promise<void> {
    if (this.redis) {
      try {
        const count = await this.redis.scard("usernames:pool");
        if (count < 200) {
          console.log(`[UsernameGenerator] Seeding Redis usernames:pool (current count: ${count})...`);
          const pipeline = this.redis.pipeline();
          for (const name of this.memoryPool) {
            pipeline.sadd("usernames:pool", name);
          }
          await pipeline.exec();
        }
      } catch (err: any) {
        console.warn("[UsernameGenerator] Redis init error:", err.message);
      }
    }
  }

  public async fetchLLMUsernames(neededCount: number = 300): Promise<string[]> {
    try {
      const prompt = `Generate a JSON object with a "usernames" array containing ${neededCount} funny, diverse Twitch stream chat usernames.
Mix styles:
- Funny phrases (e.g. pickthatsamosa34, normandead53)
- Name + words (e.g. devid_rascal, alex_offline)
- Gamer tags (e.g. xX_snipez_Xx, NoScopeNinja)
- Lowercase + digits (e.g. harsh0407, rohan99)
- Desi/Hinglish humor (e.g. chaiandchill, bhaiyakabhai, samosa_sniper)
- Plausible birth years / numbers (e.g. mike_2003)
RULES:
- NEVER use "user_#####", "user123", or "viewer_#####"
- Length 4-20 chars
- No slurs or famous streamers
- Respond ONLY with valid JSON: {"usernames": ["..."]}`;

      const res = await llmRouter.complete_json("persona_gen", prompt, "Generate stream chat usernames.");
      if (res && Array.isArray(res.usernames)) {
        const valid = res.usernames.filter((n: string) => this.isValidUsername(n));
        console.log(`[UsernameGenerator] LLM generated ${valid.length} valid usernames.`);
        if (this.redis && valid.length > 0) {
          const p = this.redis.pipeline();
          for (const name of valid) {
            p.sadd("usernames:pool", name);
            this.memoryPool.add(name);
          }
          await p.exec();
        }
        return valid;
      }
    } catch (err: any) {
      console.warn("[UsernameGenerator] LLM username generation failed, using procedural pool:", err.message);
    }
    return [];
  }

  public async getUsernameForPersona(personaId: string, fallbackSeed?: string): Promise<string> {
    // 1. Check in-memory assignment cache
    if (this.assignedMap.has(personaId)) {
      return this.assignedMap.get(personaId)!;
    }

    // 2. Check Redis assigned hash
    if (this.redis) {
      try {
        const stored = await this.redis.hget("persona:names", personaId);
        if (stored && this.isValidUsername(stored)) {
          this.assignedMap.set(personaId, stored);
          return stored;
        }
      } catch {}
    }

    // 3. If fallbackSeed is already valid and not forbidden, keep it
    if (fallbackSeed && this.isValidUsername(fallbackSeed) && !FORBIDDEN_USERNAME_REGEX.test(fallbackSeed)) {
      await this.persistAssignment(personaId, fallbackSeed);
      return fallbackSeed;
    }

    // 4. Pop a unique random name from pool
    let chosen = "";
    if (this.redis) {
      try {
        const popped = await this.redis.spop("usernames:pool");
        if (popped && this.isValidUsername(popped)) {
          chosen = popped;
        }
      } catch {}
    }

    if (!chosen) {
      // Pick from memory pool
      const poolArr = Array.from(this.memoryPool);
      const randIdx = Math.floor(Math.random() * poolArr.length);
      chosen = poolArr[randIdx] || `gamer_${Date.now().toString(36)}`;
      this.memoryPool.delete(chosen);
    }

    await this.persistAssignment(personaId, chosen);
    return chosen;
  }

  private async persistAssignment(personaId: string, name: string): Promise<void> {
    this.assignedMap.set(personaId, name);
    if (this.redis) {
      try {
        await this.redis.hset("persona:names", personaId, name);
      } catch {}
    }
  }
}

export const usernameGenerator = new UsernameGenerator();
