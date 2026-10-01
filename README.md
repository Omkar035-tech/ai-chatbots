# CrowdChat 🎙️💬
> **AI-Driven Fake Stream Chat Portal for Solo Streamers**

CrowdChat generates an authentic, simulated stream audience that reacts to your voice in real time. It captures speech from your microphone, evaluates the emotional intensity of gameplay moments using an AI **Director**, crafts unique in-character messages using a **Writer**, and releases chat bursts onto a transparent **OBS Browser Source Overlay**.

---

## 1. Architecture

```text
 Mic ──► [Jarvis STT module] ──► transcript events
                                     │
                                     ▼
                        ┌─────────────────────────┐
                        │ Context Buffer           │  rolling window (last ~30s) + short summary
                        └───────────┬─────────────┘
                                    ▼
                        ┌─────────────────────────┐
                        │ Pre-filter (no LLM)      │  cooldown, min length, keyword/volume/caps heuristics
                        └───────────┬─────────────┘
                                    ▼
                        ┌─────────────────────────┐
                        │ Director (LLM)           │  → { react: yes/no, event_type, intensity 0-10, reason }
                        └───────────┬─────────────┘
                              yes   │
                                    ▼
   Redis ◄──────────────► ┌─────────────────────────┐
   (personas, history)    │ Persona Selector         │  picks N of the active bots, weights by event fit + recency
                          └───────────┬─────────────┘
                                      ▼
                          ┌─────────────────────────┐
                          │ Writer (LLM, 1 batch call)│ → [{persona_id, text, reaction_type}]
                          └───────────┬─────────────┘
                                      ▼
                          ┌─────────────────────────┐
                          │ Safety Filter            │  blocklist + length + dedupe
                          └───────────┬─────────────┘
                                      ▼
                          ┌─────────────────────────┐
                          │ Scheduler                │  random delays scaled by intensity
                          └───────────┬─────────────┘
                                      ▼  GraphQL subscription
                          Overlay page (OBS Browser Source)   +   Control Panel (sliders)

 All LLM calls go through ► [Provider Router: Gemini ⇄ Groq ⇄ OpenRouter] with auto-failover
```

---

## 2. Stack & Design (Matching Jarvis)

- **Speech-to-Text (STT):** Reuses the browser Web Speech API module from `jarvis/` (`useSpeechRecognition.ts`) as-is. Transcripts are converted into `{ text, is_final, timestamp }` events and submitted to the server via the `submitTranscript` GraphQL mutation.
- **Framework & Runtime:** Next.js 16 (App Router), React 19, TypeScript, persistent Node process (`server.ts`).
- **GraphQL:** GraphQL Yoga engine with `@apollo/client` on frontend; live subscriptions over WebSocket (`graphql-ws` + `ws`).
- **Data Stores:**
  - **Redis:** Personas (`persona:{id}`), deterministic ordering (`personas:all`), recent chat history (`chat:recent`, `persona:{id}:recent`), and settings (`state:settings`).
  - **IndexedDB:** In-browser client cache in `/overlay` for instant roster restoration across reconnects.
- **LLM Failover Router:** Connects Google AI Studio (Gemini), Groq, and OpenRouter with automatic failover on HTTP 429, timeouts, rate-limit headers, or quota exhaustion.

---

## 3. Getting Started

### Prerequisites

- Node.js >= 18.17 (tested on Node v22)
- pnpm >= 8 (or npm / yarn)
- Docker (for Redis) or local Redis service

### Installation

```bash
# Install dependencies
pnpm install
```

### Environment Configuration

Copy the example environment file to `.env`:

```bash
cp .env.example .env
```

Open `.env` and fill in your free-tier API keys:

```env
# LLM API Keys
GEMINI_API_KEY=your_gemini_api_key_here
GROQ_API_KEY=your_groq_api_key_here
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Model Configurations
GEMINI_MODEL=gemini-2.5-flash
GROQ_MODEL=llama-3.3-70b-versatile
OPENROUTER_MODEL=liquid/lfm-2.5-2.6b

# Priority / Fallback Chains
LLM_PRIORITY_DIRECTOR=groq,gemini,openrouter
LLM_PRIORITY_WRITER=gemini,groq,openrouter

# Redis
REDIS_URL=redis://localhost:6379

# Server and GraphQL Endpoints
PORT=3002
NEXT_PUBLIC_GRAPHQL_URL=http://localhost:3002/api/graphql
NEXT_PUBLIC_GRAPHQL_WS_URL=ws://localhost:3002/graphql
```

### Start Redis

```bash
# Using docker-compose
docker compose up -d

# Or start brew redis on macOS
brew services start redis
```

### Run CrowdChat

