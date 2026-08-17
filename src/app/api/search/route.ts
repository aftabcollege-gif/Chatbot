import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { documentChunks, documents, knowledgeItems, departments } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth-server";
import { getEmbedding } from "@/lib/embeddings";
import { cosineSimilarity } from "@/lib/local-embeddings";

interface SearchResultItem {
  id: string;
  type: "document" | "knowledge";
  title: string;
  snippet: string;
  pageNumber?: number | null;
  section?: string | null;
  department?: string | null;
  relevanceScore: number;
  createdAt: string;
}

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
  return !visibility;
}

function buildSnippet(content: string, query: string, radius = 90): string {
  const lower = content.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase().split(/\s+/)[0] ?? "");
  const start = idx > radius ? idx - radius : 0;
  const end = Math.min(content.length, (idx > -1 ? idx : 0) + radius * 2);
  const snippet = content.slice(start, end).trim();
  return (start > 0 ? "… " : "") + snippet + (end < content.length ? " …" : "");
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") || "").trim();
  const type = searchParams.get("type") || "all";
  const limit = Math.min(50, Number(searchParams.get("limit") ?? 20));

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  if (!user.organizationId) {
    return NextResponse.json({ results: [] });
  }

  const queryEmbedding = await getEmbedding(query);
  const results: SearchResultItem[] = [];

  if (type === "all" || type === "document") {
    const rows = await db
      .select({
        id: documentChunks.id,
        content: documentChunks.content,
        title: documents.title,
        pageNumber: documentChunks.pageNumber,
        section: documentChunks.section,
        embedding: documentChunks.embedding,
        visibility: documents.visibility,
        departmentId: documents.departmentId,
        ownerId: documents.ownerId,
        departmentName: departments.name,
        createdAt: documentChunks.createdAt,
      })
      .from(documentChunks)
      .innerJoin(documents, eq(documents.id, documentChunks.documentId))
      .leftJoin(departments, eq(departments.id, documents.departmentId))
      .where(
        and(
          eq(documentChunks.organizationId, user.organizationId),
          isNotNull(documentChunks.embedding),
          eq(documents.status, "READY")
        )
      );

    for (const row of rows) {
      if (!isVisible(row.visibility, row.departmentId, row.ownerId, user.departmentId, user.id)) continue;
      const score = cosineSimilarity(queryEmbedding, (row.embedding as number[]) ?? []);
      if (score <= 0) continue;
      results.push({
        id: row.id,
        type: "document",
        title: row.title,
        snippet: buildSnippet(row.content, query),
        pageNumber: row.pageNumber,
        section: row.section,
        department: row.departmentName,
        relevanceScore: score,
        createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
      });
    }
  }

  if (type === "all" || type === "knowledge") {
    const rows = await db
      .select({
        id: knowledgeItems.id,
        title: knowledgeItems.title,
        subject: knowledgeItems.subject,
        problemDescription: knowledgeItems.problemDescription,
        actionTaken: knowledgeItems.actionTaken,
        lessonLearned: knowledgeItems.lessonLearned,
        embedding: knowledgeItems.embedding,
        visibility: knowledgeItems.visibility,
        departmentId: knowledgeItems.departmentId,
        ownerId: knowledgeItems.ownerId,
        departmentName: departments.name,
        createdAt: knowledgeItems.createdAt,
        status: knowledgeItems.status,
      })
      .from(knowledgeItems)
      .leftJoin(departments, eq(departments.id, knowledgeItems.departmentId))
      .where(
        and(
          eq(knowledgeItems.organizationId, user.organizationId),
          isNotNull(knowledgeItems.embedding)
        )
      );

    for (const row of rows) {
      if (row.status !== "APPROVED" && row.status !== "PUBLISHED") continue;
      if (!isVisible(row.visibility, row.departmentId, row.ownerId, user.departmentId, user.id)) continue;
      const score = cosineSimilarity(queryEmbedding, (row.embedding as number[]) ?? []);
      if (score <= 0) continue;
      const content = [row.problemDescription, row.actionTaken, row.lessonLearned].filter(Boolean).join(" — ");
      results.push({
        id: row.id,
        type: "knowledge",
        title: row.title,
        snippet: buildSnippet(content, query),
        department: row.departmentName,
        relevanceScore: score,
        createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
      });
    }
  }

  results.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return NextResponse.json({ results: results.slice(0, limit) });
}
