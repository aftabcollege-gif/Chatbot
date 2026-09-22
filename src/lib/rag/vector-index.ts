/**
 * Portable vector index — in-memory cosine search over the embeddings stored
 * in `knowledge_chunks.embedding` (jsonb on the PGlite portable build).
 *
 * PGlite does not bundle the pgvector extension, so the earlier build simply
 * skipped semantic search even though every chunk had been embedded — the
 * vectors were computed and stored but never used, and retrieval degraded to
 * keyword-only. This module restores semantic search on the portable build by
 * scoring candidates with a plain cosine product in JS.
 *
 * The index is cached per organization (TTL + explicit invalidation) because
 * re-reading all embeddings on every query is wasteful on a desktop machine.
 * A hard row cap bounds memory use: above the cap the semantic leg is skipped
 * and logged, and the hybrid search degrades to keyword search instead of
 * loading gigabytes into RAM.
 */
import { client } from "@/db";

interface IndexEntry {
  id: string;
  vector: Float32Array;
}

interface OrgVectorIndex {
  entries: IndexEntry[];
  skippedOversized: boolean;
  loadedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_VECTOR_ROWS = Math.max(
  1000,
  parseInt(process.env.RAG_MAX_VECTOR_ROWS ?? "30000", 10),
);

const cache = new Map<string, OrgVectorIndex>();

/** Drop a cached vector index (call after ingest/delete/reindex). */
export function invalidateVectorIndex(organizationId?: string): void {
  if (organizationId) cache.delete(organizationId);
  else cache.clear();
}

function isZeroVector(arr: number[]): boolean {
  for (let i = 0; i < arr.length; i++) if (arr[i] !== 0) return false;
  return true;
}

async function loadOrgIndex(organizationId: string): Promise<OrgVectorIndex> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) return hit;

  const result = await client.query<{ id: string; embedding: unknown }>(
    `SELECT id, embedding FROM "knowledge_chunks"
     WHERE organization_id = $1 AND embedding IS NOT NULL
     LIMIT $2`,
    [organizationId, MAX_VECTOR_ROWS + 1],
  );

  let entries: IndexEntry[] = [];
  let skippedOversized = false;
  if (result.rows.length > MAX_VECTOR_ROWS) {
    // Corpus too large for an in-memory scan — degrade to keyword search.
    skippedOversized = true;
    console.warn(
      `[rag] vector index for org ${organizationId} has more than ${MAX_VECTOR_ROWS} embedded chunks; semantic search skipped for this org (raise RAG_MAX_VECTOR_ROWS to change)`,
    );
  } else {
    entries = [];
    for (const row of result.rows) {
      const raw = row.embedding;
      if (!Array.isArray(raw)) continue;
      const vec = raw as number[];
      if (vec.length === 0 || !Number.isFinite(vec[0])) continue;
      if (isZeroVector(vec)) continue; // zero-vector placeholder from model-less ingest
      entries.push({ id: row.id, vector: new Float32Array(vec) });
    }
  }

  const index: OrgVectorIndex = {
    entries,
    skippedOversized,
    loadedAt: Date.now(),
  };
  // Only cache successful loads; oversized loads are re-evaluated later
  // (the corpus might shrink, and we do not want a stale skip to persist).
  if (!skippedOversized) cache.set(organizationId, index);
  return index;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function l2(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  return Math.sqrt(sum);
}

/**
 * Cosine-search the organization's embedded chunks.
 * @returns up to `limit` ids with a similarity score clamped to [0, 1]
 *          (empty when the org has no usable vectors).
 */
export async function cosineSearch(
  organizationId: string,
  queryVector: number[],
  limit: number,
): Promise<{ id: string; score: number }[]> {
  if (!queryVector.length) return [];
  const index = await loadOrgIndex(organizationId);
  if (index.skippedOversized || index.entries.length === 0) return [];

  const dim = queryVector.length;
  const q = Float32Array.from(queryVector.slice(0, dim));
  const qNorm = l2(q);
  if (qNorm === 0) return [];
  for (let i = 0; i < q.length; i++) q[i] /= qNorm;

  const scored: { id: string; score: number }[] = [];
  for (const entry of index.entries) {
    const v = entry.vector;
    if (v.length !== dim) continue;
    const n = l2(v);
    if (n === 0) continue;
    let dot = 0;
    for (let i = 0; i < dim; i++) dot += q[i] * (v[i] / n);
    if (dot > 0) scored.push({ id: entry.id, score: Math.min(1, dot) });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
