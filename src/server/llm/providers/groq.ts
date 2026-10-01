import { config } from "../../config";
import { LLMProvider, LLMRequestOptions } from "../types";
import { extractJsonFromText } from "../jsonExtractor";

export class GroqProvider implements LLMProvider {
  public readonly name = "groq";

  async completeJson(options: LLMRequestOptions): Promise<any> {
    const apiKey = config.groq.apiKey;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not configured");
    }

    const primaryModel = config.groq.model || "openai/gpt-oss-120b";
    const modelsToTry = [primaryModel, "qwen/qwen3.8-27b", "openai/gpt-oss-20b"].filter(
      (m, i, arr) => arr.indexOf(m) === i
    );

    let lastError: any = null;

    for (const model of modelsToTry) {
      const url = "https://api.groq.com/openai/v1/chat/completions";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 7000);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content: `${options.systemPrompt}\nIMPORTANT: You must respond ONLY with a valid JSON object matching the requested schema. Do not write explanations outside JSON.`,
              },
              { role: "user", content: options.userPrompt },
            ],
            response_format: { type: "json_object" },
            temperature: options.temperature ?? 0.6,
            max_tokens: options.maxTokens ?? 600,
          }),
          signal: controller.signal,
        });

        const remainingReq = response.headers.get("x-ratelimit-remaining-requests");
        const remainingTokens = response.headers.get("x-ratelimit-remaining-tokens");
        const retryAfter = response.headers.get("retry-after");

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          const err: any = new Error(`Groq API error [${response.status}]: ${errorText.slice(0, 300)}`);
          err.statusCode = response.status;
          if (retryAfter) err.retryAfterSec = parseInt(retryAfter, 10);
          lastError = err;

          // If model doesn't exist (404), try next model in fallback list
          if (response.status === 404 || errorText.includes("does not exist") || errorText.includes("decommissioned")) {
            console.warn(`[Groq] Model ${model} unavailable, trying next model...`);
            continue;
          }
          throw err;
        }

        if (
          (remainingReq && parseInt(remainingReq, 10) <= 1) ||
          (remainingTokens && parseInt(remainingTokens, 10) <= 200)
        ) {
          console.warn(`[Groq] Rate limit remaining low: req=${remainingReq}, tokens=${remainingTokens}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error("Groq returned empty completion content");
        }

        return extractJsonFromText(content);
      } catch (err: any) {
        lastError = err;
        if (err.name === "AbortError") {
          const timeoutErr: any = new Error(`Groq request timed out after ${options.timeoutMs ?? 7000}ms`);
          timeoutErr.isTimeout = true;
          throw timeoutErr;
        }
        // If not a 404 model-not-found error, rethrow
        if (err.statusCode && err.statusCode !== 404) {
          throw err;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError || new Error("All Groq models failed");
  }

  async completeRaw(options: LLMRequestOptions): Promise<string> {
    const apiKey = config.groq.apiKey;
    if (!apiKey) throw new Error("GROQ_API_KEY is not configured");

    const primaryModel = config.groq.model || "openai/gpt-oss-120b";
    const modelsToTry = [primaryModel, "qwen/qwen3.8-27b", "openai/gpt-oss-20b"].filter(
      (m, i, arr) => arr.indexOf(m) === i
    );

    for (const model of modelsToTry) {
      const url = "https://api.groq.com/openai/v1/chat/completions";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: options.systemPrompt },
              { role: "user", content: options.userPrompt },
            ],
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 2000,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          if (response.status === 404) continue;
          throw new Error(`Groq API error [${response.status}]: ${errText.slice(0, 200)}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
      } finally {
        clearTimeout(timeout);
      }
    }
    return "";
  }
}
