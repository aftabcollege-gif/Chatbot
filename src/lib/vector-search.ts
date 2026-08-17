import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { documentChunks, documents, knowledgeItems } from "@/db/schema";
import { cosineSimilarity } from "@/lib/local-embeddings";

export type SearchResult = {
  id: string;
  documentId?: string;
  knowledgeId?: string;
  content: string;
  title: string;
  sourceType: "document" | "knowledge";
  pageNumber: number | null;
  section: string | null;
  heading: string | null;
  relevanceScore: number;
};

function isVisible(
  visibility: string | null | undefined,
  rowDepartmentId: string | null | undefined,
  rowOwnerId: string | null | undefined,
  departmentId: string | null,
  userId: string
): boolean {
  if (visibility === "organization") return true;
  if (visibility === "department") return !!departmentId && rowDepartmentId === departmentId;
  if (visibility === "private") return rowOwnerId === userId;
  // Default to visible when visibility is not set (legacy rows).
  return !visibility;
}

/**
 * Vector search implemented entirely in application code (no pgvector /
 * database extension required). Embeddings are stored as plain JSON number
 * arrays; similarity is computed with cosine distance in JavaScript.
 */
export async function searchDocuments(
  queryEmbedding: number[],
  organizationId: string,
  departmentId: string | null,
  userId: string,
  limit = 8
): Promise<SearchResult[]> {
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
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documents.id, documentChunks.documentId))
    .where(
      and(
        eq(documentChunks.organizationId, organizationId),
        isNotNull(documentChunks.embedding),
        eq(documents.status, "READY")
      )
    );

  return rows
    .filter((row) => isVisible(row.visibility, row.departmentId, row.ownerId, departmentId, userId))
    .map((row) => ({
      id: row.id,
      documentId: row.documentId,
      content: row.content,
      title: row.title,
      sourceType: "document" as const,
      pageNumber: row.pageNumber,
      section: row.section,
      heading: row.heading,
      relevanceScore: cosineSimilarity(queryEmbedding, (row.embedding as number[]) ?? []),
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

export async function searchKnowledge(
  queryEmbedding: number[],
  organizationId: string,
  departmentId: string | null,
  userId: string,
  limit = 4
): Promise<SearchResult[]> {
  const rows = await db
    .select({
      id: knowledgeItems.id,
      title: knowledgeItems.title,
      subject: knowledgeItems.subject,
      problemDescription: knowledgeItems.problemDescription,
      actionTaken: knowledgeItems.actionTaken,
      result: knowledgeItems.result,
      lessonLearned: knowledgeItems.lessonLearned,
      suggestion: knowledgeItems.suggestion,
      embedding: knowledgeItems.embedding,
      visibility: knowledgeItems.visibility,
      departmentId: knowledgeItems.departmentId,
      ownerId: knowledgeItems.ownerId,
    })
    .from(knowledgeItems)
    .where(
      and(
        eq(knowledgeItems.organizationId, organizationId),
        isNotNull(knowledgeItems.embedding),
        eq(knowledgeItems.status, "APPROVED")
      )
    );

  return rows
    .filter((row) => isVisible(row.visibility, row.departmentId, row.ownerId, departmentId, userId))
    .map((row) => ({
      id: row.id,
      knowledgeId: row.id,
      content: [row.title, row.subject, row.problemDescription, row.actionTaken, row.result, row.lessonLearned, row.suggestion]
        .filter(Boolean)
        .join("\n"),
      title: row.title,
      sourceType: "knowledge" as const,
      pageNumber: null,
      section: null,
      heading: null,
      relevanceScore: cosineSimilarity(queryEmbedding, (row.embedding as number[]) ?? []),
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

export async function cosineSearch(
  queryEmbedding: number[],
  organizationId: string,
  departmentId: string | null,
  userId: string,
  limit = 8
): Promise<SearchResult[]> {
  const [docResults, knowledgeResults] = await Promise.all([
    searchDocuments(queryEmbedding, organizationId, departmentId, userId, limit),
    searchKnowledge(queryEmbedding, organizationId, departmentId, userId, Math.max(2, Math.ceil(limit / 2))),
  ]);
  return [...docResults, ...knowledgeResults]
    .filter((result) => result.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}
