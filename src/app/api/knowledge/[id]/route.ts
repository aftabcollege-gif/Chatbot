import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { knowledgeItems, knowledgeChunks } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { getCurrentUser, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { logEvent, type AuditEventCode } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.KNOWLEDGE_READ)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  const { id } = await params;
  const [item] = await db
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.id, id), isNull(knowledgeItems.deletedAt)))
    .limit(1);
  if (!item) return NextResponse.json({ error: "دانش یافت نشد" }, { status: 404 });

  if (item.organizationId !== user.organizationId && !user.isSuperadmin) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  return NextResponse.json({ item });
}

// Knowledge workflow per directive §33: DRAFT → UNDER_REVIEW → APPROVED → PUBLISHED → ARCHIVED
const TRANSITIONS: Record<
  string,
  { allowedFrom: string[]; permission: string; eventCode: AuditEventCode }
> = {
  UNDER_REVIEW: { allowedFrom: ["DRAFT"], permission: PERMISSIONS.KNOWLEDGE_UPDATE, eventCode: "KNOWLEDGE_SUBMIT" },
  APPROVED: { allowedFrom: ["UNDER_REVIEW"], permission: PERMISSIONS.KNOWLEDGE_APPROVE, eventCode: "KNOWLEDGE_APPROVE" },
  PUBLISHED: { allowedFrom: ["APPROVED"], permission: PERMISSIONS.KNOWLEDGE_PUBLISH, eventCode: "KNOWLEDGE_PUBLISH" },
  DRAFT: { allowedFrom: ["UNDER_REVIEW", "APPROVED"], permission: PERMISSIONS.KNOWLEDGE_REVIEW, eventCode: "KNOWLEDGE_REJECT" },
  ARCHIVED: { allowedFrom: ["PUBLISHED", "APPROVED", "DRAFT", "UNDER_REVIEW"], permission: PERMISSIONS.KNOWLEDGE_UPDATE, eventCode: "KNOWLEDGE_ARCHIVE" },
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });

  const { id } = await params;
  const [item] = await db
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.id, id), isNull(knowledgeItems.deletedAt)))
    .limit(1);
  if (!item) return NextResponse.json({ error: "دانش یافت نشد" }, { status: 404 });

  if (item.organizationId !== user.organizationId && !user.isSuperadmin) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { status, visibility } = body as { status?: string; visibility?: string };

  const update: Partial<typeof knowledgeItems.$inferInsert> = { updatedAt: new Date() };

  if (status) {
    const transition = TRANSITIONS[status];
    if (!transition || !transition.allowedFrom.includes(item.status ?? "DRAFT")) {
      return NextResponse.json({ error: "تغییر وضعیت مجاز نیست" }, { status: 400 });
    }
    if (!hasPermission(user, transition.permission)) {
      return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
    }

    update.status = status;
    if (status === "UNDER_REVIEW") {
      update.reviewedBy = null;
      update.reviewedAt = null;
    }
    if (status === "APPROVED") {
      update.reviewedBy = user.id;
      update.reviewedAt = new Date();
      update.approvedBy = user.id;
      update.approvedAt = new Date();
    }
    if (status === "PUBLISHED") {
      update.publishedAt = new Date();
      update.publishedBy = user.id;
    }
    if (status === "ARCHIVED") {
      update.archivedAt = new Date();
      // Archived knowledge must disappear from retrieval/RAG immediately (directive §32/§48)
      // Remove any indexed chunks for this knowledge item from retrieval.
      await db
        .delete(knowledgeChunks)
        .where(and(eq(knowledgeChunks.sourceId, id), eq(knowledgeChunks.sourceType, "knowledge")));
    }
  }

  if (visibility) {
    if (!hasPermission(user, PERMISSIONS.KNOWLEDGE_UPDATE)) {
      return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
    }
    update.visibility = visibility;
  }

  const [updated] = await db.update(knowledgeItems).set(update).where(eq(knowledgeItems.id, id)).returning();

  if (status) {
    const transition = TRANSITIONS[status];
    await logEvent({
      eventCode: transition.eventCode,
      actorId: user.id,
      actorName: user.name,
      organizationId: user.organizationId ?? undefined,
      resourceType: "knowledge",
      resourceId: id,
      resourceName: updated?.title,
      metadata: { previousStatus: item.status, newStatus: status },
    });
  }

  return NextResponse.json({ item: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.KNOWLEDGE_DELETE)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  const { id } = await params;
  const [item] = await db.select().from(knowledgeItems).where(eq(knowledgeItems.id, id)).limit(1);
  if (!item) return NextResponse.json({ error: "دانش یافت نشد" }, { status: 404 });

  if (item.organizationId !== user.organizationId && !user.isSuperadmin) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  // Soft delete + immediate retrieval removal
  await db.update(knowledgeItems).set({ deletedAt: new Date() }).where(eq(knowledgeItems.id, id));
  await db
    .delete(knowledgeChunks)
    .where(and(eq(knowledgeChunks.sourceId, id), eq(knowledgeChunks.sourceType, "knowledge")));

  await logEvent({
    eventCode: "KNOWLEDGE_DELETE",
    actorId: user.id,
    actorName: user.name,
    organizationId: user.organizationId ?? undefined,
    resourceType: "knowledge",
    resourceId: id,
    resourceName: item.title,
  });

  return NextResponse.json({ success: true });
}
