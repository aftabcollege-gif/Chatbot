import { eq } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeItems, knowledgeTags } from "@/db/schema";
import { chunkPages } from "@/lib/documents/chunk";
import { reindexChunks } from "@/lib/rag/ingest";
import { updateJobStatus } from "@/lib/jobs/queue";

/**
 * Knowledge-base items are indexed into `knowledge_chunks` exactly like
 * documents and experiences (source_type = 'knowledge'), so they take part in
 * hybrid retrieval and can be cited. Runs on the background worker — never in
 * the request that creates or publishes the item.
 */
function buildKnowledgeText(item: typeof knowledgeItems.$inferSelect, tags: string[]): string {
  return [
    `عنوان: ${item.title}`,
    item.subject ? `موضوع: ${item.subject}` : "",
    item.summary ? `خلاصه: ${item.summary}` : "",
    item.content,
    tags.length > 0 ? `برچسب‌ها: ${tags.join("، ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function processKnowledgeJob(jobId: string, knowledgeId: string): Promise<void> {
  const [item] = await db.select().from(knowledgeItems).where(eq(knowledgeItems.id, knowledgeId)).limit(1);
  if (!item) throw new Error(`Knowledge item ${knowledgeId} not found`);

  await updateJobStatus(jobId, "PROCESSING", { progress: 10 });

  const tagRows = await db
    .select({ tag: knowledgeTags.tag })
    .from(knowledgeTags)
    .where(eq(knowledgeTags.knowledgeId, knowledgeId));

  const text = buildKnowledgeText(item, tagRows.map((t) => t.tag));
  const chunks = chunkPages([{ page: 1, text }]);

  await reindexChunks(
    {
      organizationId: item.organizationId,
      sourceType: "knowledge",
      sourceId: item.id,
      sourceVersion: 1,
      sourceTitle: item.title,
    },
    chunks,
    async (done, total) => {
      const progress = 10 + Math.round((done / total) * 85);
      await updateJobStatus(jobId, "PROCESSING", { progress });
    },
  );

  await updateJobStatus(jobId, "COMPLETED", { progress: 100 });
}
