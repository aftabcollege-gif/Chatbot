import { sql } from "drizzle-orm";
import { db, isVectorSearchAvailable } from "@/db";
import type { RagSourceType } from "@/db/schema";
import { config } from "@/lib/config";
import { getEmbeddingProvider } from "@/lib/ai/provider-factory";
import { extractKeywordTerms, normalizePersian, tsqueryLexeme } from "@/lib/text/persian";
import { rerankChunks } from "@/lib/rag/rerank";
import { embeddingsEnabled } from "@/lib/rag/ingest";

export interface RetrievedChunk {
  id: string;
  sourceType: RagSourceType;
  sourceId: string;
  sourceTitle: string;
  section: string | null;
  page: number | null;
  content: string;
  chunkIndex: number;
  vectorScore: number;
  keywordScore: number;
  fusedScore: number;
}

export interface SearchDiagnostics {
  vectorUsed: boolean;
  keywordMode: "all" | "all-but-one" | "pairs" | "or" | "none";
  vectorCandidates: number;
  keywordCandidates: number;
  embeddingMs: number;
  vectorMs: number;
  keywordMs: number;
  rerankMs: number;
  totalMs: number;
}

export function normalizeQuery(raw: string): string {
  return normalizePersian(raw)
    .replace(/\s+/g, " ")
    .trim();
}

interface VectorRow {
  [key: string]: unknown;
  id: string;
  source_type: RagSourceType;
  source_id: string;
  source_title: string;
  section: string | null;
  page: number | null;
  content: string;
  chunk_index: number;
  score: number;
}

// Shared visibility predicate: only chunks whose source is live are retrievable.
// The source tables carry partial indexes matching exactly these predicates
// (documents_retrieval_idx / experiences_retrieval_idx /
// knowledge_items_retrieval_idx), so the EXISTS probes are index-only lookups.
// Workflow statuses are stored upper-case (PUBLISHED) by the API.
const VISIBLE_SOURCE_SQL = sql`(
  (kc.source_type = 'document' AND EXISTS (
    SELECT 1 FROM documents d WHERE d.id = kc.source_id AND d.is_deleted = false AND d.status = 'completed'
  ))
  OR
  (kc.source_type = 'experience' AND EXISTS (
    SELECT 1 FROM experiences e WHERE e.id = kc.source_id AND e.is_deleted = false AND e.status = 'PUBLISHED'
  ))
  OR
  (kc.source_type = 'knowledge' AND EXISTS (
    SELECT 1 FROM knowledge_items k WHERE k.id = kc.source_id AND k.is_deleted = false AND k.deleted_at IS NULL AND k.status = 'PUBLISHED'
  ))
)`;

/**
 * HNSW approximate nearest-neighbour search.
 *
 * `hnsw.iterative_scan = relaxed_order` (pgvector ≥ 0.8) makes the index keep
 * scanning when post-filters (organisation / visibility) discard candidates,
 * instead of returning fewer than `limit` rows — essential once one tenant is a
 * small fraction of a multi-million-row table. `hnsw.ef_search` trades a
 * little latency for recall; 80 is a good default for top-30 candidate pools.
 */
