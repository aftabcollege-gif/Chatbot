import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { jwtVerify } from "jose";
import { db } from "@/db";
import { knowledgeItems, users } from "@/db/schema";
import { getEmbedding } from "@/lib/embeddings";
import { logEvent } from "@/lib/audit";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "change-this-to-random-64-char-string");

async function getUser(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value;
  if (!token) return null;
  try { const { payload } = await jwtVerify(token, JWT_SECRET); return payload.userId as string; } catch { return null; }
}

export async function GET(request: NextRequest) {
  const userId = await getUser(request);
  if (!userId) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.organizationId) return NextResponse.json({ items: [] });
  const items = await db.select().from(knowledgeItems).where(eq(knowledgeItems.organizationId, user.organizationId)).orderBy(desc(knowledgeItems.createdAt));
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const userId = await getUser(request);
  if (!userId) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  const body = await request.json();
  const required = ["title", "problemDescription", "actionTaken", "lessonLearned"];
  if (required.some((key) => !String((body as Record<string, unknown>)[key] ?? "").trim())) return NextResponse.json({ error: "عنوان، شرح مسئله، اقدام انجام‌شده و درس‌آموخته الزامی است" }, { status: 400 });
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.organizationId) return NextResponse.json({ error: "سازمان کاربر مشخص نیست" }, { status: 400 });

  const content = [body.title, body.subject, body.problemDescription, body.actionTaken, body.result, body.lessonLearned, body.suggestion].filter(Boolean).join("\n");
  
  let embedding: number[] | undefined;
  try {
    embedding = await getEmbedding(content);
  } catch (e) {
    console.error("Embedding error:", e);
  }

  const [item] = await db.insert(knowledgeItems).values({
    organizationId: user.organizationId, departmentId: user.departmentId, ownerId: user.id,
    title: String(body.title).trim(), subject: body.subject ? String(body.subject).trim() : null,
    problemDescription: String(body.problemDescription).trim(), actionTaken: String(body.actionTaken).trim(),
    result: body.result ? String(body.result).trim() : null, lessonLearned: String(body.lessonLearned).trim(),
    suggestion: body.suggestion ? String(body.suggestion).trim() : null, visibility: body.visibility || "department", status: "DRAFT",
    ...(embedding ? { embedding } : {}),
  }).returning();

  await logEvent({
    eventCode: "knowledge.create",
    actorId: user.id,
    actorName: user.name,
    resourceType: "knowledge",
    resourceId: item.id,
    resourceName: item.title,
    request,
  });

  return NextResponse.json({ item }, { status: 201 });
}
