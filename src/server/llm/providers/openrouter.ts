import { config } from "../../config";
import { LLMProvider, LLMRequestOptions } from "../types";
import { extractJsonFromText } from "../jsonExtractor";

export class OpenRouterProvider implements LLMProvider {
  public readonly name = "openrouter";

  private resolveModel(model: string): string {
    if (model === "liquid/lfm-2.5-2.6b") {
      return "liquid/lfm-2.5-2.6b:free";
    }
    return model;
  }

  async completeJson(options: LLMRequestOptions): Promise<any> {
    const apiKey = config.openrouter.apiKey;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not configured");
    }

    const primaryModel = this.resolveModel(config.openrouter.model || "liquid/lfm-2.5-2.6b:free");
    const modelsToTry = [
      primaryModel,
      "openrouter/free",
      "nvidia/nemotron-3.5-lightning:free",
    ].filter((m, i, arr) => arr.indexOf(m) === i);

    const baseUrl = config.openrouter.baseUrl || "https://openrouter.ai/api/v1";
    let lastError: any = null;

    for (const model of modelsToTry) {
      const url = `${baseUrl}/chat/completions`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3002",
            "X-Title": "CrowdChat",
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content: `${options.systemPrompt}\nIMPORTANT: Respond ONLY with a valid raw JSON object. Do not include markdown fences, comments, or extra text.`,
              },
              { role: "user", content: options.userPrompt },
            ],
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 600,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          const err: any = new Error(
            `OpenRouter API error [${response.status}]: ${errorText.slice(0, 300)}`
          );
          err.statusCode = response.status;
          const retryAfter = response.headers.get("retry-after");
          if (retryAfter) err.retryAfterSec = parseInt(retryAfter, 10);
          lastError = err;

          // If rate limited or model not found, try next free model
          if (response.status === 429 || response.status === 404) {
            console.warn(`[OpenRouter] Model ${model} returned ${response.status}, trying fallback model...`);
            continue;
          }
          throw err;
        }

        const data = await response.json();
        const rawContent = data.choices?.[0]?.message?.content || "";
        if (!rawContent) {
          console.warn(`[OpenRouter] Model ${model} returned empty content, trying fallback model...`);
          continue;
        }

        return extractJsonFromText(rawContent);
      } catch (err: any) {
        lastError = err;
        if (err.name === "AbortError") {
          const timeoutErr: any = new Error(
            `OpenRouter request timed out after ${options.timeoutMs ?? 10000}ms`
          );
          timeoutErr.isTimeout = true;
          throw timeoutErr;
        }
        if (err.statusCode && (err.statusCode === 429 || err.statusCode === 404)) {
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError || new Error("All OpenRouter models failed");
  }

  async completeRaw(options: LLMRequestOptions): Promise<string> {
    const apiKey = config.openrouter.apiKey;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

    const primaryModel = config.openrouter.model || "liquid/lfm-2.5-2.6b:free";
    const modelsToTry = [
      primaryModel,
      "google/gemini-2.0-flash-exp:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "mistralai/mistral-7b-instruct:free",
    ].filter((m, i, arr) => arr.indexOf(m) === i);

    for (const model of modelsToTry) {
      const url = `${config.openrouter.baseUrl}/chat/completions`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3002",
            "X-Title": "CrowdChat",
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
          if (response.status === 404 || response.status === 429) continue;
          throw new Error(`OpenRouter API error [${response.status}]: ${errText.slice(0, 200)}`);
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
