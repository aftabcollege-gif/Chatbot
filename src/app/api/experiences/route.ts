import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull, desc, count, getTableColumns as getTableColumnsOf } from "drizzle-orm";
import { db } from "@/db";
import { experiences, experienceTags } from "@/db/schema";
import { getCurrentUser, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { logEvent } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ExperienceSchema = z.object({
  title: z.string().min(2).max(500),
  subject: z.string().max(255).optional(),
  problemDescription: z.string().min(10).max(5000),
  rootCause: z.string().max(2000).optional(),
  actionsTaken: z.string().min(10).max(5000),
  results: z.string().max(2000).optional(),
  lessonsLearned: z.string().min(10).max(3000),
  suggestion: z.string().max(2000).optional(),
  relatedEquipment: z.string().max(500).optional(),
  relatedProcess: z.string().max(500).optional(),
  importance: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  tags: z.array(z.string().max(100)).max(20).default([]),
  visibility: z.enum(["private", "department", "organization"]).default("department"),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.EXPERIENCE_READ)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }
  if (!user.organizationId) {
    return NextResponse.json({ error: "کاربر به سازمانی تعلق ندارد" }, { status: 400 });
  }

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");
  const limitParam = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 100, 1), 200);
  const offsetParam = parseInt(url.searchParams.get("offset") ?? "0", 10);
  const offset = Math.max(Number.isFinite(offsetParam) ? offsetParam : 0, 0);

  const where = and(
    eq(experiences.organizationId, user.organizationId),
    isNull(experiences.deletedAt),
    ...(statusFilter ? [eq(experiences.status, statusFilter)] : []),
  );

  // Explicit column list: the legacy jsonb `embedding` column must never be
  // shipped to the client (it is large and unused since chunks moved to
  // knowledge_chunks).
  const { embedding: _embedding, ...listColumns } = getTableColumnsOf(experiences);
  void _embedding;
  const [results, [{ total }]] = await Promise.all([
    db.select(listColumns).from(experiences).where(where).orderBy(desc(experiences.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(experiences).where(where),
  ]);

  const response = NextResponse.json(results);
  response.headers.set("X-Total-Count", String(total));
  response.headers.set("X-Has-More", String(offset + results.length < Number(total)));
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.EXPERIENCE_CREATE)) {
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

  const parsed = ExperienceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "اطلاعات نامعتبر", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // No embedding here: a DRAFT experience is not retrievable. It is chunked
  // and embedded by the background worker when it is PUBLISHED
  // (src/lib/experiences/pipeline.ts), keeping this request O(1).
  const [experience] = await db
    .insert(experiences)
    .values({
      organizationId: user.organizationId,
      departmentId: user.departmentId,
      ownerId: user.id,
      title: data.title,
      subject: data.subject,
      problemDescription: data.problemDescription,
      rootCause: data.rootCause,
      actionsTaken: data.actionsTaken,
      results: data.results,
      lessonsLearned: data.lessonsLearned,
      suggestion: data.suggestion,
      relatedEquipment: data.relatedEquipment,
      relatedProcess: data.relatedProcess,
      importance: data.importance,
      visibility: data.visibility,
      status: "DRAFT",
    })
    .returning();

  // Insert tags
  if (data.tags.length > 0) {
    await db.insert(experienceTags).values(
      data.tags.map((tag) => ({ experienceId: experience.id, tag }))
    );
  }

  await logEvent({
    eventCode: "EXPERIENCE_CREATE",
    actorId: user.id,
    actorName: user.name,
    organizationId: user.organizationId,
    resourceType: "experience",
    resourceId: experience.id,
    resourceName: experience.title,
    outcome: "SUCCESS",
  });

  return NextResponse.json(experience, { status: 201 });
}
