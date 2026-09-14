import { sql } from "drizzle-orm";
import { inArray } from "drizzle-orm";
import { db, client, isPortableDatabase } from "@/db";
import { config } from "@/lib/config";
import { getEmbeddingProvider } from "@/lib/ai/provider-factory";
import { knowledgeChunks } from "@/db/schema";
import { queryTerms, searchTokens } from "@/lib/text/normalize";
import { cosineSearch } from "@/lib/rag/vector-index";

/** Warn once per process (the portable console is user-visible). */
let searchWarnedNoEmbedding = false;

export interface RetrievedChunk {
  id: string;
  sourceType: "document" | "experience";
  sourceId: string;
  sourceTitle: string;
  section: string | null;
  page: number | null;
  content: string;
  chunkIndex: number;
  vectorScore: number;
  keywordScore: number;
  /** Final combined relevance in [0,1] — used as the RAG confidence. */
  fusedScore: number;
  /** Fraction of the query's significant terms present in this chunk. */
  matchRatio: number;
}

export function normalizeQuery(raw: string): string {
  return raw
    .replace(/[\u200c\u200f\u200e]/g, " ") // strip ZWNJ / directional marks that break tokenization
    .replace(/\s+/g, " ")
    .trim();
}

interface VectorRow {
  [key: string]: unknown;
  id: string;
  source_type: "document" | "experience";
  source_id: string;
  source_title: string;
  section: string | null;
  page: number | null;
  content: string;
  chunk_index: number;
  score: number;
}

/**
 * Validity conditions shared by both search legs: a chunk is retrievable only
 * when its source is live (document completed / experience published).
 */
const SOURCE_VALIDITY_SQL = `
      (
        (kc.source_type = 'document' AND EXISTS (
          SELECT 1 FROM documents d WHERE d.id = kc.source_id AND d.is_deleted = false AND d.status = 'completed'
        ))
        OR
        (kc.source_type = 'experience' AND EXISTS (
          SELECT 1 FROM experiences e WHERE e.id = kc.source_id AND e.is_deleted = false AND e.status = 'published'
        ))
      )`;

async function vectorSearchPg(organizationId: string, embedding: number[], limit: number): Promise<VectorRow[]> {
  const vectorLiteral = `[${embedding.join(",")}]`;
  const result = await db.execute<VectorRow>(sql`
    SELECT kc.id,
           kc.source_type,
           kc.source_id,
           kc.source_title,
           kc.section,
           kc.page,
           kc.content,
           kc.chunk_index,
           1 - (kc.embedding <=> ${vectorLiteral}::vector) AS score
    FROM knowledge_chunks kc
    WHERE kc.organization_id = ${organizationId}
      AND kc.embedding IS NOT NULL
      AND ${sql.raw(SOURCE_VALIDITY_SQL)}
    ORDER BY kc.embedding <=> ${vectorLiteral}::vector
    LIMIT ${limit}
  `);
  return (result as unknown as { rows: VectorRow[] }).rows;
}

/**
 * Portable (PGlite) semantic search: cosine over the jsonb embeddings in JS,
 * then fetch the full rows for the surviving candidates.
 */
async function vectorSearchPortable(organizationId: string, embedding: number[], limit: number): Promise<VectorRow[]> {
  const hits = await cosineSearch(organizationId, embedding, limit);
  if (hits.length === 0) return [];

  const ids = hits.map((h) => h.id);
  const rows = await db
    .select({
      id: knowledgeChunks.id,
      sourceType: knowledgeChunks.sourceType,
      sourceId: knowledgeChunks.sourceId,
      sourceTitle: knowledgeChunks.sourceTitle,
      section: knowledgeChunks.section,
      page: knowledgeChunks.page,
      content: knowledgeChunks.content,
      chunkIndex: knowledgeChunks.chunkIndex,
    })
    .from(knowledgeChunks)
    .where(inArray(knowledgeChunks.id, ids));

  const [docRows, expRows] = await Promise.all([
    client.query<{ id: string }>(
      `SELECT id FROM documents WHERE organization_id = $1 AND is_deleted = false AND status = 'completed'`,
      [organizationId],
    ),
    client.query<{ id: string }>(
      `SELECT id FROM experiences WHERE organization_id = $1 AND is_deleted = false AND status = 'published'`,
      [organizationId],
    ),
  ]);
  const validDoc = new Set(docRows.rows.map((r) => r.id));
  const validExp = new Set(expRows.rows.map((r) => r.id));
  const scoreById = new Map(hits.map((h) => [h.id, h.score]));

  return rows
    .filter((r) =>
      r.sourceType === "document" ? validDoc.has(r.sourceId) : validExp.has(r.sourceId),
    )
    .map((r) => ({
      id: r.id,
      source_type: r.sourceType as "document" | "experience",
      source_id: r.sourceId,
      source_title: r.sourceTitle,
      section: r.section,
      page: r.page,
      content: r.content,
      chunk_index: r.chunkIndex,
      score: scoreById.get(r.id) ?? 0,
    }));
}

/**
 * Build a prefix OR-combined tsquery from the query terms.
 *
 * - Terms are normalized with the SAME rules as the index (`content_norm`),
 *   so a query «می‌تواند» (ZWNJ) matches the indexed «می» + «تواند».
 * - Each term is a PREFIX term (`مرخصی:*`) so inflected forms (مرخصی‌ها,
 *   استعلاجیه, ...) still match without a stemmer.
 * - Stop-words are dropped; if nothing remains, the raw tokens are used so a
 *   pure-stopword question still attempts a match.
 */
function buildOrQuery(rawQuery: string): string | null {
  const terms = queryTerms(normalizeQuery(rawQuery)).map((t) =>
    t.replace(/[^\p{L}\p{N}]/gu, ""),
  );
  if (terms.length === 0) return null;
  return terms.slice(0, 12).map((t) => `${t}:*`).join(" | ");
}

