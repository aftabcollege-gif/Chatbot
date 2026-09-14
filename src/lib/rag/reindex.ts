/**
 * Full-corpus reindex job.
 *
 * Re-reads the chunk *content* already stored in `knowledge_chunks` (no file
 * access needed), recomputes the Persian-normalized index copy
 * (`content_norm`) and re-embeds every chunk with the local embedding model
 * when it is available. This repairs:
 *
 *  1. chunks indexed before the ZWNJ/normalization fix,
 *  2. chunks stored with zero vectors (uploaded before the embedding model
 *     was installed) — after model installation they become searchable
 *     semantically instead of keyword-only.
 *
 * If the embedding model is unavailable, vectors are left untouched and only
 * the FTS normalization is repaired.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeChunks } from "@/db/schema";
import { getEmbeddingProvider } from "@/lib/ai/provider-factory";
import { normalizeForIndex } from "@/lib/text/normalize";
import { invalidateVectorIndex } from "@/lib/rag/vector-index";
import { updateJobStatus } from "@/lib/jobs/queue";

const BATCH = 8;

interface ChunkRow {
  id: string;
  sourceType: string;
  sourceId: string;
  content: string;
}

export interface ReindexResult {
  sources: number;
  chunks: number;
  reembedded: number;
  embeddingModelUsed: boolean;
}

type Scope = "documents" | "experiences" | "all";

export async function processReindexJob(
  jobId: string,
  organizationId: string,
  scope: Scope,
): Promise<ReindexResult> {
  await updateJobStatus(jobId, "PROCESSING", { progress: 5 });

  // Is the local embedding model actually usable right now?
  let canEmbed = false;
  try {
    const health = await getEmbeddingProvider().health();
    canEmbed = health.available;
  } catch {
    canEmbed = false;
  }
  let embeddingProvider = canEmbed ? getEmbeddingProvider() : null;
  const result: ReindexResult = {
    sources: 0,
    chunks: 0,
    reembedded: 0,
    embeddingModelUsed: canEmbed,
  };

  const types: ("document" | "experience")[] =
    scope === "documents"
      ? ["document"]
      : scope === "experiences"
        ? ["experience"]
        : ["document", "experience"];

  for (const sourceType of types) {
    const status = sourceType === "document" ? "completed" : "published";
    const liveRes =
      sourceType === "document"
        ? await db.execute(
            sql`
              SELECT d.id FROM documents d
              WHERE d.organization_id = ${organizationId}
                AND d.is_deleted = false AND d.status = ${status}`,
          )
        : await db.execute(
            sql`
              SELECT e.id FROM experiences e
              WHERE e.organization_id = ${organizationId}
                AND e.is_deleted = false AND e.status = ${status}`,
          );
    // drizzle's execute() result shape differs by driver — accept both.
    const rawRows: unknown[] = Array.isArray(liveRes)
      ? (liveRes as unknown[])
      : ((liveRes as { rows?: unknown[] }).rows ?? []);
    const liveIds = new Set(rawRows.map((r) => (r as { id: string }).id));
    if (liveIds.size === 0) continue;

    const rows: ChunkRow[] = await db
      .select({
        id: knowledgeChunks.id,
        sourceType: knowledgeChunks.sourceType,
        sourceId: knowledgeChunks.sourceId,
        content: knowledgeChunks.content,
      })
      .from(knowledgeChunks)
      .where(
        and(
          eq(knowledgeChunks.organizationId, organizationId),
          eq(knowledgeChunks.sourceType, sourceType),
        ),
      );

    const live = rows.filter((r) => liveIds.has(r.sourceId));
    if (live.length === 0) continue;

    const bySource = new Map<string, ChunkRow[]>();
    for (const row of live) {
      const list = bySource.get(row.sourceId) ?? [];
      list.push(row);
      bySource.set(row.sourceId, list);
    }

    // Re-embed this source-type's chunks in batches (raw content — the model
    // tokenizes Persian correctly on its own).
    const vectorById = new Map<string, number[]>();
    if (embeddingProvider) {
      for (const sourceRows of bySource.values()) {
        for (let i = 0; i < sourceRows.length; i += BATCH) {
          const batchRows = sourceRows.slice(i, i + BATCH);
          try {
            const embedded = await embeddingProvider.embed(
              batchRows.map((r) => r.content),
              "passage",
            );
            for (let j = 0; j < batchRows.length; j++) {
              vectorById.set(batchRows[j].id, embedded[j].vector);
              result.reembedded++;
            }
          } catch (error) {
            // Model broke mid-job — continue with normalization-only.
            console.error("[reindex] embedding failed, continuing without re-embed:", error);
            embeddingProvider = null;
            break;
          }
        }
        if (!embeddingProvider) break;
      }
    }

    // Single write per row: normalized copy (+ fresh vector when available).
    let done = 0;
    for (const row of live) {
      await db
        .update(knowledgeChunks)
        .set({
          contentNorm: normalizeForIndex(row.content),
          ...(vectorById.has(row.id) ? { embedding: vectorById.get(row.id)! } : {}),
        })
        .where(eq(knowledgeChunks.id, row.id));
      done++;
      if (done % 50 === 0 || done === live.length) {
        await updateJobStatus(jobId, "PROCESSING", {
          progress: Math.min(95, 5 + Math.round((done / live.length) * 90)),
        });
      }
    }

    result.chunks += live.length;
    result.sources += bySource.size;
  }

  invalidateVectorIndex(organizationId);
  await updateJobStatus(jobId, "COMPLETED", {
    progress: 100,
    result: JSON.stringify(result),
  });
  console.log(`[reindex] org ${organizationId}:`, result);
  return result;
}
