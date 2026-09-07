import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { processingJobs, type JobStatus } from "@/db/schema";

export type JobType = "document_ingest" | "experience_ingest" | "knowledge_ingest";

/**
 * Wake the in-process worker without a static import cycle
 * (worker → pipeline → queue). Resolved lazily and only in the Node runtime.
 */
async function wakeWorker(): Promise<void> {
  try {
    const { wakeJobWorker } = await import("@/lib/jobs/worker");
    wakeJobWorker();
  } catch {
    /* worker not available in this runtime (edge / build) */
  }
}

export async function enqueueJob(
  organizationId: string,
  type: JobType,
  resourceId: string,
  payload: Record<string, unknown> = {},
): Promise<string> {
  const [job] = await db
    .insert(processingJobs)
    .values({ organizationId, type, resourceId, payload, status: "PENDING" })
    .returning();
  void wakeWorker();
  return job.id;
}

/** Bulk enqueue (used by the folder importer) — one INSERT per 500 jobs. */
export async function enqueueJobs(
  organizationId: string,
  type: JobType,
  resourceIds: string[],
  payload: Record<string, unknown> = {},
): Promise<number> {
  const BATCH = 500;
  let count = 0;
  for (let i = 0; i < resourceIds.length; i += BATCH) {
    const slice = resourceIds.slice(i, i + BATCH);
    await db
      .insert(processingJobs)
      .values(slice.map((resourceId) => ({ organizationId, type, resourceId, payload, status: "PENDING" as const })));
    count += slice.length;
  }
  if (count > 0) void wakeWorker();
  return count;
}

export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  patch: Partial<{ progress: number; error: string | null; retryCount: number }> = {},
): Promise<void> {
  const values: Record<string, unknown> = { status, ...patch };
  if (status === "PROCESSING") values.startedAt = new Date();
  if (status === "COMPLETED" || status === "FAILED") values.completedAt = new Date();
  await db.update(processingJobs).set(values).where(eq(processingJobs.id, jobId));
}

export async function getJob(jobId: string) {
  const [job] = await db.select().from(processingJobs).where(eq(processingJobs.id, jobId)).limit(1);
  return job ?? null;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  oldestPendingAgeSeconds: number | null;
}

export async function getQueueStats(organizationId?: string): Promise<QueueStats> {
  const orgFilter = organizationId ? sql`WHERE organization_id = ${organizationId}` : sql``;
  const result = await db.execute<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    oldest_pending_age: number | null;
  }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'PROCESSING')::int AS processing,
      COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
      COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
      EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status = 'PENDING')))::int AS oldest_pending_age
    FROM processing_jobs ${orgFilter}
  `);
  const row = (result as unknown as { rows: Array<Record<string, number | null>> }).rows[0] ?? {};
  return {
    pending: Number(row.pending ?? 0),
    processing: Number(row.processing ?? 0),
    completed: Number(row.completed ?? 0),
    failed: Number(row.failed ?? 0),
    oldestPendingAgeSeconds: row.oldest_pending_age === null || row.oldest_pending_age === undefined ? null : Number(row.oldest_pending_age),
  };
}
