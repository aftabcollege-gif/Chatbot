import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, messages, users } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { jwtVerify } from "jose";
import { isAIConfigured } from "@/lib/ai";

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
  if (!userId) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });

  const { id } = await params;

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));

  return NextResponse.json({
    messages: msgs.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      confidenceScore: m.confidenceScore,
      createdAt: m.createdAt?.toISOString(),
    })),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });

  const { id } = await params;

  // Verify conversation belongs to user
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1);

  if (!conversation) {
    return NextResponse.json({ error: "گفتگو یافت نشد" }, { status: 404 });
  }

  const body = await request.json();
  const { content, scope } = body as { content: string; scope?: string };

  if (!content?.trim()) {
    return NextResponse.json({ error: "پیام خالی است" }, { status: 400 });
  }

  // Save user message
  const [userMessage] = await db.insert(messages).values({
    conversationId: id,
    role: "user",
    content: content.trim(),
    scope: scope || "all",
  }).returning();

  const startTime = Date.now();

  let answerText: string;
  let confidence = 0;

  if (isAIConfigured()) {
    try {
      // Get user info for RAG context
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      const orgId = user?.organizationId || "";
      const deptId = user?.departmentId || null;

      const { answerWithRag } = await import("@/lib/rag");
      const result = await answerWithRag(content, orgId, deptId, userId);
      answerText = result.answer;
      confidence = result.confidence;
    } catch (error) {
      console.error("RAG error:", error);
      answerText = "متأسفانه در پردازش درخواست شما خطایی رخ داد. لطفاً دوباره تلاش کنید.";
    }
  } else {
    // Fallback: simple response without AI
    answerText = `سلام! پیام شما دریافت شد: "${content.trim().substring(0, 100)}"\n\nدر حال حاضر سرویس هوش مصنوعی پیکربندی نشده است. برای فعال‌سازی پاسخ‌دهی هوشمند، لطفاً متغیرهای محیطی AI_BASE_URL و AI_API_KEY را تنظیم کنید.\n\nاز مدل‌های رایگان مانند Hugging Face Inference API یا OpenRouter می‌توانید استفاده کنید.`;
    confidence = 0;
  }

  const responseTimeMs = Date.now() - startTime;

  // Save assistant message
  const [assistantMessage] = await db.insert(messages).values({
    conversationId: id,
    role: "assistant",
    content: answerText,
    confidenceScore: confidence,
    responseTimeMs,
    tokenCount: Math.ceil(answerText.length / 4),
  }).returning();

  // Update conversation title if it's the first message
  if (!conversation.title) {
    const title = content.trim().substring(0, 50) + (content.trim().length > 50 ? "..." : "");
    await db.update(conversations).set({ title, updatedAt: new Date() }).where(eq(conversations.id, id));
  } else {
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, id));
  }

  return NextResponse.json({
    userMessage: {
      id: userMessage.id,
      role: "user",
      content: userMessage.content,
      createdAt: userMessage.createdAt?.toISOString(),
    },
    assistantMessage: {
      id: assistantMessage.id,
      role: "assistant",
      content: assistantMessage.content,
      confidenceScore: assistantMessage.confidenceScore,
      createdAt: assistantMessage.createdAt?.toISOString(),
    },
  });
}
