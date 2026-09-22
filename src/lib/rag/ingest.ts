import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeChunks, EMBEDDING_DIMENSIONS } from "@/db/schema";
import { getEmbeddingProvider } from "@/lib/ai/provider-factory";
import { normalizeForIndex } from "@/lib/text/normalize";
import { invalidateVectorIndex } from "@/lib/rag/vector-index";
import type { TextChunk } from "@/lib/documents/chunk";

const EMBEDDING_BATCH_SIZE = 8;

/** Warn once per process (the portable console is user-visible). */
let ingestWarnedNoEmbedding = false;

export interface IngestChunkSource {
  organizationId: string;
  sourceType: "document" | "experience";
  sourceId: string;
  sourceVersion: number;
  sourceTitle: string;
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

  const embeddingProvider = getEmbeddingProvider();
  let inserted = 0;

  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);

    let embeddings: { vector: number[]; dimensions: number }[];
    try {
      embeddings = await embeddingProvider.embed(
        batch.map((c) => c.content),
        "passage",
      );
    } catch (error) {
      // No local embedding model installed — index the chunks with zero
      // vectors so they remain retrievable via keyword (tsvector) search.
      if (!ingestWarnedNoEmbedding) {
        ingestWarnedNoEmbedding = true;
        console.warn(
          `[RAG] Local embedding model unavailable — indexing without vectors (keyword search still works): ${(error as Error)?.message ?? error}`,
        );
      }
      embeddings = batch.map(() => ({
        vector: new Array(EMBEDDING_DIMENSIONS).fill(0),
        dimensions: EMBEDDING_DIMENSIONS,
      }));
    }

    await db.insert(knowledgeChunks).values(
      batch.map((chunk, idx) => ({
        organizationId: source.organizationId,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceVersion: source.sourceVersion,
        sourceTitle: source.sourceTitle,
        section: chunk.section,
        page: chunk.page,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        // Normalized copy used by the generated content_tsv column — the
        // raw content alone is NOT tokenizable for Persian (ZWNJ stays
        // inside words). See src/lib/text/normalize.ts.
        contentNorm: normalizeForIndex(chunk.content),
        tokenCount: chunk.tokenCount,
        embedding: embeddings[idx].vector,
      })),
    );

    inserted += batch.length;
    await onProgress?.(inserted, chunks.length);
  }

  // Chunk set changed — the cached portable vector index is stale.
  invalidateVectorIndex(source.organizationId);
  return inserted;
}

export async function deleteChunksForSource(sourceType: "document" | "experience", sourceId: string): Promise<void> {
  const rows = await db
    .select({ organizationId: knowledgeChunks.organizationId })
    .from(knowledgeChunks)
    .where(and(eq(knowledgeChunks.sourceType, sourceType), eq(knowledgeChunks.sourceId, sourceId)))
    .limit(1);

  await db
    .delete(knowledgeChunks)
    .where(and(eq(knowledgeChunks.sourceType, sourceType), eq(knowledgeChunks.sourceId, sourceId)));

  if (rows[0]) invalidateVectorIndex(rows[0].organizationId);
}
