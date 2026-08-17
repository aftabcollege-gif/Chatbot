import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
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

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  }

  try {
    const userConversations = await db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.updatedAt))
      .limit(50);

    return NextResponse.json({
      conversations: userConversations.map((c) => ({
        id: c.id,
        title: c.title || "گفتگوی جدید",
        updatedAt: c.updatedAt?.toISOString(),
        isPinned: c.isPinned,
      })),
    });
  } catch (error) {
    console.error("Error fetching conversations:", error);
    return NextResponse.json(
      { error: "خطا در دریافت گفتگوها" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { title } = body as { title?: string };

    const [conversation] = await db
      .insert(conversations)
      .values({
        userId,
        title: title || null,
        isPinned: false,
      })
      .returning();

    return NextResponse.json({
      conversation: {
        id: conversation.id,
        title: conversation.title || "گفتگوی جدید",
        createdAt: conversation.createdAt?.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error creating conversation:", error);
    return NextResponse.json(
      { error: "خطا در ایجاد گفتگو" },
      { status: 500 }
    );
  }
}
