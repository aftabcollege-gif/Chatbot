import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull, desc, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { documents, documentStatusEnum } from "@/db/schema";
import { getCurrentUser, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { saveBufferSecurely, sha256Buffer } from "@/lib/documents/storage";
import { assertAllowedFile, assertSafeZipContainer, FileValidationError } from "@/lib/documents/validate";
import { enqueueJob } from "@/lib/jobs/queue";
import { checkRateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { logEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * Paginated document list.
 *
 *   GET /api/documents?limit=50&offset=0&status=completed&q=قرارداد
 *
 * Returns `{ items, total, limit, offset, hasMore }`. The page query walks
 * the (organization_id, status, created_at DESC) index, so it costs the same
 * at 100 rows and at 100 000 rows; the total is a COUNT on the same index.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.DOCUMENT_READ)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }
  if (!user.organizationId) {
    return NextResponse.json({ error: "کاربر به سازمانی تعلق ندارد" }, { status: 400 });
  }

  const url = new URL(request.url);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(url.searchParams.get("limit") ?? "", 10) || DEFAULT_PAGE_SIZE));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "", 10) || 0);
  const statusParam = url.searchParams.get("status");
  const status = (documentStatusEnum as readonly string[]).includes(statusParam ?? "") ? statusParam : null;
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);

  const conditions: SQL[] = [eq(documents.organizationId, user.organizationId), isNull(documents.deletedAt)];
  if (status) conditions.push(eq(documents.status, status));
  if (q) {
    // Case-insensitive contains match on title / file name. Escape LIKE
    // metacharacters so a literal "%" in the query cannot widen the match.
    const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
    const pattern = `%${escaped.toLowerCase()}%`;
    conditions.push(
      sql`(lower(${documents.title}) LIKE ${pattern} ESCAPE '\\' OR lower(${documents.fileName}) LIKE ${pattern} ESCAPE '\\')`,
    );
  }
  const where = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        fileName: documents.fileName,
        mimeType: documents.mimeType,
        fileSize: documents.fileSize,
        status: documents.status,
        ocrUsed: documents.ocrUsed,
        pageCount: documents.pageCount,
        errorMessage: documents.errorMessage,
        currentVersion: documents.currentVersion,
        uploadedBy: documents.uploadedBy,
        departmentId: documents.departmentId,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(where)
      .orderBy(desc(documents.createdAt), desc(documents.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(documents).where(where),
  ]);

  const totalCount = Number(total ?? 0);
  const response = NextResponse.json({
    items: rows,
    total: totalCount,
    limit,
    offset,
    hasMore: offset + rows.length < totalCount,
  });
  response.headers.set("X-Total-Count", String(totalCount));
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.DOCUMENT_CREATE)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }
  if (!user.organizationId) {
    return NextResponse.json({ error: "کاربر به سازمانی تعلق ندارد" }, { status: 400 });
  }

  // Per-user upload throttle (RATE_LIMIT_UPLOAD_MAX per RATE_LIMIT_UPLOAD_WINDOW_MINUTES).
  // Checked before the body is read so a flood costs nothing. Bulk loads
  // should go through the folder importer, which is not subject to it.
  const rate = await checkRateLimit(user.id, "upload");
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "تعداد بارگذاری‌ها بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید یا از واردکردن پوشه‌ای استفاده کنید." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds("upload", rate)) } },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "فرمت درخواست نامعتبر است" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const title = formData.get("title") as string | null;

  if (!file) {
    return NextResponse.json({ error: "فایل الزامی است" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = file.name;
  const mimeType = file.type;

  // Validate file (extension, size, zip-bomb protection)
  try {
    assertAllowedFile(filename, mimeType, buffer.length);
    assertSafeZipContainer(buffer, filename);
  } catch (err) {
    const message = err instanceof FileValidationError ? err.message : "فایل نامعتبر است.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Check for duplicate
  const fileHash = sha256Buffer(buffer);
  const [existing] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, user.organizationId),
        eq(documents.sha256, fileHash),
        isNull(documents.deletedAt)
      )
    )
    .limit(1);

  if (existing) {
    return NextResponse.json(
      { error: "این فایل قبلاً بارگذاری شده است.", existingId: existing.id },
      { status: 409 }
    );
  }

  // Store file (path is relative to STORAGE_DIR, used by the ingest pipeline)
  const stored = await saveBufferSecurely(user.organizationId, "documents", buffer);

  // Create document record
  const [doc] = await db
    .insert(documents)
    .values({
      organizationId: user.organizationId,
      departmentId: user.departmentId,
      uploadedBy: user.id,
      title: title ?? filename,
      fileName: filename,
      mimeType,
      fileSize: buffer.length,
      sha256: fileHash,
      storagePath: stored.storagePath,
      status: "pending",
    })
    .returning();

  // Queue for processing (background job: extract → chunk → embed → index)
  await enqueueJob(user.organizationId, "document_ingest", doc.id, { title: doc.title });

  // Audit
  await logEvent({
    eventCode: "DOCUMENT_UPLOAD",
    actorId: user.id,
    actorName: user.name,
    organizationId: user.organizationId,
    resourceType: "document",
    resourceId: doc.id,
    resourceName: doc.title,
    outcome: "SUCCESS",
    metadata: { filename, mimeType, sizeBytes: buffer.length },
  });

  return NextResponse.json(doc, { status: 201 });
}
