import type { CitationRecord } from "@/db/schema";
import type { RetrievedChunk } from "@/lib/rag/search";

export function buildCitations(chunks: RetrievedChunk[]): CitationRecord[] {
  return chunks.map((chunk) => ({
    sourceType: chunk.sourceType,
    sourceId: chunk.sourceId,
    sourceTitle: chunk.sourceTitle,
    page: chunk.page,
    section: chunk.section,
    chunkId: chunk.id,
    relevanceScore: Math.round(Math.max(chunk.vectorScore, 0) * 1000) / 1000,
  }));
}

export function formatCitationsAsPersianText(citations: CitationRecord[]): string {
  if (citations.length === 0) return "";
  const lines = citations.map((c, idx) => {
    const parts: string[] = [`${idx + 1}. ${c.sourceTitle}`];
    if (c.page) parts.push(`   صفحه ${c.page}`);
    if (c.section) parts.push(`   بخش: ${c.section}`);
    return parts.join("\n");
  });
  return `منابع:\n${lines.join("\n")}`;
}
