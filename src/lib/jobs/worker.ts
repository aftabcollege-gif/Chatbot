import { sql } from "drizzle-orm";
import { db } from "@/db";
import { processingJobs } from "@/db/schema";
import { config } from "@/lib/config";
import { processDocumentJob } from "@/lib/documents/pipeline";
import { processExperienceJob } from "@/lib/experiences/pipeline";
import { processKnowledgeJob } from "@/lib/knowledge/pipeline";
import { updateJobStatus } from "@/lib/jobs/queue";

type Job = typeof processingJobs.$inferSelect;

interface WorkerState {
  started: boolean;
  running: number;
  timer: ReturnType<typeof setInterval> | null;
  wakeRequested: boolean;
}

// Survive Next.js hot reloads / multiple module instances in one process.
const globalForWorker = globalThis as typeof globalThis & { __ingestWorker?: WorkerState };
const state: WorkerState = (globalForWorker.__ingestWorker ??= {
  started: false,
  running: 0,
  timer: null,
  wakeRequested: false,
});

/**
 * Atomically claim the oldest PENDING job.
 *
 * `FOR UPDATE SKIP LOCKED` makes the claim race-free even when several worker
 * slots (or several processes) poll at the same time, and the partial index
 * `processing_jobs_claim_idx (created_at) WHERE status = 'PENDING'` keeps the
 * lookup O(log n) when the table holds hundreds of thousands of finished jobs.
 */
async function claimNextJob(): Promise<Job | null> {
  const result = await db.execute<Job>(sql`
    UPDATE processing_jobs
    SET status = 'PROCESSING', started_at = now()
    WHERE id = (
      SELECT id FROM processing_jobs
      WHERE status = 'PENDING' AND retry_count < max_retries
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING
      id, organization_id AS "organizationId", type, resource_id AS "resourceId", status,
      progress, retry_count AS "retryCount", max_retries AS "maxRetries", error, payload,
      started_at AS "startedAt", completed_at AS "completedAt", created_at AS "createdAt"
  `);
  const rows = (result as unknown as { rows: Job[] }).rows;
  return rows[0] ?? null;
}

async function runJob(job: Job): Promise<void> {
  state.running++;
  const started = Date.now();
  try {
    if (job.type === "document_ingest") {
      await processDocumentJob(job.id, job.resourceId);
    } else if (job.type === "experience_ingest") {
      await processExperienceJob(job.id, job.resourceId);
    } else if (job.type === "knowledge_ingest") {
      await processKnowledgeJob(job.id, job.resourceId);
    } else {
      throw new Error(`Unknown job type: ${job.type}`);
    }
    if (process.env.INGEST_LOG_TIMINGS === "true") {
      console.log(`[jobs] ${job.type} ${job.resourceId} done in ${Date.now() - started}ms`);
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
    state.running--;
  }
}

/**
 * Fill every free worker slot. Runs jobs concurrently up to
 * INGEST_CONCURRENCY; each slot immediately claims the next job when it
 * finishes (no idle poll gap), so a 100k-file backlog drains at full speed.
 */
async function drain(): Promise<void> {
  while (state.started && state.running < config.ingest.concurrency) {
    let job: Job | null;
    try {
      job = await claimNextJob();
    } catch (err) {
      console.error("[jobs] worker claim error", err);
      return;
    }
    if (!job) return;
    void runJob(job).then(() => {
      void drain();
    });
  }
}

export function startJobWorker(): void {
  if (state.started) return;
  state.started = true;
  state.timer = setInterval(() => {
    void drain();
  }, config.ingest.pollIntervalMs);
  // Do not keep the process alive just for the poller (tests / CLI tools).
  state.timer.unref?.();
  console.log(
    "[jobs] background job worker started (concurrency: %d, poll interval: %dms)",
    config.ingest.concurrency,
    config.ingest.pollIntervalMs,
  );
  void drain();
}

/** Stop polling (CLI tools call this before closing the database). */
export function stopJobWorker(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.started = false;
}

/** Ask the worker to look for work right now (called after enqueue). */
export function wakeJobWorker(): void {
  if (!state.started) return;
  if (state.wakeRequested) return;
  state.wakeRequested = true;
  setImmediate(() => {
    state.wakeRequested = false;
    void drain();
  });
}

export function workerStatus(): { running: number; concurrency: number; started: boolean } {
  return { running: state.running, concurrency: config.ingest.concurrency, started: state.started };
}

/**
 * Process exactly one pending job (if any) and return whether one was handled.
 * Used by the internal scheduler endpoint (/api/jobs/process).
 */
export async function processPendingJobOnce(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;
  await runJob(job);
  return true;
}
