import Redis from "ioredis";
import { config } from "../config";
import { PersonaProfile, ChatMessageItem, SettingsState } from "./types";
import archetypesData from "./archetypes.json";
import { llmRouter } from "../llm/router";
import { usernameGenerator, FORBIDDEN_USERNAME_REGEX } from "./usernames";
import { messageBank } from "../bank/store";
import { apiBudget } from "../llm/budget";
import { batchJob } from "../pipeline/batch_job";
import fs from "fs";
import path from "path";

export class PersonaStore {
  private redis: Redis;
  private isConnected: boolean = false;
  private memoryPersonas: Map<string, PersonaProfile> = new Map();
  private memoryOrder: string[] = [];
  private memoryRecentChat: ChatMessageItem[] = [];
  private memoryPersonaRecent: Map<string, string[]> = new Map();
  private memorySettings: SettingsState = {
    botCount: 20,
    momentDepth: 5,
    speedMultiplier: 1.0,
    enabled: true,
    ambientChatter: true,
    aiLabel: false,
  };

  constructor() {
    this.redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
    });

    this.redis.on("connect", () => {
      this.isConnected = true;
      console.log("[Redis] Connected successfully to", config.redisUrl);
      llmRouter.setRedis(this.redis);
      messageBank.setRedis(this.redis);
      messageBank.init();
      apiBudget.setRedis(this.redis);
      batchJob.setRedis(this.redis);
      usernameGenerator.setRedis(this.redis);
      usernameGenerator.initPool();
    });

    this.redis.on("error", (err) => {
      console.warn("[Redis] Connection error:", err.message);
      this.isConnected = false;
    });
  }

  public getRedis(): Redis {
    return this.redis;
  }

  public async init() {
    try {
      await this.initSettings();
      await this.initSeedPersonas();
    } catch (err: any) {
      console.warn("[PersonaStore] Init error:", err.message);
    }
  }

  private async initSettings() {
    if (!this.isConnected) return;
    try {
      const exists = await this.redis.exists("state:settings");
      if (!exists) {
        await this.saveSettings(this.memorySettings);
      } else {
        this.memorySettings = await this.getSettings();
      }
    } catch {
      // ignore
    }
  }

  public async getSettings(): Promise<SettingsState> {
    if (!this.isConnected) return { ...this.memorySettings };
    try {
      const data = await this.redis.hgetall("state:settings");
      if (data && Object.keys(data).length > 0) {
        this.memorySettings = {
          botCount: parseInt(data.bot_count || "20", 10),
          momentDepth: parseInt(data.moment_depth || "5", 10),
          speedMultiplier: parseFloat(data.speed_multiplier || "1.0"),
          enabled: data.enabled === "true",
          ambientChatter: data.ambient_chatter !== "false",
          aiLabel: data.ai_label_enabled === "true",
        };
      }
    } catch {
      // fallback to memory
    }
    return { ...this.memorySettings };
  }

  public async saveSettings(newSettings: Partial<SettingsState>): Promise<SettingsState> {
    this.memorySettings = { ...this.memorySettings, ...newSettings };
    if (this.isConnected) {
      try {
        await this.redis.hset("state:settings", {
          bot_count: this.memorySettings.botCount.toString(),
          moment_depth: this.memorySettings.momentDepth.toString(),
          speed_multiplier: this.memorySettings.speedMultiplier.toString(),
          enabled: this.memorySettings.enabled.toString(),
          ambient_chatter: this.memorySettings.ambientChatter.toString(),
          ai_label_enabled: this.memorySettings.aiLabel.toString(),
        });
      } catch {
        // ignore
      }
    }
    return { ...this.memorySettings };
  }

  private async initSeedPersonas() {
    const existingCount = await this.getAllPersonasCount();
    if (existingCount === 0) {
      console.log("[PersonaStore] Initializing personas from archetypes...");
      for (const arch of archetypesData) {
        const profile: PersonaProfile = {
          id: arch.id,
          name: arch.name,
          color: arch.color,
          age_group: arch.age_group,
          vibe: arch.vibe,
          slang_style: arch.slang_style,
          typing_style: arch.typing_style,
          emoji_rate: arch.emoji_rate,
          caps_rate: arch.caps_rate,
          reaction_bias: arch.reaction_bias,
          catchphrases: arch.catchphrases,
          energy: arch.energy,
          created_at: Date.now(),
        };
        await this.savePersona(profile);
      }
    }
    // Ensure at least botCount personas exist
    await this.ensurePersonaCount(this.memorySettings.botCount);
  }

  public async getAllPersonasCount(): Promise<number> {
    if (!this.isConnected) return this.memoryOrder.length;
    try {
      return await this.redis.zcard("personas:all");
    } catch {
      return this.memoryOrder.length;
    }
  }

  public async savePersona(p: PersonaProfile): Promise<void> {
    this.memoryPersonas.set(p.id, p);
    if (!this.memoryOrder.includes(p.id)) {
      this.memoryOrder.push(p.id);
    }

    if (this.isConnected) {
      try {
        await this.redis.hset(`persona:${p.id}`, {
          id: p.id,
          name: p.name,
          color: p.color,
          age_group: p.age_group,
          vibe: p.vibe,
          slang_style: p.slang_style,
          typing_style: p.typing_style,
          emoji_rate: p.emoji_rate.toString(),
          caps_rate: p.caps_rate.toString(),
          reaction_bias: p.reaction_bias,
          catchphrases: JSON.stringify(p.catchphrases),
          energy: p.energy.toString(),
          created_at: p.created_at.toString(),
        });
        await this.redis.zadd("personas:all", p.created_at, p.id);
      } catch (err: any) {
        console.warn(`[PersonaStore] Error saving persona ${p.id}:`, err.message);
      }
    }
  }

  public async getPersona(id: string): Promise<PersonaProfile | null> {
    if (this.memoryPersonas.has(id)) {
      return this.memoryPersonas.get(id)!;
    }
    if (!this.isConnected) return null;

    try {
      const data = await this.redis.hgetall(`persona:${id}`);
      if (!data || !data.id) return null;
      let personaName = data.name;
      if (!personaName || FORBIDDEN_USERNAME_REGEX.test(personaName)) {
        personaName = await usernameGenerator.getUsernameForPersona(data.id);
        if (this.isConnected) {
          await this.redis.hset(`persona:${data.id}`, "name", personaName);
        }
      }

      const profile: PersonaProfile = {
        id: data.id,
        name: personaName,
        color: data.color || "#38bdf8",
        age_group: data.age_group || "gen_z",
        vibe: data.vibe || "stream viewer",
        slang_style: data.slang_style || "casual",
        typing_style: data.typing_style || "standard",
        emoji_rate: parseFloat(data.emoji_rate || "0.2"),
        caps_rate: parseFloat(data.caps_rate || "0.1"),
        reaction_bias: data.reaction_bias || "hype",
        catchphrases: data.catchphrases ? JSON.parse(data.catchphrases) : [],
        energy: parseInt(data.energy || "5", 10),
        created_at: parseInt(data.created_at || "0", 10),
      };
      this.memoryPersonas.set(profile.id, profile);
      return profile;
    } catch {
      return null;
    }
  }

  public async getActivePersonas(): Promise<PersonaProfile[]> {
    const settings = await this.getSettings();
    const count = settings.botCount;
    await this.ensurePersonaCount(count);

    let activeIds: string[] = [];
    if (this.isConnected) {
      try {
        // Deterministic: first N from personas:all
        activeIds = await this.redis.zrange("personas:all", 0, count - 1);
      } catch {
        activeIds = this.memoryOrder.slice(0, count);
      }
    } else {
      activeIds = this.memoryOrder.slice(0, count);
    }

    const personas: PersonaProfile[] = [];
    for (const id of activeIds) {
      const p = await this.getPersona(id);
      if (p) personas.push(p);
    }

    return personas;
  }

  public async ensurePersonaCount(targetCount: number): Promise<void> {
    const currentCount = await this.getAllPersonasCount();
    if (currentCount >= targetCount) {
      return;
    }

    const needed = targetCount - currentCount;
    console.log(`[PersonaStore] Generating ${needed} missing personas to reach ${targetCount}...`);

    try {
      const promptPath = path.join(process.cwd(), "src/server/llm/prompts/persona_gen.txt");
      let systemPrompt = "";
      if (fs.existsSync(promptPath)) {
        systemPrompt = fs.readFileSync(promptPath, "utf-8");
      }

      const generated = await llmRouter.complete_json(
        "persona_gen",
        systemPrompt,
        `Generate ${needed} unique stream chat personas. Existing total count is ${currentCount}.`
      );

      if (generated && Array.isArray(generated.personas)) {
        for (const raw of generated.personas) {
          const id = raw.id || `p_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          const organicName = await usernameGenerator.getUsernameForPersona(id, raw.name);
          const profile: PersonaProfile = {
            id,
            name: organicName,
            color: raw.color || "#a855f7",
            age_group: raw.age_group || "gen_z",
            vibe: raw.vibe || "viewer",
            slang_style: raw.slang_style || "casual chat",
            typing_style: raw.typing_style || "standard",
            emoji_rate: typeof raw.emoji_rate === "number" ? raw.emoji_rate : 0.25,
            caps_rate: typeof raw.caps_rate === "number" ? raw.caps_rate : 0.1,
            reaction_bias: raw.reaction_bias || "hype",
            catchphrases: Array.isArray(raw.catchphrases) ? raw.catchphrases : ["no shot", "LMAO", "classic"],
            energy: typeof raw.energy === "number" ? raw.energy : 5,
            created_at: Date.now() + Math.floor(Math.random() * 50),
          };
          await this.savePersona(profile);
        }
      }
    } catch (err: any) {
      console.warn("[PersonaStore] Persona generation LLM call failed, using synthetic fallback:", err.message);
    }

    // Check if still need more (fallback synthesis)
    const afterCount = await this.getAllPersonasCount();
    if (afterCount < targetCount) {
      const stillNeeded = targetCount - afterCount;
      const colors = ["#38bdf8", "#a855f7", "#ec4899", "#22c55e", "#f97316", "#eab308", "#14b8a6", "#ef4444"];
      const biases = ["troll", "hype", "supportive", "lurker", "backseat", "joker", "skeptic"];
      const typingStyles = ["lowercase_casual", "caps_hype", "short_lurker", "question_asker", "meme_spammer"];

      for (let i = 0; i < stillNeeded; i++) {
        const id = `p_synth_${Date.now()}_${i}`;
        const organicName = await usernameGenerator.getUsernameForPersona(id);
        const profile: PersonaProfile = {
          id,
          name: organicName,
          color: colors[i % colors.length],
          age_group: i % 2 === 0 ? "gen_z" : "millennial",
          vibe: "casual streamer enthusiast",
          slang_style: "twitch chatter slang",
          typing_style: typingStyles[i % typingStyles.length],
          emoji_rate: 0.2,
          caps_rate: 0.1,
          reaction_bias: biases[i % biases.length],
          catchphrases: ["no shot", "clean", "wait what", "LMAO", "ggs"],
          energy: Math.floor(Math.random() * 8) + 2,
          created_at: Date.now() + i,
        };
        await this.savePersona(profile);
      }
    }
  }

  public async getRecentChat(limit: number = 25): Promise<ChatMessageItem[]> {
    if (!this.isConnected) {
      return this.memoryRecentChat.slice(0, limit);
    }
    try {
      const raw = await this.redis.lrange("chat:recent", 0, limit - 1);
      return raw.map((item) => JSON.parse(item));
    } catch {
      return this.memoryRecentChat.slice(0, limit);
    }
  }

  public async addChatMessage(msg: ChatMessageItem): Promise<void> {
    this.memoryRecentChat.unshift(msg);
    if (this.memoryRecentChat.length > 50) {
      this.memoryRecentChat = this.memoryRecentChat.slice(0, 50);
    }

    const personaMsgs = this.memoryPersonaRecent.get(msg.personaId) || [];
    personaMsgs.unshift(msg.text);
    if (personaMsgs.length > 10) personaMsgs.length = 10;
    this.memoryPersonaRecent.set(msg.personaId, personaMsgs);

    if (this.isConnected) {
      try {
        await this.redis.lpush("chat:recent", JSON.stringify(msg));
        await this.redis.ltrim("chat:recent", 0, 49);

        await this.redis.lpush(`persona:${msg.personaId}:recent`, msg.text);
        await this.redis.ltrim(`persona:${msg.personaId}:recent`, 0, 9);
      } catch {
        // ignore
      }
    }
  }

  public async getPersonaRecentMessages(personaId: string, limit: number = 3): Promise<string[]> {
    if (!this.isConnected) {
      return (this.memoryPersonaRecent.get(personaId) || []).slice(0, limit);
    }
    try {
      const msgs = await this.redis.lrange(`persona:${personaId}:recent`, 0, limit - 1);
      return msgs;
    } catch {
      return (this.memoryPersonaRecent.get(personaId) || []).slice(0, limit);
    }
  }

  public async clearChat(): Promise<void> {
    this.memoryRecentChat = [];
    if (this.isConnected) {
      try {
        await this.redis.del("chat:recent");
      } catch {
        // ignore
      }
    }
  }

  public async getLastDirectorFireTs(): Promise<number> {
    if (!this.isConnected) return 0;
    try {
      const val = await this.redis.get("director:last_fire_ts");
      return val ? parseInt(val, 10) : 0;
    } catch {
      return 0;
    }
  }

  public async setLastDirectorFireTs(ts: number): Promise<void> {
    if (this.isConnected) {
      try {
        await this.redis.set("director:last_fire_ts", ts.toString());
      } catch {
        // ignore
      }
    }
  }
}

export const personaStore = new PersonaStore();
