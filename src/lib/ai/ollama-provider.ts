/**
 * Ollama Local LLM Provider
 *
 * Connects to a locally running Ollama instance.
 * DEFAULT model: qwen2.5:7b (Apache-2.0 license, strong multilingual, Persian support)
 *
 * OFFLINE-FIRST: This provider calls ONLY localhost — never any external cloud.
 * If Ollama is not running, isAvailable() returns false and the orchestrator
 * falls back to extractive/local answer — NEVER to cloud.
 */

import type {
  LLMProvider,
  EmbeddingProvider,
  ChatMessage,
  ChatOptions,
  LLMResponse,
} from "./types";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const LLM_MODEL = process.env.OLLAMA_LLM_MODEL ?? "qwen2.5:7b";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
const EMBED_DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS ?? "768");

export class OllamaLLMProvider implements LLMProvider {
  readonly name = `Ollama/${LLM_MODEL}`;
  readonly isLocal = true;

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      // Check if target model is available
      const models = data.models ?? [];
      return models.some(
        (m) =>
          m.name === LLM_MODEL ||
          m.name.startsWith(LLM_MODEL.split(":")[0])
      );
    } catch {
      return false;
    }
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const startMs = Date.now();

    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.1,
          top_p: options?.topP ?? 0.9,
          num_predict: options?.maxTokens ?? 2048,
        },
      }),
      signal: AbortSignal.timeout(120_000), // 2 minute timeout
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(
        `Ollama LLM error (${response.status}): ${errorText.slice(0, 300)}`
      );
    }

    const data = (await response.json()) as {
      message?: { content?: string };
      eval_count?: number;
    };

    const content = data.message?.content?.trim() ?? "";
    if (!content) throw new Error("Ollama returned empty response");

    return {
      content,
      tokenCount: data.eval_count,
      latencyMs: Date.now() - startMs,
      modelName: LLM_MODEL,
    };
  }
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = `Ollama/${EMBED_MODEL}`;
  readonly isLocal = true;
  readonly dimensions = EMBED_DIMENSIONS;

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = data.models ?? [];
      return models.some(
        (m) =>
          m.name === EMBED_MODEL ||
          m.name.startsWith(EMBED_MODEL.split(":")[0])
      );
    } catch {
      return false;
    }
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(
        `Ollama embedding error (${response.status}): ${errorText.slice(0, 300)}`
      );
    }

    const data = (await response.json()) as { embedding?: number[] };
    const embedding = data.embedding;
    if (!embedding?.length) throw new Error("Ollama returned empty embedding");

    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    // Ollama doesn't support batch embeddings natively — serialize calls
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}
