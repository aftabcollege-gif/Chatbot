import { eq } from "drizzle-orm";
import { db } from "@/db";
import { experiences } from "@/db/schema";
import { chunkPages } from "@/lib/documents/chunk";
import { reindexChunks } from "@/lib/rag/ingest";
import { updateJobStatus } from "@/lib/jobs/queue";

function buildExperienceText(exp: typeof experiences.$inferSelect): string {
  return [
    `عنوان: ${exp.title}`,
    exp.subject ? `موضوع: ${exp.subject}` : "",
    `مسئله (Problem): ${exp.problemDescription}`,
    exp.rootCause ? `علت ریشه‌ای (Root Cause): ${exp.rootCause}` : "",
    `اقدامات انجام‌شده (Actions Taken): ${exp.actionsTaken}`,
    exp.results ? `نتایج (Results): ${exp.results}` : "",
    `درس آموخته (Lesson Learned): ${exp.lessonsLearned}`,
    exp.suggestion ? `پیشنهاد: ${exp.suggestion}` : "",
    exp.tags.length > 0 ? `برچسب‌ها: ${exp.tags.join("، ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function processExperienceJob(jobId: string, experienceId: string): Promise<void> {
  const [exp] = await db.select().from(experiences).where(eq(experiences.id, experienceId)).limit(1);
  if (!exp) throw new Error(`Experience ${experienceId} not found`);

  await updateJobStatus(jobId, "PROCESSING", { progress: 10 });

  const text = buildExperienceText(exp);
  const chunks = chunkPages([{ page: 1, text }]);

  await reindexChunks(
    {
      organizationId: exp.organizationId,
      sourceType: "experience",
      sourceId: exp.id,
      sourceVersion: exp.version,
      sourceTitle: exp.title,
    },
    chunks,
    async (done, total) => {
      const progress = 10 + Math.round((done / total) * 85);
      await updateJobStatus(jobId, "PROCESSING", { progress });
    },
  );

  await updateJobStatus(jobId, "COMPLETED", { progress: 100 });
}
