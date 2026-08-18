import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull, desc } from "drizzle-orm";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth-server";
import { hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.CHAT_USE)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  const userConversations = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, user.id),
        isNull(conversations.deletedAt)
      )
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(100);

  return NextResponse.json(userConversations);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.CHAT_USE)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }
  if (!user.organizationId) {
    return NextResponse.json({ error: "کاربر به سازمانی تعلق ندارد" }, { status: 400 });
  }

  const [conversation] = await db
    .insert(conversations)
    .values({
      userId: user.id,
      organizationId: user.organizationId,
      title: "گفتگوی جدید",
    })
    .returning();

  return NextResponse.json(conversation, { status: 201 });
}
