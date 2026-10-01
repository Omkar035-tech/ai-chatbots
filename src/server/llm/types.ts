export type LLMTask = "director" | "writer" | "persona_gen" | "summary";

export interface ProviderHealth {
  name: string;
  healthy: boolean;
  cooldownUntil: number | null; // timestamp ms
  failCount: number;
  lastError: string | null;
  callsThisMinute: number;
  lastMinuteReset: number;
  totalCalls: number;
}

export interface ProviderStat {
  name: string;
  healthy: boolean;
  cooldownUntil: number | null;
  callsPerMin: number;
  active: boolean;
}

export interface LLMRequestOptions {
  task: LLMTask;
  systemPrompt: string;
  userPrompt: string;
  schema?: any;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMProvider {
  readonly name: string;
  completeJson(options: LLMRequestOptions): Promise<any>;
}
