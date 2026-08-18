import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/db";
import { experiences, experienceTags } from "@/db/schema";
import { getCurrentUser, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { logEvent } from "@/lib/audit";
import { getEmbedding } from "@/lib/ai/orchestrator";
import { z } from "zod";

export const dynamic = "force-dynamic";

const StatusUpdateSchema = z.object({
  action: z.enum(["submit", "approve", "reject", "publish", "archive"]),
  notes: z.string().max(1000).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.EXPERIENCE_READ)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  const [experience] = await db
    .select()
    .from(experiences)
    .where(and(eq(experiences.id, id), isNull(experiences.deletedAt)))
    .limit(1);

  if (!experience) {
    return NextResponse.json({ error: "تجربه یافت نشد" }, { status: 404 });
  }

  // Tenant isolation
  if (experience.organizationId !== user.organizationId && !user.isSuperadmin) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  const tags = await db
    .select()
    .from(experienceTags)
    .where(eq(experienceTags.experienceId, id));

  return NextResponse.json({ ...experience, tags: tags.map((t) => t.tag) });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });

  const [experience] = await db
    .select()
    .from(experiences)
    .where(and(eq(experiences.id, id), isNull(experiences.deletedAt)))
    .limit(1);

  if (!experience) return NextResponse.json({ error: "تجربه یافت نشد" }, { status: 404 });
  if (experience.organizationId !== user.organizationId && !user.isSuperadmin) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "درخواست نامعتبر" }, { status: 400 });
  }

  const parsed = StatusUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "درخواست نامعتبر" }, { status: 400 });
  }

  const { action, notes } = parsed.data;

  let newStatus: string;
  let eventCode: "EXPERIENCE_SUBMIT" | "EXPERIENCE_APPROVE" | "EXPERIENCE_REJECT" | "EXPERIENCE_PUBLISH" | "EXPERIENCE_ARCHIVE";
  let requiredPermission: string;

  switch (action) {
    case "submit":
      newStatus = "SUBMITTED";
      eventCode = "EXPERIENCE_SUBMIT";
      requiredPermission = PERMISSIONS.EXPERIENCE_SUBMIT;
      break;
    case "approve":
      newStatus = "APPROVED";
      eventCode = "EXPERIENCE_APPROVE";
      requiredPermission = PERMISSIONS.EXPERIENCE_APPROVE;
      break;
    case "reject":
      newStatus = "CHANGES_REQUESTED";
      eventCode = "EXPERIENCE_REJECT";
      requiredPermission = PERMISSIONS.EXPERIENCE_REVIEW;
      break;
    case "publish":
      newStatus = "PUBLISHED";
      eventCode = "EXPERIENCE_PUBLISH";
      requiredPermission = PERMISSIONS.EXPERIENCE_PUBLISH;
      break;
    case "archive":
      newStatus = "ARCHIVED";
      eventCode = "EXPERIENCE_ARCHIVE";
      requiredPermission = PERMISSIONS.EXPERIENCE_UPDATE;
      break;
  }

  if (!hasPermission(user, requiredPermission)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  const updateData: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
  };

  if (action === "submit") {
    updateData.submittedAt = new Date();
    updateData.submittedBy = user.id;
  } else if (action === "approve") {
    updateData.approvedAt = new Date();
    updateData.approvedBy = user.id;
    updateData.reviewNotes = notes;
  } else if (action === "reject") {
    updateData.reviewedAt = new Date();
    updateData.reviewedBy = user.id;
    updateData.reviewNotes = notes;
  } else if (action === "publish") {
    updateData.publishedAt = new Date();
    updateData.publishedBy = user.id;

    // DIRECTIVE §32: When PUBLISHED, auto-integrate into RAG Index
    await indexExperienceForRAG(experience, user.organizationId!);
  } else if (action === "archive") {
    updateData.archivedAt = new Date();
    // Archived experiences must disappear from retrieval/RAG immediately
    // (directive §32/§48). Retrieval reads directly from the `experiences`
    // table filtered by status = PUBLISHED, so clearing the embedding and
    // status is sufficient to remove it from search/RAG.
    updateData.embedding = null;
  }

  const [updated] = await db
    .update(experiences)
    .set(updateData as Partial<typeof experiences.$inferInsert>)
    .where(eq(experiences.id, id))
    .returning();

  await logEvent({
    eventCode,
    actorId: user.id,
    actorName: user.name,
    organizationId: user.organizationId ?? undefined,
    resourceType: "experience",
    resourceId: id,
    resourceName: experience.title,
    outcome: "SUCCESS",
    metadata: { previousStatus: experience.status, newStatus, notes },
  });

  return NextResponse.json(updated);
}

/**
 * DIRECTIVE §32: Automatically index a published experience into RAG.
 *
 * Retrieval reads directly from the `experiences` table (see
 * src/lib/vector-search.ts#searchExperiences), filtered to status = PUBLISHED
 * and scoped by tenant/visibility, with source_type = "experience" carried
 * through to citations so the UI can distinguish an employee-submitted
 * experience from an official document (directive §32 citation requirement).
 * We (re)compute a fresh embedding over the full, final published content
 * every time an experience is (re-)published.
 */
async function indexExperienceForRAG(
  experience: typeof experiences.$inferSelect,
  _organizationId: string
): Promise<void> {
  try {
    const fullText = [
      experience.title,
      experience.subject,
      experience.problemDescription,
      experience.rootCause,
      experience.actionsTaken,
      experience.results,
      experience.lessonsLearned,
      experience.suggestion,
    ]
      .filter(Boolean)
      .join("\n\n");

    const expEmbedding = await getEmbedding(fullText);
    await db
      .update(experiences)
      .set({ embedding: expEmbedding })
      .where(eq(experiences.id, experience.id));

    console.log(`[Experience RAG] Indexed experience ${experience.id} into RAG`);
  } catch (error) {
    console.error(`[Experience RAG] Failed to index experience ${experience.id}:`, error);
    // Non-fatal — experience is still published, just not searchable via RAG
    // until the next re-index (directive §48: graceful degradation, not crash).
  }
}