```bash
# Start development server
pnpm dev

# Or build and start production server
pnpm build
pnpm start
```

Endpoints:
- **Control Panel:** [http://localhost:3002/control](http://localhost:3002/control)
- **OBS Stream Overlay:** [http://localhost:3002/overlay](http://localhost:3002/overlay)
- **GraphQL HTTP Endpoint:** [http://localhost:3002/api/graphql](http://localhost:3002/api/graphql)
- **GraphQL WebSocket Endpoint:** `ws://localhost:3002/graphql`

---

## 4. OBS Studio Setup Guide

1. Open **OBS Studio**.
2. Under the **Sources** panel, click **+** and select **Browser**.
3. Name it **"CrowdChat Overlay"** and click **OK**.
4. Configure the Browser Source settings:
   - **URL:** `http://localhost:3002/overlay`
     - Custom sizing params: `http://localhost:3002/overlay?width=420&font=18&fade=1`
       - `width`: Overlay chat column width in pixels (default: `420`).
       - `font`: Font size in pixels (default: `16`).
       - `fade`: Set `1` for top fade-out gradient or `0` for none.
   - **Width:** `450`
   - **Height:** `650` (or your preferred chat box height)
   - **Custom CSS:** Clear default CSS, or leave blank (page is natively transparent: `html, body { background: transparent }`).
   - Check **"Shutdown source when not visible"** (optional).
   - Check **"Refresh browser when scene becomes active"**.
5. Click **OK**. Position the chat overlay on your stream layout!

---

## 5. Control Panel Features (`/control`)

- **Speech Recognition (Mic Toggle):** Start / stop live microphone recognition with real-time transcript streaming.
- **Bot Count Slider (5 to 100):** Adjusts the active audience size. Personas are deterministic: lowering from 40 to 10 and back to 40 returns the identical 40 viewers in the exact same order.
- **Moment Depth Slider (0 to 10):** Biases reaction intensity:
  - `0 - 3`: Chill, sparse, occasional friendly comments.
  - `4 - 6`: Standard stream chatter, questions, and reactions.
  - `7 - 10`: Chaotic, high-intensity pile-ons, fast roasts, caps spam.
- **Chat Speed Multiplier (0.2x to 3.0x):** Accelerates or slows release intervals between messages.
- **Ambient Chatter Toggle:** Automatically injects subtle, in-character idle chatter when gameplay is quiet for 45-120 seconds.
- **Show AI Label Toggle:** Toggles a small `"AI Simulated Audience"` badge in the corner of the OBS overlay.
- **Instant Test Triggers:**
  - **Hype Burst:** Triggers an immediate victory celebration.
  - **Troll Wave:** Triggers an immediate light-roast wave.
  - **Question:** Triggers gameplay inquiries directed at the streamer.
  - **Simulate Transcript:** Input box to type any phrase (e.g. *"No way, I hate this game, I'm done!"*) without speaking.
- **Live Telemetry Cards:** Real-time visibility into the Director's decisions, active LLM provider, healthy status, calls per minute, and cooldown timers.

---

## 6. Running Tests

Run the complete end-to-end acceptance suite:

```bash
pnpm test
```

The test suite validates:
1. **Rage/Hype Detection:** High emotion speech triggers PreFilter and Director `YES` with high intensity.
2. **Mundane Speech Filtering:** Short, casual speech is skipped or rejected with `NO`.
3. **Deterministic Roster Slicing:** Bot count transitions (40 -> 10 -> 40) preserve identical personas in stable creation order.
4. **Writer Output Quality:** Compact chat lines (<= 120 chars) in authentic internet/gaming vernacular.
5. **Safety Filter:** Blocks spam URLs, self-harm, hate speech, and deduplicates against recent chat.
6. **Provider Router & Failover:** Auto-recovery and normalized schema fallback.
7. **Scheduler Timing:** Intensity-scaled jitter and delayed message bursts.

---

## 7. Assumptions & Technical Defaults

- **STT Runtime:** Kept in-browser on the Control Panel page using the Web Speech API (Chrome / Edge recommended for native continuous speech recognition). Final chunks are dispatched to the server via the `submitTranscript` GraphQL mutation.
- **Local Fallback Mode:** When no LLM API keys are provided in `.env` or all providers are in cooldown, the pipeline automatically uses built-in heuristic decision templates, ensuring the chat and overlay never crash or freeze during local testing.
- **Redis Resilience:** If Redis is temporarily stopped, `PersonaStore` seamlessly falls back to an in-memory store so you can test immediately without dependencies.
- **Port:** Configured to port `3002` by default to avoid conflicts if another application (such as Jarvis) is already using port `3000`.
