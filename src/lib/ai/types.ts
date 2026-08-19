export interface ChatMessageInput {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  onToken?: (partial: string) => void;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

export interface EmbeddingResult {
  vector: number[];
  dimensions: number;
}

export interface AiHealth {
  available: boolean;
  status: "ok" | "unavailable" | "error";
  detail?: string;
  modelName?: string;
  modelPath?: string;
}

/**
 * AIProvider abstraction. Every code path that needs an LLM completion or an
 * embedding MUST go through an implementation of this interface obtained via
 * AIProviderFactory. Direct imports of any cloud SDK anywhere else in the
 * codebase are forbidden.
 */
export interface LlmProvider {
  readonly kind: "local" | "cloud";
  generate(messages: ChatMessageInput[], options?: GenerateOptions): Promise<GenerateResult>;
  health(): Promise<AiHealth>;
}

export interface EmbeddingProvider {
  readonly kind: "local" | "cloud";
  embed(texts: string[], mode: "query" | "passage"): Promise<EmbeddingResult[]>;
  health(): Promise<AiHealth>;
}

export class LocalLlmUnavailableError extends Error {
  code = "LOCAL_LLM_UNAVAILABLE" as const;
  messageFa =
    "مدل زبانی محلی در دسترس نیست. برای حفظ حالت آفلاین، هیچ درخواست خارجی ارسال نشد.";
  constructor(reason: string) {
    super(`LOCAL_LLM_UNAVAILABLE: ${reason}`);
    this.name = "LocalLlmUnavailableError";
  }
}

export class CloudAiDisabledError extends Error {
  code = "CLOUD_AI_DISABLED" as const;
  constructor() {
    super(
      "Cloud AI provider was requested but the system is running in offline mode. " +
        "No cloud fallback is permitted. Set AI_MODE=cloud explicitly (not recommended for production) to use it.",
    );
    this.name = "CloudAiDisabledError";
  }
}
