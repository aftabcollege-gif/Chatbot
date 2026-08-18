/**
 * Vector Search — Application-level cosine similarity
 *
 * ARCHITECTURE NOTE:
 * Embeddings are stored as jsonb number arrays. For datasets < 100k chunks,
 * application-level cosine similarity is adequate. For larger datasets,
 * migrate to pgvector with HNSW index.
 *
 * SECURITY: All retrieval is permission-scoped BEFORE returning results.
 * RAG security model per directive §24:
 * User → Identity → Permissions → Tenant Scope → Department Scope → Document Scope → Retrieval
 */

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { documentChunks, documents, knowledgeItems, experiences } from "@/db/schema";
import { cosineSimilarity, lexicalScore, tokenize } from "@/lib/local-embeddings";

export interface SearchResult {
  id: string;
  documentId?: string;
  knowledgeId?: string;
  experienceId?: string;
  content: string;
  title: string;
  // source_type: document | knowledge | experience
  sourceType: "document" | "knowledge" | "experience";
  pageNumber: number | null;
  section: string | null;
  heading: string | null;
  relevanceScore: number;
  keywordScore?: number;
  combinedScore?: number;
  excerpt?: string;
}

export interface SearchOptions {
  organizationId: string;
  departmentId?: string | null;
  userId: string;
  limit?: number;
  minScore?: number;
  sourceTypes?: Array<"document" | "knowledge" | "experience">;
}

/** Check if content is visible to the requesting user */
function isVisible(
  visibility: string | null | undefined,
  rowDepartmentId: string | null | undefined,
  rowOwnerId: string | null | undefined,
  userDepartmentId: string | null | undefined,
  userId: string
): boolean {
  if (visibility === "organization") return true;
  if (visibility === "department") {
    return !!userDepartmentId && rowDepartmentId === userDepartmentId;
  }
  if (visibility === "private") return rowOwnerId === userId;
  // Default: visible (for backwards compat with rows without visibility set)
  return !visibility;
}

