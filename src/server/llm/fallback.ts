import { LLMTask } from "./types";

const FALLBACK_WRITER_RESPONSES = [
  "bro 💀",
  "LMAO",
  "W",
  "L",
  "cooked",
  "no shot",
  "???",
  "pog",
  "what did he sayyy",
  "chillll",
  "classic",
  "HELP 😭",
  "ggs",
  "chat is this real",
];

export function getLocalFallbackResponse(
  task: LLMTask,
  userPrompt: string,
  extraContext?: any
): any {
  if (task === "director") {
    const lower = userPrompt.toLowerCase();
    const isHype =
      lower.includes("no way") ||
      lower.includes("hate this") ||
      lower.includes("let's go") ||
      lower.includes("died") ||
      lower.includes("scream") ||
      lower.includes("! ");

    if (isHype) {
      return {
        react: "yes",
        event_type: "rage",
        intensity: 8,
        reason: "Heuristic fallback: high excitement/emotion detected in speech",
        suggested_reaction_types: ["troll", "hype"],
      };
    }

    return {
      react: "no",
      event_type: "boring",
      intensity: 1,
      reason: "Heuristic fallback: neutral/casual speech",
      suggested_reaction_types: ["backseat"],
    };
  }

  if (task === "writer") {
    const selectedPersonas = extraContext?.selectedPersonas || [
      { id: "fallback-1", name: "chat_user_1", reaction_bias: "troll" },
      { id: "fallback-2", name: "hype_beast", reaction_bias: "hype" },
      { id: "fallback-3", name: "lurker_99", reaction_bias: "skeptic" },
    ];

    const messages = selectedPersonas.map((p: any, idx: number) => {
      const fallbackText =
        FALLBACK_WRITER_RESPONSES[
          (idx + Math.floor(Math.random() * FALLBACK_WRITER_RESPONSES.length)) %
            FALLBACK_WRITER_RESPONSES.length
        ];
      return {
        persona_id: p.id,
        text: fallbackText,
        kind: p.reaction_bias === "hype" ? "hype" : "troll",
      };
    });

    return { messages };
  }

  if (task === "summary") {
    return {
      summary: "Streamer is actively playing and reacting to gameplay events.",
    };
  }

  return {};
}
