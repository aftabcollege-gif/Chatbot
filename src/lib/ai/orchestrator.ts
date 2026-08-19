/**
 * AI Orchestrator — high-level access to the local-first AI stack.
 *
 * OFFLINE-FIRST ARCHITECTURE:
 * 1. LLM + embedding generation always go through AIProviderFactory, which
 *    in offline/local mode routes to the in-process llama.cpp runtime
 *    (node-llama-cpp) with local GGUF models — never to any cloud.
 * 2. The network kill-switch (network-guard.ts) is installed by
 *    provider-factory as soon as this module loads, so even a future bug
 *    cannot leak an outbound AI request in offline mode.
 * 3. If the local model is unavailable, LLM callers receive a
 *    LOCAL_LLM_UNAVAILABLE error and degrade to extractive answers; embedding
 *    callers fall back to the deterministic lexical hashing vectorizer so the
 *    app keeps working fully offline with keyword-only retrieval.
 */

import { getLlmProvider, getEmbeddingProvider } from "@/lib/ai/provider-factory";
import { localEmbedding } from "@/lib/local-embeddings";
import type { ChatMessageInput, GenerateOptions } from "@/lib/ai/types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  onToken?: (partial: string) => void;
}

export interface LLMResponse {
  content: string;
  tokenCount: number;
  latencyMs: number;
  modelName: string;
}

export interface AIProviderStatus {
  llm: {
    available: boolean;
    name: string;
    isLocal: boolean;
  };
  embedding: {
    available: boolean;
    name: string;
    isLocal: boolean;
    dimensions: number;
  };
}

/**
 * Generate a chat completion using the local LLM.
 * If the local model is unavailable, throws (rag.ts catches this and falls
 * back to a grounded extractive answer). NEVER falls back to cloud.
 */
export async function llmChat(
  messages: ChatMessage[],
  options?: ChatOptions,
): Promise<LLMResponse> {
  const provider = getLlmProvider();
  const genOptions: GenerateOptions = {
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    onToken: options?.onToken,
  };
  const result = await provider.generate(messages as ChatMessageInput[], genOptions);
  return {
    content: result.text,
    tokenCount: result.completionTokens,
    latencyMs: result.latencyMs,
    modelName: `local/${provider.kind}`,
  };
}

/**
 * Get an embedding vector for text.
 * Priority: local embedding model (llama.cpp/bge-m3) → lexical hashing
 * fallback. The fallback is keyword-based only, but guarantees the system
 * keeps working without any model files installed.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  try {
    const provider = getEmbeddingProvider();
    const [result] = await provider.embed([text], "query");
    return result.vector;
  } catch (error) {
    console.error("[AI/Embedding] Local embedding unavailable, using lexical fallback:", error);
    return localEmbedding(text);
  }
}

/** Get batch embeddings for multiple texts (passage mode for indexing). */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  try {
    const provider = getEmbeddingProvider();
    const results = await provider.embed(texts, "passage");
    return results.map((r) => r.vector);
  } catch (error) {
    console.error("[AI/Embedding] Local batch embedding unavailable, using lexical fallback:", error);
    return texts.map((t) => localEmbedding(t));
  }
}

/** Check if a real (semantic) embedding provider is active. */
export async function isRealEmbeddingMode(): Promise<boolean> {
  try {
    const provider = getEmbeddingProvider();
    const health = await provider.health();
    return health.available;
  } catch {
    return false;
  }
}

/** Get full AI provider status for the admin health/settings screen. */
export async function getAIStatus(): Promise<AIProviderStatus> {
  const [llmHealth, embeddingHealth] = await Promise.all([
    getLlmProvider().health(),
    getEmbeddingProvider().health(),
  ]);

  return {
    llm: {
      available: llmHealth.available,
      name: llmHealth.modelName ?? "llama.cpp (local GGUF)",
      isLocal: true,
    },
    embedding: {
      available: embeddingHealth.available,
      name: embeddingHealth.modelName ?? "Lexical hashing fallback",
      isLocal: true,
      dimensions: embeddingHealth.available
        ? (embeddingHealth.modelName ? 1024 : 768)
        : 768,
    },
  };
}

/** Invalidate availability caches (kept for API compatibility). */
export function invalidateAICache(): void {
  // No-op: the local runtime caches model/context per process and self-heals.
}
