import { and, asc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { processingJobs } from "@/db/schema";
import { processDocumentJob } from "@/lib/documents/pipeline";
import { processExperienceJob } from "@/lib/experiences/pipeline";
import { updateJobStatus } from "@/lib/jobs/queue";

const POLL_INTERVAL_MS = 2000;
const MAX_CONCURRENT = 1; // CPU-bound local inference: keep sequential to protect RAM/CPU budget.

let started = false;
let running = 0;

async function claimNextJob() {
  const [job] = await db
    .select()
    .from(processingJobs)
    .where(and(eq(processingJobs.status, "PENDING"), lt(processingJobs.retryCount, processingJobs.maxRetries)))
    .orderBy(asc(processingJobs.createdAt))
    .limit(1);
  if (!job) return null;

  // Optimistic claim: mark as PROCESSING immediately to avoid double-pickup
  // across multiple worker ticks.
  const claimed = await db
    .update(processingJobs)
    .set({ status: "PROCESSING", startedAt: new Date() })
    .where(and(eq(processingJobs.id, job.id), eq(processingJobs.status, "PENDING")))
    .returning();

  return claimed[0] ?? null;
}

async function runJob(job: typeof processingJobs.$inferSelect): Promise<void> {
  running++;
  try {
    if (job.type === "document_ingest") {
      await processDocumentJob(job.id, job.resourceId);
    } else if (job.type === "experience_ingest") {
      await processExperienceJob(job.id, job.resourceId);
    } else {
      throw new Error(`Unknown job type: ${job.type}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const nextRetry = job.retryCount + 1;
    const willRetry = nextRetry < job.maxRetries;
    await updateJobStatus(job.id, willRetry ? "PENDING" : "FAILED", {
      error: message,
      retryCount: nextRetry,
    });
    console.error(`[jobs] job ${job.id} (${job.type}) failed:`, message);
  } finally {
    running--;
  }
}

async function tick(): Promise<void> {
  if (running >= MAX_CONCURRENT) return;
  try {
    const job = await claimNextJob();
    if (job) await runJob(job);
  } catch (err) {
    console.error("[jobs] worker tick error", err);
  }
}

export function startJobWorker(): void {
  if (started) return;
  started = true;
  setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  console.log("[jobs] background job worker started (poll interval: %dms)", POLL_INTERVAL_MS);
}

/**
 * Process exactly one pending job (if any) and return whether one was handled.
 * Used by the internal scheduler endpoint (/api/jobs/process) and by the
 * long-lived worker loop above.
 */
export async function processPendingJobOnce(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;
  await runJob(job);
  return true;
}
