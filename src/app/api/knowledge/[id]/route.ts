import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { knowledgeItems } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth-server";
import { logEvent } from "@/lib/audit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });

  const { id } = await params;
  const [item] = await db.select().from(knowledgeItems).where(eq(knowledgeItems.id, id)).limit(1);
  if (!item) return NextResponse.json({ error: "تجربه یافت نشد" }, { status: 404 });

  return NextResponse.json({ item });
}

const TRANSITIONS: Record<string, { allowedFrom: string[]; requiresAdmin: boolean }> = {
  PENDING: { allowedFrom: ["DRAFT"], requiresAdmin: false },
  APPROVED: { allowedFrom: ["PENDING", "DRAFT"], requiresAdmin: true },
  PUBLISHED: { allowedFrom: ["APPROVED"], requiresAdmin: true },
  DRAFT: { allowedFrom: ["PENDING", "APPROVED", "PUBLISHED"], requiresAdmin: true },
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });

  const { id } = await params;
  const [item] = await db.select().from(knowledgeItems).where(eq(knowledgeItems.id, id)).limit(1);
  if (!item) return NextResponse.json({ error: "تجربه یافت نشد" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { status, visibility } = body as { status?: string; visibility?: string };

  const update: Partial<typeof knowledgeItems.$inferInsert> = { updatedAt: new Date() };

  if (status) {
    const transition = TRANSITIONS[status];
    if (!transition || !transition.allowedFrom.includes(item.status || "DRAFT")) {
      return NextResponse.json({ error: "تغییر وضعیت مجاز نیست" }, { status: 400 });
    }
    if (transition.requiresAdmin && !user.isAdmin) {
      return NextResponse.json({ error: "فقط مدیر سیستم می‌تواند این وضعیت را تغییر دهد" }, { status: 403 });
    }
    update.status = status;
    if (status === "APPROVED") {
      update.reviewedBy = user.id;
      update.reviewedAt = new Date();
      update.approvedBy = user.id;
      update.approvedAt = new Date();
    }
    if (status === "PUBLISHED") {
      update.publishedAt = new Date();
    }
  }

  if (visibility) {
    update.visibility = visibility;
  }

  const [updated] = await db.update(knowledgeItems).set(update).where(eq(knowledgeItems.id, id)).returning();

  if (status) {
    await logEvent({
      eventCode: "knowledge.status_change",
      actorId: user.id,
      resourceType: "knowledge",
      resourceId: id,
      resourceName: updated?.title,
      metadata: { status },
      request,
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

  const { id } = await params;
  await db.delete(knowledgeItems).where(eq(knowledgeItems.id, id));

  return NextResponse.json({ success: true });
}