async function vectorSearch(organizationId: string, embedding: number[], limit: number): Promise<VectorRow[]> {
  const vectorLiteral = `[${embedding.join(",")}]`;
  const efSearch = Math.max(40, Math.min(400, limit * 3));
  await db.execute(sql`SET hnsw.ef_search = ${sql.raw(String(efSearch))}`);
  await db.execute(sql`SET hnsw.iterative_scan = relaxed_order`).catch(() => {
    /* older pgvector without iterative scan — plain HNSW still works */
  });
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
      AND ${VISIBLE_SOURCE_SQL}
    ORDER BY kc.embedding <=> ${vectorLiteral}::vector
    LIMIT ${limit}
  `);
  return (result as unknown as { rows: VectorRow[] }).rows;
}

/**
 * Keyword query relaxation ladder.
 *
 * Level 0  all terms must co-occur                      (t1 & t2 & t3 & t4)
 * Level 1  all but one                                  ((t1&t2&t3) | (t1&t2&t4) | …)
 * Level 2  any pair                                     ((t1&t2) | (t1&t3) | …)
 * Plain OR is used only for 1–2 term queries. For longer questions a chunk
 * that shares just ONE word with the question is noise, and — more
 * importantly — a single common word can match a large share of a multi-
 * million-row corpus, which is exactly the query shape that made the old
 * implementation take seconds. Every level above requires ≥ 2 co-occurring
 * terms, so the GIN index intersects posting lists and the candidate set
 * stays small regardless of corpus size.
 *
 * Stop words ("است", "چقدر", "را", …) are removed first, letters/digits are
 * normalised (ي→ی, ك→ک, ۱→1) and longer terms use prefix matching (`:*`) so
 * "مرخصی" also matches "مرخصی‌ها" and "استعلاجی" matches inflected forms.
 */
export interface TsQueryLevel {
  label: "all" | "all-but-one" | "pairs" | "or";
  query: string;
}

function combinations<T>(items: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push(acc);
      return;
    }
    for (let i = start; i < items.length; i++) rec(i + 1, [...acc, items[i]]);
  };
  rec(0, []);
  return out;
}

export function buildTsQueryLadder(rawQuery: string): { levels: TsQueryLevel[]; termCount: number } {
  const { terms, usedStopWordsOnly } = extractKeywordTerms(rawQuery, 12);
  if (terms.length === 0) return { levels: [], termCount: 0 };
  const lexemes = terms.map((t) => tsqueryLexeme(t, t.length >= 4 && !/^\d+$/.test(t)));
  const n = lexemes.length;

  if (usedStopWordsOnly || n === 1) {
    return { levels: [{ label: "or", query: lexemes.join(" | ") }], termCount: n };
  }
  if (n === 2) {
    return {
      levels: [
        { label: "all", query: lexemes.join(" & ") },
        { label: "or", query: lexemes.join(" | ") },
      ],
      termCount: n,
    };
  }
  // n ≥ 3 — cap the combinatorial levels at the 8 longest (most specific) terms.
  const pool = n <= 8 ? lexemes : [...lexemes].sort((a, b) => b.length - a.length).slice(0, 8);
  const levels: TsQueryLevel[] = [
    { label: "all", query: lexemes.join(" & ") },
    { label: "all-but-one", query: combinations(pool, pool.length - 1).map((c) => `(${c.join(" & ")})`).join(" | ") },
  ];
  if (pool.length > 3) {
    levels.push({ label: "pairs", query: combinations(pool, 2).map((c) => `(${c.join(" & ")})`).join(" | ") });
  }
  return { levels, termCount: n };
}

/** @deprecated kept for tooling; prefer buildTsQueryLadder */
export function buildTsQueries(rawQuery: string): { andQuery: string | null; orQuery: string | null; termCount: number } {
  const { levels, termCount } = buildTsQueryLadder(rawQuery);
  const all = levels.find((l) => l.label === "all")?.query ?? null;
  const loose = levels[levels.length - 1]?.query ?? null;
  return { andQuery: all, orQuery: loose, termCount };
}

/**
 * Upper bound on rows that are ranked for a single keyword level. The GIN
 * index finds matching row ids cheaply, but computing ts_rank_cd requires
 * fetching each row; capping the heap fetches bounds worst-case latency for
 * very common terms (the cap only ever bites on the loosest level).
 */
const KEYWORD_SCAN_CAP = Math.max(500, Number(process.env.RAG_KEYWORD_SCAN_CAP ?? 5000));

async function keywordSearchWith(organizationId: string, tsQuery: string, limit: number): Promise<VectorRow[]> {
  // ts_rank_cd with normalisation 32 (rank / (rank + 1)) keeps scores in
  // (0, 1) and rewards term proximity — much better for "which paragraph
  // answers this?" than plain ts_rank on long chunks.
  const result = await db.execute<VectorRow>(sql`
    SELECT m.id,
           m.source_type,
           m.source_id,
           m.source_title,
           m.section,
           m.page,
           m.content,
           m.chunk_index,
           ts_rank_cd(m.content_tsv, to_tsquery('simple', ${tsQuery}), 32) AS score
    FROM (
      SELECT kc.id, kc.source_type, kc.source_id, kc.source_title, kc.section, kc.page,
             kc.content, kc.chunk_index, kc.content_tsv
      FROM knowledge_chunks kc
      WHERE kc.organization_id = ${organizationId}
        AND kc.content_tsv @@ to_tsquery('simple', ${tsQuery})
        AND ${VISIBLE_SOURCE_SQL}
      LIMIT ${KEYWORD_SCAN_CAP}
    ) m
    ORDER BY score DESC
    LIMIT ${limit}
  `);
  return (result as unknown as { rows: VectorRow[] }).rows;
}

async function keywordSearch(
  organizationId: string,
  rawQuery: string,
  limit: number,
): Promise<{ rows: VectorRow[]; mode: SearchDiagnostics["keywordMode"] }> {
  const { levels } = buildTsQueryLadder(rawQuery);
  if (levels.length === 0) return { rows: [], mode: "none" };

  const enough = Math.min(limit, 5);
  const seen = new Set<string>();
  const rows: VectorRow[] = [];
  let mode: SearchDiagnostics["keywordMode"] = "none";

  for (const level of levels) {
    const hits = await keywordSearchWith(organizationId, level.query, limit);
    for (const hit of hits) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      rows.push(hit);
    }
    mode = level.label;
    // Stop as soon as a level produced a reasonable candidate set; stricter
    // levels come first so their hits keep the top ranks.
    if (rows.length >= enough) break;
  }
  return { rows: rows.slice(0, limit), mode };
}

let embeddingWarningShown = false;
function warnEmbeddingUnavailableOnce(error: unknown) {
  if (embeddingWarningShown) return;
  embeddingWarningShown = true;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[RAG] Embedding model unavailable — falling back to keyword-only search (${message})`);
}

