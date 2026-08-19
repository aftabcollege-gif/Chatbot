import { CloudAiDisabledError } from "@/lib/ai/types";
import type { AiHealth, ChatMessageInput, EmbeddingProvider, EmbeddingResult, GenerateOptions, GenerateResult, LlmProvider } from "@/lib/ai/types";

/**
 * CloudLlmProvider is a fully isolated, OPT-IN-ONLY stub. It is never
 * imported by the RAG/chat pipeline unless AI_MODE=cloud is explicitly set
 * by an administrator, and even then it requires CLOUD_AI_ENABLED=true and a
 * configured endpoint/key. It performs no action by default and cannot be
 * reached from offline/local mode under any circumstance because
 * AIProviderFactory refuses to construct it outside of AI_MODE=cloud.
 */
export class CloudLlmProvider implements LlmProvider {
  readonly kind = "cloud" as const;

  async generate(_messages: ChatMessageInput[], _options?: GenerateOptions): Promise<GenerateResult> {
    throw new CloudAiDisabledError();
  }

  async health(): Promise<AiHealth> {
    return { available: false, status: "unavailable", detail: "Cloud AI is disabled by policy." };
  }
}

export class CloudEmbeddingProvider implements EmbeddingProvider {
  readonly kind = "cloud" as const;

  async embed(_texts: string[], _mode: "query" | "passage"): Promise<EmbeddingResult[]> {
    throw new CloudAiDisabledError();
  }

  async health(): Promise<AiHealth> {
    return { available: false, status: "unavailable", detail: "Cloud AI is disabled by policy." };
  }
}
