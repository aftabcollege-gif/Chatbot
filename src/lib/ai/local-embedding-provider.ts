import { config } from "@/lib/config";
import { embeddingMutex, getEmbeddingContext } from "@/lib/ai/llama-runtime";
import { LocalLlmUnavailableError } from "@/lib/ai/types";
import type { AiHealth, EmbeddingProvider, EmbeddingResult } from "@/lib/ai/types";

// bge-m3 uses instruction-free symmetric embeddings; e5-style prefixes are
// not required, but we keep light task hints for retrieval quality.
function prefixFor(mode: "query" | "passage", text: string): string {
  return mode === "query" ? `query: ${text}` : `passage: ${text}`;
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly kind = "local" as const;

  async embed(texts: string[], mode: "query" | "passage"): Promise<EmbeddingResult[]> {
    return embeddingMutex.run(async () => {
      const context = await getEmbeddingContext();
      const results: EmbeddingResult[] = [];
      for (const text of texts) {
        const embedding = await context.getEmbeddingFor(prefixFor(mode, text));
        const vector = Array.from(embedding.vector);
        results.push({ vector, dimensions: vector.length });
      }
      return results;
    });
  }

  async health(): Promise<AiHealth> {
    try {
      await getEmbeddingContext();
      return {
        available: true,
        status: "ok",
        modelName: "BAAI/bge-m3 (GGUF, Q8_0)",
        modelPath: config.localEmbedding.modelPath,
      };
    } catch (err) {
      const detail =
        err instanceof LocalLlmUnavailableError ? err.message : err instanceof Error ? err.message : String(err);
      return { available: false, status: "unavailable", detail, modelPath: config.localEmbedding.modelPath };
    }
  }
}

let singleton: LocalEmbeddingProvider | null = null;
export function getLocalEmbeddingProvider(): LocalEmbeddingProvider {
  if (!singleton) singleton = new LocalEmbeddingProvider();
  return singleton;
}
