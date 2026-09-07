import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeChunks } from "@/db/schema";
import type { RagSourceType } from "@/db/schema";
import { getEmbeddingProvider } from "@/lib/ai/provider-factory";
import { isEmbeddingModelFilePresent } from "@/lib/ai/llama-runtime";
import { config } from "@/lib/config";
import type { TextChunk } from "@/lib/documents/chunk";

// Chunks are embedded in batches; larger batches amortise the per-call
// overhead of the native runtime. Rows are inserted in the same batches, so
// the number of round-trips to the database is chunks / EMBEDDING_BATCH_SIZE
// instead of one per chunk.
const EMBEDDING_BATCH_SIZE = 32;
const INSERT_BATCH_SIZE = 200;

export interface IngestChunkSource {
  organizationId: string;
  sourceType: RagSourceType;
  sourceId: string;
  sourceVersion: number;
  sourceTitle: string;
}

/**
 * Whether we should attempt to embed at all. Checking once per source (rather
 * than failing 1000× per document) matters when the model is not installed:
 * every failed attempt used to cost a model-load attempt and a stack trace.
 */
export function embeddingsEnabled(): boolean {
  if (config.aiMode === "cloud") return config.cloudAiEnabled;
  return config.localEmbedding.enabled && isEmbeddingModelFilePresent();
}

/** Replaces all existing chunks for a source with freshly embedded ones. */
export async function reindexChunks(
  source: IngestChunkSource,
  chunks: TextChunk[],
  onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<number> {
  await db
    .delete(knowledgeChunks)
    .where(
      and(eq(knowledgeChunks.sourceType, source.sourceType), eq(knowledgeChunks.sourceId, source.sourceId)),
    );

  if (chunks.length === 0) return 0;

  let useEmbeddings = embeddingsEnabled();
  const embeddingProvider = useEmbeddings ? getEmbeddingProvider() : null;
  let inserted = 0;
  let lastProgressReport = 0;

  for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
    const insertBatch = chunks.slice(i, i + INSERT_BATCH_SIZE);
    const vectors: (number[] | null)[] = new Array(insertBatch.length).fill(null);

    if (useEmbeddings && embeddingProvider) {
      for (let j = 0; j < insertBatch.length; j += EMBEDDING_BATCH_SIZE) {
        const embedBatch = insertBatch.slice(j, j + EMBEDDING_BATCH_SIZE);
        try {
          const embeddings = await embeddingProvider.embed(
            embedBatch.map((c) => c.content),
            "passage",
          );
          embeddings.forEach((e, k) => {
            vectors[j + k] = e.vector.length > 0 ? e.vector : null;
          });
        } catch (error) {
          // No usable embedding model — store NULL vectors (not zeros) so the
          // rows stay retrievable via keyword search, take no space in the
          // HNSW index and can be back-filled later by the reindex command.
          console.error("[RAG] Embedding failed — indexing remaining chunks without vectors:", error);
          useEmbeddings = false;
          break;
        }
      }
    }

    await db.insert(knowledgeChunks).values(
      insertBatch.map((chunk, idx) => ({
        organizationId: source.organizationId,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceVersion: source.sourceVersion,
        sourceTitle: source.sourceTitle,
        section: chunk.section,
        page: chunk.page,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        embedding: vectors[idx],
      })),
    );

    inserted += insertBatch.length;
    // Progress rows are cheap but not free; report at most every ~5%.
    if (onProgress && (inserted - lastProgressReport >= Math.max(1, Math.floor(chunks.length / 20)) || inserted === chunks.length)) {
      lastProgressReport = inserted;
      await onProgress(inserted, chunks.length);
    }
  }

  return inserted;
}

export async function deleteChunksForSource(sourceType: RagSourceType, sourceId: string): Promise<void> {
  await db
    .delete(knowledgeChunks)
    .where(and(eq(knowledgeChunks.sourceType, sourceType), eq(knowledgeChunks.sourceId, sourceId)));
}
