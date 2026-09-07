import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/db";
import { experiences, experienceTags, knowledgeChunks } from "@/db/schema";
import { getCurrentUser, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { logEvent } from "@/lib/audit";
import { enqueueJob } from "@/lib/jobs/queue";
import { z } from "zod";

export const dynamic = "force-dynamic";

const StatusUpdateSchema = z.object({
  action: z.enum(["submit", "approve", "reject", "publish", "archive"]),
  notes: z.string().max(1000).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.EXPERIENCE_READ)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  const [experience] = await db
    .select()
    .from(experiences)
    .where(and(eq(experiences.id, id), isNull(experiences.deletedAt)))
    .limit(1);

  if (!experience) {
    return NextResponse.json({ error: "تجربه یافت نشد" }, { status: 404 });
  }

  // Tenant isolation
  if (experience.organizationId !== user.organizationId && !user.isSuperadmin) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  const tags = await db
    .select()
    .from(experienceTags)
    .where(eq(experienceTags.experienceId, id));

  return NextResponse.json({ ...experience, tags: tags.map((t) => t.tag) });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });

  const [experience] = await db
    .select()
    .from(experiences)
    .where(and(eq(experiences.id, id), isNull(experiences.deletedAt)))
    .limit(1);

  if (!experience) return NextResponse.json({ error: "تجربه یافت نشد" }, { status: 404 });
  if (experience.organizationId !== user.organizationId && !user.isSuperadmin) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "درخواست نامعتبر" }, { status: 400 });
  }

  const parsed = StatusUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "درخواست نامعتبر" }, { status: 400 });
  }

  const { action, notes } = parsed.data;

  let newStatus: string;
  let eventCode: "EXPERIENCE_SUBMIT" | "EXPERIENCE_APPROVE" | "EXPERIENCE_REJECT" | "EXPERIENCE_PUBLISH" | "EXPERIENCE_ARCHIVE";
  let requiredPermission: string;

  switch (action) {
    case "submit":
      newStatus = "SUBMITTED";
      eventCode = "EXPERIENCE_SUBMIT";
      requiredPermission = PERMISSIONS.EXPERIENCE_SUBMIT;
      break;
    case "approve":
      newStatus = "APPROVED";
      eventCode = "EXPERIENCE_APPROVE";
      requiredPermission = PERMISSIONS.EXPERIENCE_APPROVE;
      break;
    case "reject":
      newStatus = "CHANGES_REQUESTED";
      eventCode = "EXPERIENCE_REJECT";
      requiredPermission = PERMISSIONS.EXPERIENCE_REVIEW;
      break;
    case "publish":
      newStatus = "PUBLISHED";
      eventCode = "EXPERIENCE_PUBLISH";
      requiredPermission = PERMISSIONS.EXPERIENCE_PUBLISH;
      break;
    case "archive":
      newStatus = "ARCHIVED";
      eventCode = "EXPERIENCE_ARCHIVE";
      requiredPermission = PERMISSIONS.EXPERIENCE_UPDATE;
      break;
  }

  if (!hasPermission(user, requiredPermission)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  const updateData: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
  };

  if (action === "submit") {
    updateData.submittedAt = new Date();
    updateData.submittedBy = user.id;
  } else if (action === "approve") {
    updateData.approvedAt = new Date();
    updateData.approvedBy = user.id;
    updateData.reviewNotes = notes;
  } else if (action === "reject") {
    updateData.reviewedAt = new Date();
    updateData.reviewedBy = user.id;
    updateData.reviewNotes = notes;
  } else if (action === "publish") {
    updateData.publishedAt = new Date();
    updateData.publishedBy = user.id;
  } else if (action === "archive") {
    updateData.archivedAt = new Date();
  }

  const [updated] = await db
    .update(experiences)
    .set(updateData as Partial<typeof experiences.$inferInsert>)
    .where(eq(experiences.id, id))
    .returning();

  if (action === "publish") {
    // DIRECTIVE §32: when PUBLISHED, integrate into the RAG index. Chunking +
    // embedding run on the background worker (src/lib/experiences/pipeline.ts)
    // so publishing returns immediately even with a slow local model.
    await enqueueJob(experience.organizationId, "experience_ingest", experience.id, { title: experience.title });
  } else {
    // Any other transition leaves PUBLISHED: the retrieval predicate already
    // hides the experience (directive §32/§48); drop its chunks as well so
    // they stop occupying the vector/keyword indexes.
    await db
      .delete(knowledgeChunks)
      .where(and(eq(knowledgeChunks.sourceType, "experience"), eq(knowledgeChunks.sourceId, id)));
  }

  await logEvent({
    eventCode,
    actorId: user.id,
    actorName: user.name,
    organizationId: user.organizationId ?? undefined,
    resourceType: "experience",
    resourceId: id,
    resourceName: experience.title,
    outcome: "SUCCESS",
    metadata: { previousStatus: experience.status, newStatus, notes },
  });

  return NextResponse.json(updated);
}
