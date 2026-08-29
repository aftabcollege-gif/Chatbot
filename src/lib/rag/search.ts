import { sql } from "drizzle-orm";
import { db, isPortableDatabase } from "@/db";
import { config } from "@/lib/config";
import { getEmbeddingProvider } from "@/lib/ai/provider-factory";

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
  fusedScore: number;
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

async function vectorSearch(organizationId: string, embedding: number[], limit: number): Promise<VectorRow[]> {
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
      AND (
        (kc.source_type = 'document' AND EXISTS (
          SELECT 1 FROM documents d WHERE d.id = kc.source_id AND d.is_deleted = false AND d.status = 'completed'
        ))
        OR
        (kc.source_type = 'experience' AND EXISTS (
          SELECT 1 FROM experiences e WHERE e.id = kc.source_id AND e.is_deleted = false AND e.status = 'published'
        ))
      )
    ORDER BY kc.embedding <=> ${vectorLiteral}::vector
    LIMIT ${limit}
  `);
  return (result as unknown as { rows: VectorRow[] }).rows;
}

/**
 * Build an OR-combined tsquery from the raw query so natural-language
 * questions ("مدت مرخصی استعلاجی چقدر است؟") still match chunks that share
 * only some terms. ts_rank then ranks by relevance.
 */
function buildOrQuery(rawQuery: string): string | null {
  const terms = normalizeQuery(rawQuery)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
  if (terms.length === 0) return null;
  // Keep at most 12 terms to avoid pathological queries.
  return terms.slice(0, 12).join(" | ");
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
      AND (
        (kc.source_type = 'document' AND EXISTS (
          SELECT 1 FROM documents d WHERE d.id = kc.source_id AND d.is_deleted = false AND d.status = 'completed'
        ))
        OR
        (kc.source_type = 'experience' AND EXISTS (
          SELECT 1 FROM experiences e WHERE e.id = kc.source_id AND e.is_deleted = false AND e.status = 'published'
        ))
      )
    ORDER BY score DESC
    LIMIT ${limit}
  `);
  return (result as unknown as { rows: VectorRow[] }).rows;
}

/**
 * Hybrid Search + Reciprocal Rank Fusion + lightweight lexical reranking.
 * All computation happens inside PostgreSQL (pgvector HNSW + GIN tsvector)
 * so it scales to 100,000+ documents without loading chunks into memory.
 */
export async function hybridSearch(organizationId: string, rawQuery: string): Promise<RetrievedChunk[]> {
  const query = normalizeQuery(rawQuery);
  const candidatePoolSize = Math.max(30, config.rag.topK * 4);

  // Semantic vector search is only possible when a local embedding model is
  // installed. If it is missing, degrade gracefully to keyword-only search —
  // the system stays fully usable offline (lexical retrieval), never crashes.
  let queryEmbedding: number[] | null = null;
  try {
    const embeddingProvider = getEmbeddingProvider();
    const [embedding] = await embeddingProvider.embed([query], "query");
    queryEmbedding = embedding.vector;
  } catch (error) {
    console.error("[RAG] Local embedding model unavailable — keyword-only search:", error);
  }

  const [vectorRows, keywordRows] = await Promise.all([
    // PGlite is an embedded PostgreSQL runtime and intentionally ships
    // without the pgvector extension. The portable build remains fully
    // offline by using PostgreSQL full-text retrieval; server deployments
    // can still use the pgvector path.
    queryEmbedding && !isPortableDatabase
      ? vectorSearch(organizationId, queryEmbedding, candidatePoolSize)
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
      });
    }
  });

  // Reranking: sort by fused RRF score, but require a minimum semantic
  // similarity floor (RAG_MIN_SCORE) to avoid grounding on noise.
  const ranked = Array.from(fused.values())
    .filter((chunk) => chunk.vectorScore >= config.rag.minScore || chunk.keywordScore > 0)
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, config.rag.topK);

  return ranked;
}
