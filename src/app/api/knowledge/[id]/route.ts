import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { knowledgeItems } from "@/db/schema";
import { eq } from "drizzle-orm";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "change-this-to-random-64-char-string");

async function getUser(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload.userId as string;
  } catch { return null; }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUser(request);
  if (!userId) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });

  const { id } = await params;
  const [item] = await db.select().from(knowledgeItems).where(eq(knowledgeItems.id, id)).limit(1);
  if (!item) return NextResponse.json({ error: "تجربه یافت نشد" }, { status: 404 });

  return NextResponse.json({ item });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUser(request);
  if (!userId) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });

  const { id } = await params;
  await db.delete(knowledgeItems).where(eq(knowledgeItems.id, id));

  return NextResponse.json({ success: true });
}
