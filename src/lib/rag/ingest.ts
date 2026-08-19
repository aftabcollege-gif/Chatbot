import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeChunks } from "@/db/schema";
import { getEmbeddingProvider } from "@/lib/ai/provider-factory";
import type { TextChunk } from "@/lib/documents/chunk";

const EMBEDDING_BATCH_SIZE = 8;

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
    const embeddings = await embeddingProvider.embed(
      batch.map((c) => c.content),
      "passage",
    );

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
        tokenCount: chunk.tokenCount,
        embedding: embeddings[idx].vector,
      })),
    );

    inserted += batch.length;
    await onProgress?.(inserted, chunks.length);
  }

  return inserted;
}

export async function deleteChunksForSource(sourceType: "document" | "experience", sourceId: string): Promise<void> {
  await db
    .delete(knowledgeChunks)
    .where(and(eq(knowledgeChunks.sourceType, sourceType), eq(knowledgeChunks.sourceId, sourceId)));
}
