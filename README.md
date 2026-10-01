# CrowdChat 🎙️💬
> **AI-Driven Fake Stream Chat Portal for Solo Streamers**

CrowdChat generates an authentic, organic simulated stream audience that reacts to your voice in real time. Built specifically to eliminate AI repetition, generic filler, and free-tier LLM quota exhaustion, CrowdChat operates on an intelligent **Three-Tier Architecture** that serves most reactions locally with zero API calls.

---

## 1. Architecture: The Three-Tier Design

```text
                         ┌──────────────────────────────────────────────┐
 Mic → Jarvis STT ──►    │ Redis Stream  transcript:stream (all text)   │
                         └───────┬───────────────────────┬──────────────┘
                                 │ live (every ~2-3 s)   │ every 3-5 min
                                 ▼                       ▼
                    TIER 0: Local Hype Detector     TIER 1: Batch Refill Job (1 API cycle)
                    + Local Matcher + Humanizer     → pins exact moments (moments:pins)
                    (0 API calls)                   → returns 350+ messages → Message Bank
                                 │                       ▲
                                 │ novel + intense + no good bank match
                                 ▼                       │
                    TIER 2: Reactive micro-call ─────────┘ (rare, <= 20/hr, >= 90s apart)
                                 │
                                 ▼
                    Scheduler → GraphQL Subscription → Transparent OBS Overlay
```

### Three-Tier Engine Breakdown:
1. **Tier 0 (Live, 0 API Calls):**
   - **Local Multi-Signal Hype Detector:** Runs on a sliding window of recent speech. Computes a normalized hype score (0–10) across 8 signals adapted against your rolling 5-minute personal baseline.
   - **Local Matcher:** Pulls pre-written candidate messages from the Message Bank, fills entity slots (e.g. `{subject} got cooked` → `George got cooked`), and selects responders based on persona energy and bias.
   - **Humanizer:** Enforces individual typing transforms, emoji governance, Twitch emotes, and anti-repetition trigram filtering locally.
2. **Tier 1 (Every 3–5 min, 1 API Cycle):**
   - Background batch job reads new transcript chunks from Redis Stream (`transcript:stream`).
   - Pins exact stream moments into `moments:pins`.
   - Generates 350+ lines in a compact, truncation-tolerant format to keep the Message Bank filled with 300+ safe, deduplicated lines.
   - Seeds delayed **callbacks and running jokes** released 20s to 5 minutes later (`still thinking about george lol`).
3. **Tier 2 (Rare Micro-Call):**
   - Triggered *only* when a moment is both highly novel/absurd (`absurd: true`) and intense (`intensity >= 8`), and local bank candidates lack specific entity matches.
   - Governed by hard caps: max 1 per 90s, max 20 per hour. Can be toggled with `REACTIVE_CALLS=on|off`.

---

## 2. Design Tradeoffs

- **Zero Live Per-Chunk LLM Calls:** Previously, calling an LLM on every sentence burned free-tier quotas within minutes, suffered model rate-limits (HTTP 429), and caused phrase repetition ("mode collapse"). Moving live evaluation to local signal detection eliminates live API costs entirely.
- **Tier 1 Past-Context vs Live Latency:** Tier 1 background jobs generate banter and callbacks from the *recent past* of your stream. Immediate live reactions are powered by Tier 0 slot-filling and Tier 2 micro-calls. Real Twitch/YouTube stream chats naturally lag 2–6 seconds behind video, making this delay indistinguishable from genuine viewer latency.
- **Offline / Zero API Resilience:** Shipped with `seed-bank.json` (520+ pre-written authentic stream chat messages). Even if all API keys are omitted or providers fail, CrowdChat continues operating smoothly from the bank.

---

## 3. Humanizer & Anti-Repetition Rules

- **Organic Usernames:** Eliminates `user_#####`. Generates realistic gamer tags, Hinglish/desi names, funny phrases, and CamelCase names (`pickthatsamosa34`, `normandead53`, `sneaky_rascal`, `ProStrat9000`). Usernames persist deterministically per persona.
- **Emoji Governor:**
  - Only **15–25%** of all chat messages contain an emoji (most contain none).
  - Max 1 emoji per message.
  - Signatures drawn from an 18-emoji pool: `😂 🤣 😭 💀 🔥 😳 🤨 👀 🫡 🥶 😮 🙏 🗿 😬 🤡 👏 ❤️ 😅`.
  - Global rule: No single emoji may exceed **25%** of emojis used in the last 50 messages; never the same emoji in consecutive messages.
