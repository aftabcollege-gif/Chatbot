import { NextRequest, NextResponse } from "next/server";
import { eq, and, asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, messageSources } from "@/db/schema";
import { getCurrentUser, hasPermission, type CurrentUser } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { answerWithRag, type RAGResult, type RagSource } from "@/lib/rag";
import { logEvent } from "@/lib/audit";
import { checkRateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const MessageSchema = z.object({
  content: z.string().min(1).max(5000),
  /** Ignored by the server (kept for client compatibility). */
  scope: z.string().max(50).optional(),
});

const HISTORY_PAGE_SIZE = 200;

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
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, user.id)))
    .limit(1);

  if (!conversation) {
    return NextResponse.json({ error: "گفتگو یافت نشد" }, { status: 404 });
  }

  // Newest HISTORY_PAGE_SIZE messages (in chronological order). Long-running
  // conversations no longer ship their whole history on every open.
  const url = new URL(request.url);
  const limit = Math.min(HISTORY_PAGE_SIZE, Math.max(1, parseInt(url.searchParams.get("limit") ?? "", 10) || HISTORY_PAGE_SIZE));
  const newestFirst = db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(sql`${messages.createdAt} DESC`)
    .limit(limit)
    .as("recent");
  const conversationMessages = await db.select().from(newestFirst).orderBy(asc(newestFirst.createdAt));

  return NextResponse.json(conversationMessages);
}

/** Persist the assistant turn + citations; returns the stored message. */
async function persistAssistantTurn(
  conversationId: string,
  organizationId: string,
  ragResult: RAGResult,
) {
  const [assistantMessage] = await db
    .insert(messages)
    .values({
      conversationId,
      organizationId,
      role: "assistant",
      content: ragResult.answer,
      confidenceScore: ragResult.confidence,
      responseTimeMs: ragResult.ragTrace.responseTimeMs,
      latencyMs: ragResult.ragTrace.responseTimeMs,
      retrievalScore: ragResult.sources[0]?.relevanceScore ?? null,
      grounded: ragResult.sources.length > 0,
      ragTrace: ragResult.ragTrace,
      citations: ragResult.sources.map((source) => ({
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceTitle: source.sourceTitle,
        page: source.pageNumber,
        section: source.section,
        chunkId: source.id,
        relevanceScore: source.relevanceScore,
      })),
    })
    .returning();

  // Save citations (from retrieval, NOT from LLM)
  if (ragResult.sources.length > 0) {
    await db.insert(messageSources).values(
      ragResult.sources.map((source, index) => ({
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
      })),
    );
  }

  return assistantMessage;
}

function toClientSource(source: RagSource) {
  return {
    id: source.id,
    sourceId: source.sourceId,
    documentId: source.documentId,
    experienceId: source.experienceId,
    sourceType: source.sourceType,
    title: source.sourceTitle,
    sourceTitle: source.sourceTitle,
    pageNumber: source.pageNumber,
    section: source.section,
    heading: source.heading,
    relevanceScore: source.relevanceScore,
    excerpt: source.excerpt ?? source.content.slice(0, 300),
  };
}

async function auditChatMessage(user: CurrentUser, conversationId: string, content: string, ragResult: RAGResult) {
  await logEvent({
    eventCode: "CHAT_MESSAGE",
    actorId: user.id,
    actorName: user.name,
    organizationId: user.organizationId ?? undefined,
    resourceType: "conversation",
    resourceId: conversationId,
    outcome: "SUCCESS",
    metadata: {
      questionLength: content.length,
      sourcesCount: ragResult.sources.length,
      confidence: ragResult.confidence,
      usedLLM: ragResult.usedLLM,
      responseTimeMs: ragResult.ragTrace.responseTimeMs,
    },
  });
}

/**
 * POST /api/chat/conversations/:id/messages
 *
 * Default: JSON response `{ userMessage, assistantMessage, sources, ... }`.
 *
 * With `Accept: application/x-ndjson` (or `?stream=1`) the answer is streamed
 * as newline-delimited JSON events so the UI can show sources as soon as
 * retrieval finishes (~50 ms) and tokens as the local model produces them,
 * instead of waiting for the whole generation:
 *
 *   {"type":"user","message":{...}}
 *   {"type":"sources","sources":[...]}
 *   {"type":"token","text":"..."}            (0..n)
 *   {"type":"done","assistantMessage":{...},"sources":[...],"confidence":0.42,"ragTrace"?:{...}}
 *   {"type":"error","error":"..."}           (instead of done)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.CHAT_USE)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }
  if (!user.organizationId) {
    return NextResponse.json({ error: "کاربر به سازمانی تعلق ندارد" }, { status: 400 });
  }
  const organizationId = user.organizationId;

  // Per-user chat rate limit: one CPU-bound generation at a time per process
  // means a single flood could stall everyone else.
  const rate = await checkRateLimit(user.id, "chat");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "تعداد پیام‌های ارسالی بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds("chat", rate)) } },
    );
  }

  // Verify conversation ownership
  const [conversation] = await db
    .select({ id: conversations.id, messageCount: conversations.messageCount, title: conversations.title })
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, user.id)))
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
  const url = new URL(request.url);
  const wantsStream =
    url.searchParams.get("stream") === "1" ||
    (request.headers.get("accept") ?? "").includes("application/x-ndjson");

  // Save user message
  const [userMessage] = await db
    .insert(messages)
    .values({
      conversationId: id,
      organizationId,
      role: "user",
      content,
    })
    .returning();

  // Title from the first question; message count covers both turns.
  const isFirstMessage = (conversation.messageCount ?? 0) === 0;
  await db
    .update(conversations)
    .set({
      ...(isFirstMessage ? { title: content.slice(0, 100) } : {}),
      messageCount: sql`${conversations.messageCount} + 2`,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, id));

  const canSeeTrace = hasPermission(user, PERMISSIONS.CHAT_VIEW_TRACE);

  if (!wantsStream) {
    const ragResult = await answerWithRag(content, organizationId, user.departmentId, user.id);
    const assistantMessage = await persistAssistantTurn(id, organizationId, ragResult);
    await auditChatMessage(user, id, content, ragResult);

    return NextResponse.json({
      userMessage,
      assistantMessage,
      sources: ragResult.sources.map(toClientSource),
      confidence: ragResult.confidence,
      usedLLM: ragResult.usedLLM,
      ragTrace: canSeeTrace ? ragResult.ragTrace : undefined,
    });
  }

  // Streaming path
  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          /* client went away */
        }
      };
      send({ type: "user", message: userMessage });
      try {
        const ragResult = await answerWithRag(content, organizationId, user.departmentId, user.id, {
          onSources: (sources) => send({ type: "sources", sources: sources.map(toClientSource) }),
          onToken: (text) => send({ type: "token", text }),
          signal: abort.signal,
        });
        const assistantMessage = await persistAssistantTurn(id, organizationId, ragResult);
        await auditChatMessage(user, id, content, ragResult);
        send({
          type: "done",
          assistantMessage,
          sources: ragResult.sources.map(toClientSource),
          confidence: ragResult.confidence,
          usedLLM: ragResult.usedLLM,
          ragTrace: canSeeTrace ? ragResult.ragTrace : undefined,
        });
      } catch (error) {
        console.error("[chat] streaming answer failed:", error);
        send({ type: "error", error: "پاسخ‌گویی با خطا مواجه شد. لطفاً دوباره تلاش کنید." });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
