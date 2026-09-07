import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull, desc, count } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeItems, knowledgeTags } from "@/db/schema";
import { getCurrentUser, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { logEvent } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const KnowledgeSchema = z.object({
  title: z.string().min(2).max(500),
  subject: z.string().max(255).optional(),
  content: z.string().min(10).max(10000),
  summary: z.string().max(1000).optional(),
  visibility: z.enum(["private", "department", "organization"]).default("department"),
  tags: z.array(z.string().max(100)).max(20).default([]),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.KNOWLEDGE_READ)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }
  if (!user.organizationId) {
    return NextResponse.json({ error: "کاربر به سازمانی تعلق ندارد" }, { status: 400 });
  }

  const url = new URL(request.url);
  const limitParam = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 100, 1), 200);
  const offsetParam = parseInt(url.searchParams.get("offset") ?? "0", 10);
  const offset = Math.max(Number.isFinite(offsetParam) ? offsetParam : 0, 0);
  const statusFilter = url.searchParams.get("status");

  const where = and(
    eq(knowledgeItems.organizationId, user.organizationId),
    isNull(knowledgeItems.deletedAt),
    ...(statusFilter ? [eq(knowledgeItems.status, statusFilter)] : []),
  );

  // Never select the (legacy, jsonb) embedding column into the list payload.
  const [items, [{ total }]] = await Promise.all([
    db
      .select({
        id: knowledgeItems.id,
        organizationId: knowledgeItems.organizationId,
        departmentId: knowledgeItems.departmentId,
        ownerId: knowledgeItems.ownerId,
        title: knowledgeItems.title,
        subject: knowledgeItems.subject,
        content: knowledgeItems.content,
        summary: knowledgeItems.summary,
        visibility: knowledgeItems.visibility,
        status: knowledgeItems.status,
        publishedAt: knowledgeItems.publishedAt,
        createdAt: knowledgeItems.createdAt,
        updatedAt: knowledgeItems.updatedAt,
      })
      .from(knowledgeItems)
      .where(where)
      .orderBy(desc(knowledgeItems.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(knowledgeItems).where(where),
  ]);

  const response = NextResponse.json(items);
  response.headers.set("X-Total-Count", String(total));
  response.headers.set("X-Has-More", String(offset + items.length < Number(total)));
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.KNOWLEDGE_CREATE)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }
  if (!user.organizationId) {
    return NextResponse.json({ error: "کاربر به سازمانی تعلق ندارد" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "درخواست نامعتبر" }, { status: 400 });
  }

  const parsed = KnowledgeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "اطلاعات نامعتبر", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // No embedding is computed here: a DRAFT item is not retrievable, and the
  // item is chunked + embedded by the background worker when it is PUBLISHED
  // (see src/lib/knowledge/pipeline.ts). Keeps this request O(1).
  const [item] = await db
    .insert(knowledgeItems)
    .values({
      organizationId: user.organizationId,
      departmentId: user.departmentId,
      ownerId: user.id,
      title: data.title,
      subject: data.subject,
      content: data.content,
      summary: data.summary,
      visibility: data.visibility,
      status: "DRAFT",
    })
    .returning();

  if (data.tags.length > 0) {
    await db.insert(knowledgeTags).values(
      data.tags.map((tag) => ({ knowledgeId: item.id, tag }))
    );
  }

  await logEvent({
    eventCode: "KNOWLEDGE_CREATE",
    actorId: user.id,
    actorName: user.name,
    organizationId: user.organizationId,
    resourceType: "knowledge",
    resourceId: item.id,
    resourceName: item.title,
    outcome: "SUCCESS",
  });

  return NextResponse.json(item, { status: 201 });
}