/** Search document chunks — permission-scoped */
async function searchDocumentChunks(
  queryEmbedding: number[],
  queryTokens: string[],
  options: SearchOptions
): Promise<SearchResult[]> {
  // SECURITY: Only load chunks for this organization with ACTIVE status
  // This does NOT load all chunks — it loads only READY documents' chunks for this org
  const rows = await db
    .select({
      id: documentChunks.id,
      documentId: documentChunks.documentId,
      content: documentChunks.content,
      title: documents.title,
      pageNumber: documentChunks.pageNumber,
      section: documentChunks.section,
      heading: documentChunks.heading,
      embedding: documentChunks.embedding,
      visibility: documents.visibility,
      departmentId: documents.departmentId,
      ownerId: documents.ownerId,
      authorityScore: documentChunks.authorityScore,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(
      and(
        eq(documentChunks.organizationId, options.organizationId),
        eq(documentChunks.status, "ACTIVE"),
        eq(documents.status, "READY"),
        isNotNull(documentChunks.embedding),
        isNull(documents.deletedAt)
      )
    );

  return rows
    .filter((row) =>
      isVisible(
        row.visibility,
        row.departmentId,
        row.ownerId,
        options.departmentId,
        options.userId
      )
    )
    .map((row) => {
      const semanticScore = cosineSimilarity(
        queryEmbedding,
        (row.embedding as number[]) ?? []
      );
      const kwScore = queryTokens.length > 0 ? lexicalScore(queryTokens, row.content) : 0;
      // Weighted combination: 70% semantic + 30% keyword
      const combined = semanticScore * 0.7 + kwScore * 0.3;
      return {
        id: row.id,
        documentId: row.documentId ?? undefined,
        content: row.content,
        title: row.title,
        sourceType: "document" as const,
        pageNumber: row.pageNumber,
        section: row.section,
        heading: row.heading,
        relevanceScore: semanticScore,
        keywordScore: kwScore,
        combinedScore: combined,
        excerpt: row.content.slice(0, 300),
      };
    })
    .sort((a, b) => (b.combinedScore ?? 0) - (a.combinedScore ?? 0));
}

/** Search knowledge items — permission-scoped */
async function searchKnowledgeItems(
  queryEmbedding: number[],
  queryTokens: string[],
  options: SearchOptions
): Promise<SearchResult[]> {
  const rows = await db
    .select({
      id: knowledgeItems.id,
      title: knowledgeItems.title,
      content: knowledgeItems.content,
      embedding: knowledgeItems.embedding,
      visibility: knowledgeItems.visibility,
      departmentId: knowledgeItems.departmentId,
      ownerId: knowledgeItems.ownerId,
    })
    .from(knowledgeItems)
    .where(
      and(
        eq(knowledgeItems.organizationId, options.organizationId),
        eq(knowledgeItems.status, "PUBLISHED"),
        isNotNull(knowledgeItems.embedding),
        isNull(knowledgeItems.deletedAt)
      )
    );

  return rows
    .filter((row) =>
      isVisible(
        row.visibility,
        row.departmentId,
        row.ownerId,
        options.departmentId,
        options.userId
      )
    )
    .map((row) => {
      const semanticScore = cosineSimilarity(
        queryEmbedding,
        (row.embedding as number[]) ?? []
      );
      const kwScore = queryTokens.length > 0 ? lexicalScore(queryTokens, row.content ?? "") : 0;
      const combined = semanticScore * 0.7 + kwScore * 0.3;
      return {
        id: row.id,
        knowledgeId: row.id,
        content: row.content ?? "",
        title: row.title,
        sourceType: "knowledge" as const,
        pageNumber: null,
        section: null,
        heading: null,
        relevanceScore: semanticScore,
        keywordScore: kwScore,
        combinedScore: combined,
        excerpt: (row.content ?? "").slice(0, 300),
      };
    })
    .sort((a, b) => (b.combinedScore ?? 0) - (a.combinedScore ?? 0));
}

/** Search published experiences — permission-scoped */
async function searchExperiences(
  queryEmbedding: number[],
  queryTokens: string[],
  options: SearchOptions
): Promise<SearchResult[]> {
  const rows = await db
    .select({
      id: experiences.id,
      title: experiences.title,
      problemDescription: experiences.problemDescription,
      lessonsLearned: experiences.lessonsLearned,
      actionsTaken: experiences.actionsTaken,
      embedding: experiences.embedding,
      visibility: experiences.visibility,
      departmentId: experiences.departmentId,
      ownerId: experiences.ownerId,
    })
    .from(experiences)
    .where(
      and(
        eq(experiences.organizationId, options.organizationId),
        eq(experiences.status, "PUBLISHED"),
        isNotNull(experiences.embedding),
        isNull(experiences.deletedAt)
      )
    );

  return rows
    .filter((row) =>
      isVisible(
        row.visibility,
        row.departmentId,
        row.ownerId,
        options.departmentId,
        options.userId
      )
    )
    .map((row) => {
      const fullContent = [
        row.title,
        row.problemDescription,
        row.lessonsLearned,
        row.actionsTaken,
      ]
        .filter(Boolean)
        .join("\n");
      const semanticScore = cosineSimilarity(
        queryEmbedding,
        (row.embedding as number[]) ?? []
      );
      const kwScore = queryTokens.length > 0 ? lexicalScore(queryTokens, fullContent) : 0;
      const combined = semanticScore * 0.7 + kwScore * 0.3;
      return {
        id: row.id,
        experienceId: row.id,
        content: fullContent,
        title: row.title,
        sourceType: "experience" as const,
        pageNumber: null,
        section: null,
        heading: null,
        relevanceScore: semanticScore,
        keywordScore: kwScore,
        combinedScore: combined,
        excerpt: row.problemDescription.slice(0, 300),
      };
    })
    .sort((a, b) => (b.combinedScore ?? 0) - (a.combinedScore ?? 0));
}

/**
 * Main search function — hybrid (semantic + keyword), permission-scoped
 *
 * SECURITY: Results are filtered by organization, department, and visibility
 * BEFORE being returned. No unauthorized data ever reaches the LLM context.
 */
export async function hybridSearch(
  queryEmbedding: number[],
  query: string,
  options: SearchOptions
): Promise<SearchResult[]> {
  const limit = options.limit ?? 8;
  const minScore = options.minScore ?? parseFloat(process.env.RAG_MIN_SCORE ?? "0.1");
  const sourceTypes = options.sourceTypes ?? ["document", "knowledge", "experience"];
  const queryTokens = tokenize(query);

  const searchPromises: Promise<SearchResult[]>[] = [];
  if (sourceTypes.includes("document")) {
    searchPromises.push(searchDocumentChunks(queryEmbedding, queryTokens, options));
  }
  if (sourceTypes.includes("knowledge")) {
    searchPromises.push(searchKnowledgeItems(queryEmbedding, queryTokens, options));
  }
  if (sourceTypes.includes("experience")) {
    searchPromises.push(searchExperiences(queryEmbedding, queryTokens, options));
  }

  const allResults = (await Promise.all(searchPromises)).flat();

  return allResults
    .filter((r) => (r.combinedScore ?? r.relevanceScore) >= minScore)
    .sort((a, b) => (b.combinedScore ?? b.relevanceScore) - (a.combinedScore ?? a.relevanceScore))
    .slice(0, limit);
}
