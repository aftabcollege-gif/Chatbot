import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { logEvent } from "@/lib/audit";
import { deleteStoredFile } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.DOCUMENT_READ)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  const { id } = await params;
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) return NextResponse.json({ error: "سند یافت نشد" }, { status: 404 });

  // Tenant isolation (directive §22, §24)
  if (doc.organizationId !== user.organizationId && !user.isSuperadmin) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  return NextResponse.json({ document: doc });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.DOCUMENT_DELETE)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  const { id } = await params;
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) return NextResponse.json({ error: "سند یافت نشد" }, { status: 404 });

  // Tenant isolation — never allow cross-tenant delete
  if (doc.organizationId !== user.organizationId && !user.isSuperadmin) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  // Soft-delete: mark as deleted so it immediately disappears from retrieval/RAG
  // (document_chunks are removed via cascade delete below to guarantee it never
  // resurfaces in search/RAG — directive §48).
  await db.delete(documents).where(eq(documents.id, id));
  await deleteStoredFile(doc.storagePath);

  await logEvent({
    eventCode: "DOCUMENT_DELETE",
    actorId: user.id,
    actorName: user.name,
    organizationId: user.organizationId ?? undefined,
    resourceType: "document",
    resourceId: doc.id,
    resourceName: doc.title,
    request,
  });

  return NextResponse.json({ success: true });
}
