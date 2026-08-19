import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { absoluteStoragePath } from "@/lib/documents/storage";
import { extractText } from "@/lib/documents/extract";
import { chunkPages } from "@/lib/documents/chunk";
import { reindexChunks } from "@/lib/rag/ingest";
import { updateJobStatus } from "@/lib/jobs/queue";
import fs from "node:fs/promises";

export async function processDocumentJob(jobId: string, documentId: string): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) throw new Error(`Document ${documentId} not found`);

  await db.update(documents).set({ status: "processing" }).where(eq(documents.id, documentId));
  await updateJobStatus(jobId, "PROCESSING", { progress: 5 });

  const buffer = await fs.readFile(absoluteStoragePath(doc.storagePath));
  const extraction = await extractText(buffer, doc.fileName);
  await updateJobStatus(jobId, "PROCESSING", { progress: 40 });

  const chunks = chunkPages(extraction.pages);
  if (chunks.length === 0) {
    await db
      .update(documents)
      .set({
        status: "failed",
        errorMessage: "هیچ متن قابل استخراجی در سند یافت نشد.",
        ocrUsed: extraction.ocrUsed,
        pageCount: extraction.pageCount,
      })
      .where(eq(documents.id, documentId));
    await updateJobStatus(jobId, "FAILED", { progress: 100, error: "No extractable text found" });
    return;
  }

  await reindexChunks(
    {
      organizationId: doc.organizationId,
      sourceType: "document",
      sourceId: doc.id,
      sourceVersion: doc.currentVersion,
      sourceTitle: doc.title,
    },
    chunks,
    async (done, total) => {
      const progress = 40 + Math.round((done / total) * 55);
      await updateJobStatus(jobId, "PROCESSING", { progress });
    },
  );

  await db
    .update(documents)
    .set({
      status: "completed",
      ocrUsed: extraction.ocrUsed,
      pageCount: extraction.pageCount,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, documentId));

  await updateJobStatus(jobId, "COMPLETED", { progress: 100 });
}