async function keywordSearch(organizationId: string, query: string, limit: number): Promise<VectorRow[]> {
  const orQuery = buildOrQuery(query);
  if (!orQuery) return [];
  const result = await db.execute<VectorRow>(sql`
    SELECT kc.id,
           kc.source_type,
           kc.source_id,
           kc.source_title,
           kc.section,
           kc.page,
           kc.content,
           kc.chunk_index,
           ts_rank(kc.content_tsv, to_tsquery('simple', ${orQuery})) AS score
    FROM knowledge_chunks kc
    WHERE kc.organization_id = ${organizationId}
      AND kc.content_tsv @@ to_tsquery('simple', ${orQuery})
      AND ${sql.raw(SOURCE_VALIDITY_SQL)}
    ORDER BY score DESC
    LIMIT ${limit}
  `);
  return (result as unknown as { rows: VectorRow[] }).rows;
}

/**
 * Hybrid search: semantic (vector) + keyword (tsvector) retrieval, fused with
 * Reciprocal Rank Fusion, then re-scored with a lexical term-match ratio so
 * the final ranking reflects how much of the question each chunk actually
 * covers. All heavy lifting stays in PostgreSQL except the portable cosine
 * scan, which runs in-process on the desktop machine.
 */
export async function hybridSearch(
  organizationId: string,
  rawQuery: string,
  opts?: {
    /** Test seam: override the query embedder (returns null to disable). */
    embedQuery?: (text: string) => Promise<number[] | null>;
  },
): Promise<RetrievedChunk[]> {
  const query = normalizeQuery(rawQuery);
  const candidatePoolSize = Math.max(30, config.rag.topK * 4);

  // Semantic vector search is only possible when a local embedding model is
  // installed. If it is missing, degrade gracefully to keyword-only search —
  // the system stays fully usable offline (lexical retrieval), never crashes.
  let queryEmbedding: number[] | null = null;
  try {
    if (opts?.embedQuery) {
      queryEmbedding = await opts.embedQuery(query);
    } else {
      const embeddingProvider = getEmbeddingProvider();
      const [embedding] = await embeddingProvider.embed([query], "query");
      queryEmbedding = embedding.vector;
    }
  } catch (error) {
    if (!searchWarnedNoEmbedding) {
      searchWarnedNoEmbedding = true;
      console.warn(
        `[RAG] Local embedding model unavailable — using keyword-only search: ${(error as Error)?.message ?? error}`,
      );
    }
  }

  const [vectorRows, keywordRows] = await Promise.all([
    queryEmbedding
      ? isPortableDatabase
        ? vectorSearchPortable(organizationId, queryEmbedding, candidatePoolSize)
        : vectorSearchPg(organizationId, queryEmbedding, candidatePoolSize)
      : Promise.resolve([] as VectorRow[]),
    keywordSearch(organizationId, query, candidatePoolSize),
  ]);

  const RRF_K = 60;
  const fused = new Map<string, RetrievedChunk>();

  vectorRows.forEach((row, rank) => {
    fused.set(row.id, {
      id: row.id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceTitle: row.source_title,
      section: row.section,
      page: row.page,
      content: row.content,
      chunkIndex: row.chunk_index,
      vectorScore: Number(row.score),
      keywordScore: 0,
      fusedScore: 1 / (RRF_K + rank + 1),
      matchRatio: 0,
    });
  });

  keywordRows.forEach((row, rank) => {
    const existing = fused.get(row.id);
    const rrfContribution = 1 / (RRF_K + rank + 1);
    if (existing) {
      existing.keywordScore = Number(row.score);
      existing.fusedScore += rrfContribution;
    } else {
      fused.set(row.id, {
        id: row.id,
        sourceType: row.source_type,
        sourceId: row.source_id,
        sourceTitle: row.source_title,
        section: row.section,
        page: row.page,
        content: row.content,
        chunkIndex: row.chunk_index,
        vectorScore: 0,
        keywordScore: Number(row.score),
        fusedScore: rrfContribution,
        matchRatio: 0,
      });
    }
  });

  const chunks = Array.from(fused.values());
  if (chunks.length === 0) return [];

  // Lexical precision: fraction of the query's significant terms actually
  // present in the chunk (compared in normalized token space, same as the
  // index). This penalizes chunks that matched only one vague term.
  const qTerms = queryTerms(query);
  for (const chunk of chunks) {
    const tokens = new Set(searchTokens(chunk.content));
    chunk.matchRatio =
      qTerms.length > 0
        ? qTerms.filter((t) => tokens.has(t)).length / qTerms.length
        : 0;
  }

  // Re-rank: blend RRF position with semantic similarity and term coverage.
  const maxRrf = Math.max(1e-9, ...chunks.map((c) => c.fusedScore));
  const hasVectorLeg = vectorRows.length > 0;
  for (const chunk of chunks) {
    const rrfNorm = chunk.fusedScore / maxRrf;
    const cosNorm = Math.min(1, Math.max(0, chunk.vectorScore) / 0.75);
    chunk.fusedScore = hasVectorLeg
      ? 0.45 * rrfNorm + 0.35 * cosNorm + 0.2 * chunk.matchRatio
      : 0.55 * rrfNorm + 0.45 * chunk.matchRatio;
  }

  // Require a minimum signal: strong semantic similarity, a keyword hit, or
  // at least one query term present in the chunk.
  return chunks
    .filter(
      (c) =>
        c.vectorScore >= config.rag.minScore ||
        c.keywordScore > 0 ||
        c.matchRatio > 0,
    )
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, config.rag.topK);
}