- **Twitch-Style Text Emotes:** Real emote tokens rendered in 12–16% of chat messages:
  `KEKW`, `LUL`, `OMEGALUL`, `LULW`, `Pog`, `PogChamp`, `monkaS`, `Sadge`, `Copium`, `Clap`, `5Head`, `ICANT`, `EZ`, `GIGACHAD`, `Pepega`, `D:`.
- **Anti-Repetition Trigram Filter:** Rejects any message with character trigram similarity > 0.6 compared to recent messages.
- **Dynamic Banned Phrase List:** If a phrase or structure appears > 3 times in 50 messages, it is auto-banned for 10 minutes. Includes permanent bans on repetitive AI boilerplate (`"chill vibes fr bro 💀 W"`). No more than 10% of messages may start with `"bro"`.

---

## 4. Multi-Signal Local Hype Detector

Computes `hype_score` (0.0 to 10.0) with hysteresis (`T_HIGH: 6.2`, `T_LOW: 3.8`) across 8 normalized signals:
| Signal | Source & Method |
|---|---|
| **Mic Loudness** | RMS audio level normalized against rolling 5-minute baseline |
| **Speech Rate** | Words per second jump vs baseline |
| **Caps & Exclamations** | ALL CAPS ratio and multiple exclamation marks |
| **Laughter & Shouts** | Lexicon tokens (`hahaha`, `omg`, `no no no`) |
| **Event Keywords** | Keyword taxonomy in `src/server/pipeline/keywords.json` (`win`, `rage`, `jumpscare`, `funny`) |
| **Questions to Chat** | Pattern matching (`chat what do you think`, `should I`) |
| **Novelty / Absurdity** | Entity divergence, rare words, and bizarre semantic pairings |
| **Silence Gap** | Sudden speech following silence |

---

## 5. Getting Started

### Prerequisites
- Node.js >= 18.17 (tested on Node v22)
- pnpm >= 8 (or npm / yarn)
- Local Redis service (running on port 6379)

### Installation
```bash
pnpm install
```

### Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Key configuration parameters in `.env`:
```env
# Optional LLM API Keys (Falls back to local Message Bank if keys are absent)
GEMINI_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=

# Three-Tier Tuning
BATCH_INTERVAL_SEC=240      # Tier 1 batch refill interval (180-300s with ±40s jitter)
BANK_LOW_WATER=120          # Threshold of unused messages before early batch refill
REACTIVE_CALLS=on           # on | off - Allows Tier 2 micro-calls for novel/absurd moments
T_HIGH=6.2                  # Hype moment start trigger threshold
T_LOW=3.8                   # Hype moment decay/end threshold
```

### Running the App
```bash
# Start Next.js + GraphQL Yoga + WebSocket server
npm run dev
# or
pnpm run start
```
- **Control Panel:** `http://localhost:3002/control` (includes the live telemetry debug panel)
- **OBS Browser Source:** `http://localhost:3002/overlay`
- **GraphQL API:** `http://localhost:3002/api/graphql`

---

## 6. Testing & Replay Harness

Run the automated replay test harness without needing a microphone:
```bash
npm run replay -- sample-transcript.txt --speed 10
```

### Replay Acceptance Criteria Verification:
1. **George Sentence Relevance:** At least half of messages emitted for novel absurd moments directly reference the quote entities (e.g. `GEORGE WAS NOT READY FOR THAT OMEGALUL`, `someone check on george 🗿`).
2. **API Budget Governor:** Strict limits enforced (<= 20 batch cycles/hr, <= 10 reactive calls/hr).
3. **Emoji & Emote Governor:** Strict 15–25% emoji distribution, no single emoji > 25% share, >= 6 distinct emojis, Twitch text emotes present.
4. **Zero Robotic Usernames:** 0 usernames matching `user_\d+` or `viewer_\d+`.
5. **Anti-Repetition:** 0 message pairs with trigram similarity > 0.6; repetitive patterns eliminated.
6. **Resilience:** Works 100% locally from the Message Bank with zero active API keys.


Commands: pnpm dev for server start 
internal server.ts file command: export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:./node_modules/.bin:$PATH" && NODE_ENV=production ./node_modules/.bin/tsx server.ts