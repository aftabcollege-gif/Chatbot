import { eq } from "drizzle-orm";
import { db } from "@/db";
import { processingJobs, type JobStatus } from "@/db/schema";

export type JobType = "document_ingest" | "experience_ingest";

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
  return job.id;
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
