/**
 * Robust JSON extractor for LLM completions.
 * Handles markdown code fences, thought traces, preambles, and malformed wrapper text.
 */
export function extractJsonFromText(rawText: string): any {
  if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
    throw new Error("Empty response content from LLM provider");
  }

  let text = rawText.trim();

  // 1. Strip reasoning / thinking traces (e.g. <think>...</think> or "Here's a thinking process: ...")
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // 2. Extract content from markdown code fences if present
  if (text.includes("```")) {
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
      text = codeBlockMatch[1].trim();
    }
  }

  // 3. Try direct JSON parse
  try {
    return JSON.parse(text);
  } catch (initialErr) {
    // 4. Fallback: Search for outer JSON object or array delimiters
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    const firstBracket = text.indexOf("[");
    const lastBracket = text.lastIndexOf("]");

    let start = -1;
    let end = -1;

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      start = firstBrace;
      end = lastBrace;
    } else if (firstBracket !== -1) {
      start = firstBracket;
      end = lastBracket;
    }

    if (start !== -1 && end !== -1 && end > start) {
      const candidate = text.substring(start, end + 1);
      try {
        return JSON.parse(candidate);
      } catch (candidateErr) {
        // Fall through to error
      }
    }

    throw new Error(`Invalid JSON returned: ${text.slice(0, 160)}`);
  }
}
