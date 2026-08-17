import { pool } from "@/db";

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

function vectorLiteral(vector: number[]) {
  return `[${vector.map((value) => Number(value).toString()).join(",")}]`;
}

export async function searchDocuments(queryEmbedding: number[], organizationId: string, departmentId: string | null, userId: string, limit = 8): Promise<SearchResult[]> {
  const result = await pool.query(
    `SELECT c.id, c.document_id AS "documentId", c.content, d.title,
            c.page_number AS "pageNumber", c.section, c.heading,
            1 - (c.embedding <=> $1::vector) AS "relevanceScore"
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
      WHERE c.organization_id = $2
        AND c.embedding IS NOT NULL
        AND d.status = 'READY'
        AND (d.visibility = 'organization' OR (d.visibility = 'department' AND d.department_id = $3) OR (d.visibility = 'private' AND d.owner_id = $4))
      ORDER BY c.embedding <=> $1::vector
      LIMIT $5`,
    [vectorLiteral(queryEmbedding), organizationId, departmentId, userId, limit]
  );
  return result.rows.map((row) => ({ ...row, sourceType: "document" as const }));
}

export async function searchKnowledge(queryEmbedding: number[], organizationId: string, departmentId: string | null, userId: string, limit = 4): Promise<SearchResult[]> {
  const result = await pool.query(
    `SELECT k.id, k.id AS "knowledgeId",
            concat_ws('\n', k.title, k.subject, k.problem_description, k.action_taken, k.result, k.lesson_learned, k.suggestion) AS content,
            k.title,
            1 - (k.embedding <=> $1::vector) AS "relevanceScore"
       FROM knowledge_items k
      WHERE k.organization_id = $2
        AND k.embedding IS NOT NULL
        AND k.status = 'APPROVED'
        AND (k.visibility = 'organization' OR (k.visibility = 'department' AND k.department_id = $3) OR (k.visibility = 'private' AND k.owner_id = $4))
      ORDER BY k.embedding <=> $1::vector
      LIMIT $5`,
    [vectorLiteral(queryEmbedding), organizationId, departmentId, userId, limit]
  );
  return result.rows.map((row) => ({
    ...row,
    sourceType: "knowledge" as const,
    pageNumber: null,
    section: null,
    heading: null,
  }));
}

export async function cosineSearch(queryEmbedding: number[], organizationId: string, departmentId: string | null, userId: string, limit = 8): Promise<SearchResult[]> {
  const [docResults, knowledgeResults] = await Promise.all([
    searchDocuments(queryEmbedding, organizationId, departmentId, userId, limit),
    searchKnowledge(queryEmbedding, organizationId, departmentId, userId, Math.max(2, Math.ceil(limit / 2))),
  ]);
  return [...docResults, ...knowledgeResults]
    .sort((a, b) => Number(b.relevanceScore) - Number(a.relevanceScore))
    .slice(0, limit);
}