function toChunk(row: VectorRow, vectorScore: number, keywordScore: number, fusedScore: number): RetrievedChunk {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceTitle: row.source_title,
    section: row.section,
    page: row.page,
    content: row.content,
    chunkIndex: row.chunk_index,
    vectorScore,
    keywordScore,
    fusedScore,
  };
}

/**
 * Hybrid Search + Reciprocal Rank Fusion + local reranking.
 *
 * All candidate generation happens inside PostgreSQL (pgvector HNSW + GIN
 * tsvector), so cost is O(log n) in corpus size — it does not load chunks
 * into memory and stays fast at 100,000+ documents / millions of chunks.
 */
export async function hybridSearch(
  organizationId: string,
  rawQuery: string,
  options: {
    topK?: number;
    diagnostics?: (d: SearchDiagnostics) => void;
    /** Test seam: supply the query embedding instead of running the local model. */
    embedQuery?: (query: string) => Promise<number[] | null>;
  } = {},
): Promise<RetrievedChunk[]> {
  const started = Date.now();
  const topK = options.topK ?? config.rag.topK;
  const query = normalizeQuery(rawQuery);
  const candidatePoolSize = Math.max(30, topK * 4);

  // Semantic vector search is only possible when a local embedding model is
  // installed and pgvector loaded. If either is missing, degrade gracefully to
  // keyword-only search — the system stays fully usable offline.
  let queryEmbedding: number[] | null = null;
  let embeddingMs = 0;
  if (isVectorSearchAvailable() && (options.embedQuery || embeddingsEnabled())) {
    const t0 = Date.now();
    try {
      if (options.embedQuery) {
        queryEmbedding = await options.embedQuery(query);
      } else {
        const embeddingProvider = getEmbeddingProvider();
        const [embedding] = await embeddingProvider.embed([query], "query");
        queryEmbedding = embedding.vector;
      }
    } catch (error) {
      warnEmbeddingUnavailableOnce(error);
    }
    embeddingMs = Date.now() - t0;
  }

  let vectorMs = 0;
  let keywordMs = 0;
  const [vectorRows, keyword] = await Promise.all([
    (async () => {
      if (!queryEmbedding) return [] as VectorRow[];
      const t0 = Date.now();
      try {
        return await vectorSearch(organizationId, queryEmbedding, candidatePoolSize);
      } catch (error) {
        console.error("[RAG] Vector search failed — continuing with keyword results:", error);
        return [] as VectorRow[];
      } finally {
        vectorMs = Date.now() - t0;
      }
    })(),
    (async () => {
      const t0 = Date.now();
      try {
        return await keywordSearch(organizationId, query, candidatePoolSize);
      } finally {
        keywordMs = Date.now() - t0;
      }
    })(),
  ]);

  const RRF_K = 60;
  const fused = new Map<string, RetrievedChunk>();

  vectorRows.forEach((row, rank) => {
    fused.set(row.id, toChunk(row, Number(row.score), 0, 1 / (RRF_K + rank + 1)));
  });

  keyword.rows.forEach((row, rank) => {
    const rrfContribution = 1 / (RRF_K + rank + 1);
    const existing = fused.get(row.id);
    if (existing) {
      existing.keywordScore = Number(row.score);
      existing.fusedScore += rrfContribution;
    } else {
      fused.set(row.id, toChunk(row, 0, Number(row.score), rrfContribution));
    }
  });

  // Keep semantic hits only above the similarity floor (RAG_MIN_SCORE) so we
  // never ground an answer on noise; keyword hits already passed a match test.
  const candidates = Array.from(fused.values())
    .filter((chunk) => chunk.keywordScore > 0 || chunk.vectorScore >= config.rag.minScore)
    .sort((a, b) => b.fusedScore - a.fusedScore);

  // Rerank the fused candidate pool (cheap lexical + optional cross-encoder)
  // and cut to topK.
  const t1 = Date.now();
  const ranked = await rerankChunks(query, candidates, topK);
  const rerankMs = Date.now() - t1;

  options.diagnostics?.({
    vectorUsed: queryEmbedding !== null,
    keywordMode: keyword.mode,
    vectorCandidates: vectorRows.length,
    keywordCandidates: keyword.rows.length,
    embeddingMs,
    vectorMs,
    keywordMs,
    rerankMs,
    totalMs: Date.now() - started,
  });

  return ranked;
}
