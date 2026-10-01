import { config } from "../../config";
import { LLMProvider, LLMRequestOptions } from "../types";
import { extractJsonFromText } from "../jsonExtractor";

export class GeminiProvider implements LLMProvider {
  public readonly name = "gemini";

  async completeJson(options: LLMRequestOptions): Promise<any> {
    const apiKey = config.gemini.apiKey;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const primaryModel = config.gemini.model || "gemini-3.5-flash-lite";
    const modelsToTry = [
      primaryModel,
      "gemini-flash-lite-latest",
      "gemini-3.1-flash-lite",
      "gemini-3.8-flash",
    ].filter((m, i, arr) => arr.indexOf(m) === i);

    let lastError: any = null;

    for (const model of modelsToTry) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);

      try {
        const payload: any = {
          contents: [
            {
              role: "user",
              parts: [{ text: `${options.systemPrompt}\n\nUser Input:\n${options.userPrompt}` }],
            },
          ],
          generationConfig: {
            temperature: options.temperature ?? 0.7,
            maxOutputTokens: options.maxTokens ?? 600,
            responseMimeType: "application/json",
          },
        };

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          const err: any = new Error(
            `Gemini API error [${response.status}]: ${errorText.slice(0, 300)}`
          );
          err.statusCode = response.status;
          const retryAfter = response.headers.get("retry-after");
          if (retryAfter) err.retryAfterSec = parseInt(retryAfter, 10);
          lastError = err;

          // If high demand (503), quota (429), or model missing (404), try next model
          if (response.status === 503 || response.status === 429 || response.status === 404) {
            console.warn(`[Gemini] Model ${model} returned ${response.status}, trying fallback model...`);
            continue;
          }
          throw err;
        }

        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
          console.warn(`[Gemini] Model ${model} returned empty candidate, trying fallback model...`);
          continue;
        }

        return extractJsonFromText(rawText);
      } catch (err: any) {
        lastError = err;
        if (err.name === "AbortError") {
          const timeoutErr: any = new Error(`Gemini request timed out after ${options.timeoutMs ?? 8000}ms`);
          timeoutErr.isTimeout = true;
          throw timeoutErr;
        }
        if (err.statusCode && (err.statusCode === 503 || err.statusCode === 429 || err.statusCode === 404)) {
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError || new Error("All Gemini models failed");
  }
}
