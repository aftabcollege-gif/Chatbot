import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "change-this-to-random-64-char-string"
);

async function getUserId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get("access_token")?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload.userId as string;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(
        and(eq(conversations.id, id), eq(conversations.userId, userId))
      )
      .limit(1);

    if (!conversation) {
      return NextResponse.json(
        { error: "گفتگو یافت نشد" },
        { status: 404 }
      );
    }

    const conversationMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));

    return NextResponse.json({
      conversation: {
        id: conversation.id,
        title: conversation.title || "گفتگوی جدید",
        isPinned: conversation.isPinned,
        createdAt: conversation.createdAt?.toISOString(),
      },
      messages: conversationMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        confidenceScore: m.confidenceScore,
        createdAt: m.createdAt?.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error fetching conversation:", error);
    return NextResponse.json(
      { error: "خطا در دریافت گفتگو" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await db
      .delete(conversations)
      .where(
        and(eq(conversations.id, id), eq(conversations.userId, userId))
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting conversation:", error);
    return NextResponse.json(
      { error: "خطا در حذف گفتگو" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { title, isPinned } = body;

    const updateData: Partial<typeof conversations.$inferInsert> = {};
    if (title !== undefined) updateData.title = title;
    if (isPinned !== undefined) updateData.isPinned = isPinned;
    updateData.updatedAt = new Date();

    const [updated] = await db
      .update(conversations)
      .set(updateData)
      .where(
        and(eq(conversations.id, id), eq(conversations.userId, userId))
      )
      .returning();

    return NextResponse.json({
      conversation: {
        id: updated.id,
        title: updated.title,
        isPinned: updated.isPinned,
      },
    });
  } catch (error) {
    console.error("Error updating conversation:", error);
    return NextResponse.json(
      { error: "خطا در بروزرسانی گفتگو" },
      { status: 500 }
    );
  }
}
