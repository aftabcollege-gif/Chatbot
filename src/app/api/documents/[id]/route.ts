import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { documents } from "@/db/schema";
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
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) return NextResponse.json({ error: "سند یافت نشد" }, { status: 404 });

  return NextResponse.json({ document: doc });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });

  const { id } = await params;
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  await db.delete(documents).where(eq(documents.id, id));

  if (doc) {
    await logEvent({
      eventCode: "document.delete",
      actorId: user.id,
      resourceType: "document",
      resourceId: doc.id,
      resourceName: doc.title,
      request,
    });
  }

  return NextResponse.json({ success: true });
}
