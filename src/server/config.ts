import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  gemini: {
    apiKey: (process.env.GEMINI_API_KEY || "").trim(),
    model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  },
  groq: {
    apiKey: (process.env.GROQ_API_KEY || "").trim(),
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  },
  openrouter: {
    apiKey: (process.env.OPENROUTER_API_KEY || "").trim(),
    model: process.env.OPENROUTER_MODEL || "liquid/lfm-2.5-2.6b:free",
    baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
  },
  priority: {
    director: (process.env.LLM_PRIORITY_DIRECTOR || "groq,gemini,openrouter")
      .split(",")
      .map((s) => s.trim().toLowerCase()),
    writer: (process.env.LLM_PRIORITY_WRITER || "gemini,groq,openrouter")
      .split(",")
      .map((s) => s.trim().toLowerCase()),
  },
  graphql: {
    url: process.env.NEXT_PUBLIC_GRAPHQL_URL || "http://localhost:3000/api/graphql",
    wsUrl: process.env.NEXT_PUBLIC_GRAPHQL_WS_URL || "ws://localhost:3000/graphql",
  },
};
