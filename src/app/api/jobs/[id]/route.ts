import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/auth-server";
import { getJob } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

/**
 * Job status for the current user's organization (tenant-isolated).
 * Used by the UI to poll background jobs (document ingest, reindex, ...).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser(_request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });

  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "وظیفه یافت نشد" }, { status: 404 });

  // Tenant isolation: only the owning organization (or a superadmin) may read.
  if (job.organizationId !== user.organizationId && !user.isSuperadmin) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  let result: unknown = null;
  if (job.result) {
    try {
      result = JSON.parse(job.result);
    } catch {
      result = job.result;
    }
  }

  return NextResponse.json({
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    error: job.error,
    result,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  });
}
