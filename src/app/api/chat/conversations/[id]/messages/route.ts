import { NextRequest, NextResponse } from "next/server";
import { eq, and, asc } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, messageSources } from "@/db/schema";
import { getCurrentUser, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { answerWithRag } from "@/lib/rag";
import { logEvent } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const MessageSchema = z.object({
  content: z.string().min(1).max(5000),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.CHAT_USE)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  // Verify conversation ownership (tenant isolation)
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, id),
        eq(conversations.userId, user.id)
      )
    )
    .limit(1);

  if (!conversation) {
    return NextResponse.json({ error: "گفتگو یافت نشد" }, { status: 404 });
  }

  const conversationMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));

  return NextResponse.json(conversationMessages);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.CHAT_USE)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }
  if (!user.organizationId) {
    return NextResponse.json({ error: "کاربر به سازمانی تعلق ندارد" }, { status: 400 });
  }

  // Verify conversation ownership
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, id),
        eq(conversations.userId, user.id)
      )
    )
    .limit(1);

  if (!conversation) {
    return NextResponse.json({ error: "گفتگو یافت نشد" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "درخواست نامعتبر" }, { status: 400 });
  }

  const parsed = MessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "پیام نامعتبر است" }, { status: 400 });
  }

  const { content } = parsed.data;

  // Save user message
  const [userMessage] = await db
    .insert(messages)
    .values({
      conversationId: id,
      role: "user",
      content,
    })
    .returning();

  // Update conversation title if first message
  if ((conversation.messageCount ?? 0) === 0) {
    await db
      .update(conversations)
      .set({
        title: content.slice(0, 100),
        messageCount: 1,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, id));
  } else {
    await db
      .update(conversations)
      .set({
        messageCount: (conversation.messageCount ?? 0) + 2,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, id));
  }

  // RAG pipeline
  const ragResult = await answerWithRag(
    content,
    user.organizationId,
    user.departmentId,
    user.id
  );

  // Save assistant message
  const [assistantMessage] = await db
    .insert(messages)
    .values({
      conversationId: id,
      role: "assistant",
      content: ragResult.answer,
      confidenceScore: ragResult.confidence,
      responseTimeMs: ragResult.ragTrace.responseTimeMs,
      ragTrace: ragResult.ragTrace,
    })
    .returning();

  // Save citations (from retrieval, NOT from LLM)
  if (ragResult.sources.length > 0) {
    const sourceValues = ragResult.sources.map((source, index) => ({
      messageId: assistantMessage.id,
      sourceType: source.sourceType,
      sourceId: source.documentId ?? source.experienceId ?? source.id,
      chunkId: source.sourceType === "document" ? source.id : null,
      pageNumber: source.pageNumber,
      section: source.section,
      heading: source.heading,
      relevanceScore: source.relevanceScore,
      citationIndex: index + 1,
      excerpt: source.excerpt ?? source.content.slice(0, 200),
    }));

    await db.insert(messageSources).values(sourceValues);
  }

  // Audit
  await logEvent({
    eventCode: "CHAT_MESSAGE",
    actorId: user.id,
    actorName: user.name,
    organizationId: user.organizationId,
    resourceType: "conversation",
    resourceId: id,
    outcome: "SUCCESS",
    metadata: {
      questionLength: content.length,
      sourcesCount: ragResult.sources.length,
      confidence: ragResult.confidence,
      usedLLM: ragResult.usedLLM,
    },
  });

  return NextResponse.json({
    userMessage,
    assistantMessage,
    sources: ragResult.sources,
    confidence: ragResult.confidence,
    ragTrace: hasPermission(user, PERMISSIONS.CHAT_VIEW_TRACE) ? ragResult.ragTrace : undefined,
  });
}
