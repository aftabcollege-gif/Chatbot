import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  }

  const { id: conversationId } = await params;

  try {
    // Verify conversation ownership
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, userId)
        )
      )
      .limit(1);

    if (!conversation) {
      return NextResponse.json(
        { error: "گفتگو یافت نشد" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { content, scope = "all" } = body;

    if (!content?.trim()) {
      return NextResponse.json(
        { error: "پیام نمی‌تواند خالی باشد" },
        { status: 400 }
      );
    }

    // Save user message
    const [userMessage] = await db
      .insert(messages)
      .values({
        conversationId,
        role: "user",
        content: content.trim(),
        scope,
      })
      .returning();

    // Update conversation title if it's the first message
    if (!conversation.title) {
      const title = content.trim().slice(0, 50) + (content.length > 50 ? "..." : "");
      await db
        .update(conversations)
        .set({ title, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    }

    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Simulate RAG response with streaming
          // In production, this would call the actual LLM service
          const mockResponse = generateMockResponse(content);
          
          // Stream tokens
          for (const token of mockResponse.tokens) {
            const data = JSON.stringify({ type: "token", content: token });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            await new Promise((resolve) => setTimeout(resolve, 30));
          }

          // Send sources
          const sourcesData = JSON.stringify({
            type: "sources",
            sources: mockResponse.sources,
          });
          controller.enqueue(encoder.encode(`data: ${sourcesData}\n\n`));

          // Send confidence
          const confidenceData = JSON.stringify({
            type: "confidence",
            score: mockResponse.confidence,
          });
          controller.enqueue(encoder.encode(`data: ${confidenceData}\n\n`));

          // Save assistant message
          const [assistantMessage] = await db
            .insert(messages)
            .values({
              conversationId,
              role: "assistant",
              content: mockResponse.tokens.join(""),
              confidenceScore: mockResponse.confidence,
            })
            .returning();

          // Send done
          const doneData = JSON.stringify({
            type: "done",
            messageId: assistantMessage.id,
          });
          controller.enqueue(encoder.encode(`data: ${doneData}\n\n`));

          controller.close();
        } catch (error) {
          console.error("Stream error:", error);
          const errorData = JSON.stringify({
            type: "error",
            message: "خطا در پردازش پیام",
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error sending message:", error);
    return NextResponse.json(
      { error: "خطا در ارسال پیام" },
      { status: 500 }
    );
  }
}

function generateMockResponse(userMessage: string) {
  // Mock RAG response for demo
  const responses: Record<string, { text: string; confidence: number }> = {
    default: {
      text: `با سلام! سؤال شما دریافت شد: "${userMessage.slice(0, 50)}..."\n\nدر حال حاضر سیستم در حالت نمایشی قرار دارد. برای استفاده کامل از قابلیت‌های RAG، لطفاً مدل زبانی محلی (مانند Qwen2.5) و مدل Embedding (مانند BGE-M3) را راه‌اندازی کنید.\n\nاین سامانه می‌تواند:\n• پاسخ به سؤالات بر اساس اسناد سازمانی\n• جستجو در دانش و تجربیات\n• ذکر منابع برای هر پاسخ`,
      confidence: 0.85,
    },
  };

  const response = responses.default;
  const tokens = response.text.split("");

  return {
    tokens,
    confidence: response.confidence,
    sources: [
      {
        id: "mock-1",
        type: "document",
        title: "راهنمای استفاده از سامانه",
        pageNumber: 1,
        section: "مقدمه",
        relevanceScore: 0.92,
      },
      {
        id: "mock-2",
        type: "knowledge",
        title: "تجربه راه‌اندازی سیستم",
        relevanceScore: 0.78,
      },
    ],
  };
}
