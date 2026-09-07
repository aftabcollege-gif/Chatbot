import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

const HISTORY_PAGE_SIZE = 200;

// Session-aware (honours revocation / deactivation) and cached — see auth-server.
const getUserId = getUserIdFromRequest;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });

  const { id } = await params;

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1);

  if (!conversation) {
    return NextResponse.json({ error: "گفتگو یافت نشد" }, { status: 404 });
  }

  // Newest HISTORY_PAGE_SIZE messages, returned in chronological order.
  const recent = db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(sql`${messages.createdAt} DESC`)
    .limit(HISTORY_PAGE_SIZE)
    .as("recent");
  const msgs = await db.select().from(recent).orderBy(asc(recent.createdAt));

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      title: conversation.title || "گفتگوی جدید",
      isPinned: conversation.isPinned,
    },
    messages: msgs.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      confidenceScore: m.confidenceScore,
      createdAt: m.createdAt?.toISOString(),
      // Citations are stored with the assistant turn so history can show them
      // without a second query per message.
      sources: (m.citations ?? []).map((c, index) => ({
        id: c.chunkId,
        type: c.sourceType,
        title: c.sourceTitle,
        pageNumber: c.page ?? undefined,
        section: c.section ?? undefined,
        relevanceScore: c.relevanceScore,
        citationIndex: index + 1,
      })),
    })),
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });

  const { id } = await params;

  // Soft delete: the list endpoint filters on deleted_at, and message history
  // stays available for audit until a retention job removes it.
  await db
    .update(conversations)
    .set({ isDeleted: true, deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));

  return NextResponse.json({ success: true });
}
