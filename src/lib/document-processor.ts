/**
 * Document Processing Service
 *
 * Pipeline: Upload → Validate → Hash → Store → Queue → Extract → OCR →
 *           Normalize → Structure → Chunk → Embed → Index → READY
 *
 * This is called by the background job system.
 * Each step updates document status and progress in the database.
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import {
  documents,
  documentChunks,
  processingJobs,
  type Document,
} from "@/db/schema";
import { extractText } from "@/lib/extract-text";
import { chunkText } from "@/lib/chunking";
import { getEmbeddings } from "@/lib/ai/orchestrator";
import { readStoredFile } from "@/lib/storage";
import { normalizePersian } from "@/lib/utils";

const BATCH_SIZE = 10; // Number of chunks to embed at once

/** Update document status and progress */
async function updateDocumentStatus(
  docId: string,
  status: string,
  progress: number,
  error?: string
): Promise<void> {
  await db
    .update(documents)
    .set({
      status,
      processingProgress: progress,
      processingError: error ?? null,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, docId));
}

/** Update job status */
async function updateJobStatus(
  jobId: string,
  status: string,
  progress: number,
  error?: string
): Promise<void> {
  await db
    .update(processingJobs)
    .set({
      status,
      progress,
      errorMessage: error ?? null,
      ...(status === "RUNNING" ? { startedAt: new Date() } : {}),
      ...(["DONE", "FAILED", "CANCELLED"].includes(status) ? { completedAt: new Date() } : {}),
    })
    .where(eq(processingJobs.id, jobId));
}

/**
 * Main document processing function.
 * Call this from the job worker — NOT from request handlers.
 */
export async function processDocument(
  document: Document,
  jobId: string
): Promise<void> {
  const { id: docId, storagePath, mimeType, originalFilename, organizationId, departmentId } = document;

  try {
    // Step 1: Mark as PROCESSING
    await updateDocumentStatus(docId, "PROCESSING", 5);
    await updateJobStatus(jobId, "RUNNING", 5);

    // Step 2: Read file from storage
    const buffer = await readStoredFile(storagePath);

    // Step 3: Extract text
    await updateDocumentStatus(docId, "PROCESSING", 20);
    const parseResult = await extractText(buffer, originalFilename, mimeType ?? undefined);

    if (!parseResult.text || parseResult.text.trim().length < 10) {
      throw new Error("متن قابل استخراج از فایل یافت نشد.");
    }

    // Step 4: If image/scanned PDF, log OCR usage
    if (parseResult.hasOCR) {
      await updateDocumentStatus(docId, "OCR", 30);
      await updateJobStatus(jobId, "RUNNING", 30);
    }

    // Step 5: Normalize Persian text
    await updateDocumentStatus(docId, "CHUNKING", 40);
    await updateJobStatus(jobId, "RUNNING", 40);

    // Step 6: Chunk the text
    const chunks = chunkText(parseResult.text, {
      pageNumber: undefined,
    });

    if (!chunks.length) {
      throw new Error("متن قابل تقسیم‌بندی یافت نشد.");
    }

    // Step 7: Delete existing chunks (for re-processing / re-index)
    await db
      .delete(documentChunks)
      .where(eq(documentChunks.documentId, docId));

    // Step 8: Embed chunks in batches
    await updateDocumentStatus(docId, "EMBEDDING", 50);
    await updateJobStatus(jobId, "RUNNING", 50);

    const allChunkValues = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const batchTexts = batch.map((c) => c.content);

      let embeddings: number[][];
      try {
        embeddings = await getEmbeddings(batchTexts);
      } catch (embedErr) {
        console.error("[DocProcessor] Embedding batch failed:", embedErr);
        // Use zero vectors as placeholder — chunk will have no semantic similarity
        embeddings = batch.map(() => new Array(parseInt(process.env.EMBEDDING_DIMENSIONS ?? "768")).fill(0));
      }

      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        allChunkValues.push({
          documentId: docId,
          organizationId,
          departmentId: departmentId ?? null,
          chunkIndex: i + j,
          content: chunk.content,
          contentNormalized: chunk.contentNormalized,
          embedding: embeddings[j],
          pageNumber: chunk.pageNumber ?? null,
          section: chunk.section ?? null,
          heading: chunk.heading ?? null,
          sourceType: "document",
          language: parseResult.language ?? "fa",
          tokenCount: chunk.tokenCount,
          status: "ACTIVE",
          metadata: {},
        });
      }

      const progress = 50 + Math.floor((i / chunks.length) * 40);
      await updateJobStatus(jobId, "RUNNING", progress);
    }

    // Step 9: Batch insert chunks
    await updateDocumentStatus(docId, "INDEXING", 90);
    await updateJobStatus(jobId, "RUNNING", 90);

    if (allChunkValues.length > 0) {
      // Insert in batches of 100 to avoid parameter limits
      for (let i = 0; i < allChunkValues.length; i += 100) {
        await db.insert(documentChunks).values(allChunkValues.slice(i, i + 100));
      }
    }

    // Step 10: Mark document as READY
    await db.update(documents).set({
      status: "READY",
      processingProgress: 100,
      processingError: null,
      pageCount: parseResult.pageCount ?? null,
      chunkCount: allChunkValues.length,
      updatedAt: new Date(),
    }).where(eq(documents.id, docId));

    await updateJobStatus(jobId, "DONE", 100);

    console.log(`[DocProcessor] Document ${docId} processed: ${allChunkValues.length} chunks`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[DocProcessor] Failed to process document ${docId}:`, error);

    await updateDocumentStatus(docId, "FAILED", 0, errorMsg);
    await updateJobStatus(jobId, "FAILED", 0, errorMsg);
  }
}

/**
 * Queue a document for processing
 */
export async function queueDocumentProcessing(
  documentId: string,
  organizationId: string
): Promise<string> {
  const [job] = await db
    .insert(processingJobs)
    .values({
      organizationId,
      type: "DOCUMENT_PROCESS",
      status: "PENDING",
      resourceType: "document",
      resourceId: documentId,
      priority: 5,
      payload: { documentId },
    })
    .returning({ id: processingJobs.id });

  // Update document status to queued
  await db
    .update(documents)
    .set({ status: "QUEUED", updatedAt: new Date() })
    .where(eq(documents.id, documentId));

  return job.id;
}

/**
 * Process a queued job (called by job runner)
 * Returns true if job was processed, false if nothing to process
 */
export async function processNextJob(): Promise<boolean> {
  // Get next pending job
  const [job] = await db
    .select()
    .from(processingJobs)
    .where(
      and(
        eq(processingJobs.status, "PENDING"),
        eq(processingJobs.type, "DOCUMENT_PROCESS")
      )
    )
    .orderBy(processingJobs.scheduledAt)
    .limit(1);

  if (!job) return false;

  // Claim the job (mark as RUNNING)
  const updated = await db
    .update(processingJobs)
    .set({ status: "RUNNING", startedAt: new Date(), attempts: (job.attempts ?? 0) + 1 })
    .where(
      and(
        eq(processingJobs.id, job.id),
        eq(processingJobs.status, "PENDING")
      )
    )
    .returning();

  if (!updated.length) return false; // Another worker claimed it

  const documentId = (job.payload as Record<string, string>).documentId;

  // Fetch document
  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!document) {
    await updateJobStatus(job.id, "FAILED", 0, "Document not found");
    return false;
  }

  await processDocument(document, job.id);
  return true;
}
