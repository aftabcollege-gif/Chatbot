/**
 * AI Orchestrator — Manages LLM and Embedding providers
 *
 * OFFLINE-FIRST ARCHITECTURE:
 * 1. Try Ollama (local LLM/Embedding) — primary
 * 2. Fall back to local extractive methods — NEVER to any cloud provider
 *
 * DIRECTIVE §15 COMPLIANCE:
 * - No cloud provider is in the production registry
 * - If local model fails, system degrades gracefully with clear error messages
 * - NO SILENT FALLBACK TO CLOUD
 */

import { OllamaLLMProvider, OllamaEmbeddingProvider } from "./ollama-provider";
import { localEmbedding } from "@/lib/local-embeddings";
import type { ChatMessage, ChatOptions, LLMResponse, AIProviderStatus } from "./types";

const ollamaLLM = new OllamaLLMProvider();
const ollamaEmbedding = new OllamaEmbeddingProvider();

// Cache availability checks for 30 seconds to avoid hammering Ollama
let llmAvailableCache: { value: boolean; expiry: number } | null = null;
let embedAvailableCache: { value: boolean; expiry: number } | null = null;
const CACHE_TTL_MS = 30_000;

async function isLLMAvailable(): Promise<boolean> {
  const now = Date.now();
  if (llmAvailableCache && now < llmAvailableCache.expiry) {
    return llmAvailableCache.value;
  }
  const value = await ollamaLLM.isAvailable();
  llmAvailableCache = { value, expiry: now + CACHE_TTL_MS };
  return value;
}

async function isEmbeddingAvailable(): Promise<boolean> {
  const now = Date.now();
  if (embedAvailableCache && now < embedAvailableCache.expiry) {
    return embedAvailableCache.value;
  }
  const value = await ollamaEmbedding.isAvailable();
  embedAvailableCache = { value, expiry: now + CACHE_TTL_MS };
  return value;
}

/** Invalidate availability cache (call after model change) */
export function invalidateAICache(): void {
  llmAvailableCache = null;
  embedAvailableCache = null;
}

/**
 * Generate a chat completion using local LLM.
 * If Ollama is not available, throws an error with a user-friendly message.
 * NEVER falls back to cloud.
 */
export async function llmChat(
  messages: ChatMessage[],
  options?: ChatOptions
): Promise<LLMResponse> {
  const available = await isLLMAvailable();
  if (!available) {
    throw new Error(
      "مدل هوش مصنوعی محلی در دسترس نیست. لطفاً Ollama را راه‌اندازی کنید."
    );
  }
  return ollamaLLM.chat(messages, options);
}

/**
 * Get embedding for text.
 * Priority: Ollama embedding → local hashing-trick fallback
 * The local fallback is lexical only (NOT semantic), but ensures the system
 * continues to work without Ollama.
 *
 * NOTE: When using local fallback, RAG quality is keyword-based only.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const available = await isEmbeddingAvailable();
  if (available) {
    try {
      return await ollamaEmbedding.embed(text);
    } catch (error) {
      console.error("[AI/Embedding] Ollama embedding failed, using local fallback:", error);
    }
  }

  // Local hashing-trick fallback (lexical only, NOT semantic)
  return localEmbedding(text);
}

/**
 * Get batch embeddings for multiple texts.
 */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];

  const available = await isEmbeddingAvailable();
  if (available) {
    try {
      return await ollamaEmbedding.embedBatch(texts);
    } catch (error) {
      console.error("[AI/Embedding] Ollama batch embedding failed, using local fallback:", error);
    }
  }

  return texts.map((t) => localEmbedding(t));
}

/** Check if real (Ollama) embedding is active */
export async function isRealEmbeddingMode(): Promise<boolean> {
  return isEmbeddingAvailable();
}

/** Get full AI provider status for health dashboard */
export async function getAIStatus(): Promise<AIProviderStatus> {
  const [llmAvailable, embedAvailable] = await Promise.all([
    isLLMAvailable(),
    isEmbeddingAvailable(),
  ]);

  return {
    llm: {
      available: llmAvailable,
      name: ollamaLLM.name,
      isLocal: ollamaLLM.isLocal,
    },
    embedding: {
      available: embedAvailable,
      name: embedAvailable ? ollamaEmbedding.name : "Local Hashing Fallback",
      isLocal: true,
      dimensions: ollamaEmbedding.dimensions,
    },
  };
}
