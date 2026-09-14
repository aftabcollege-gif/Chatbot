import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { processingJobs } from "@/db/schema";
import { getCurrentUser, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { enqueueJob } from "@/lib/jobs/queue";
import { logEvent } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ReindexSchema = z
  .object({
    scope: z.enum(["documents", "experiences", "all"]).optional(),
  })
  .default({});

/**
 * Queue a full-corpus reindex (re-normalize the FTS index + re-embed chunks
 * with the local model). Runs in the background job worker; poll
 * GET /api/jobs/:id for progress.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.DOCUMENT_REINDEX)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }
  if (!user.organizationId) {
    return NextResponse.json({ error: "کاربر به سازمانی تعلق ندارد" }, { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine — defaults to "all"
  }
  const parsed = ReindexSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "درخواست نامعتبر است" }, { status: 400 });
  }
  const scope = parsed.data.scope ?? "all";

  // Refuse to stack reindex jobs on top of each other for the same org.
  const [activeJob] = await db
    .select({ id: processingJobs.id })
    .from(processingJobs)
    .where(
      and(
        eq(processingJobs.organizationId, user.organizationId),
        eq(processingJobs.type, "reindex_all"),
        inArray(processingJobs.status, ["PENDING", "PROCESSING"]),
      ),
    )
    .limit(1);
  if (activeJob) {
    return NextResponse.json(
      { error: "عملیات بازسازی شاخص قبلاً در حال انجام است.", jobId: activeJob.id },
      { status: 409 },
    );
  }

  const jobId = await enqueueJob(user.organizationId, "reindex_all", user.organizationId, { scope });

  await logEvent({
    eventCode: "DOCUMENT_REINDEX",
    actorId: user.id,
    actorName: user.name,
    organizationId: user.organizationId,
    resourceType: "knowledge_index",
    resourceId: jobId,
    request,
    metadata: { scope },
  });

  return NextResponse.json({ jobId, scope });
}
