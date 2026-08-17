import { isAIConfigured, createEmbedding, createEmbeddings } from "@/lib/ai";
import { localEmbedding } from "@/lib/local-embeddings";

/**
 * Returns an embedding vector for the given text.
 * If an external OpenAI-compatible provider is configured via env vars
 * (AI_BASE_URL / AI_API_KEY / AI_EMBED_MODEL) it is used; otherwise a fully
 * offline, deterministic local embedding is used so the app works without
 * any installation or external connection.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  if (isAIConfigured()) {
    try {
      return await createEmbedding(text);
    } catch (error) {
      console.error("External embedding failed, falling back to local embedding:", error);
    }
  }
  return localEmbedding(text);
}

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  if (isAIConfigured()) {
    try {
      return await createEmbeddings(texts);
    } catch (error) {
      console.error("External batch embedding failed, falling back to local embedding:", error);
    }
  }
  return texts.map((text) => localEmbedding(text));
}

export function isLocalEmbeddingMode(): boolean {
  return !isAIConfigured();
}
