import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull, desc } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { getCurrentUser, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { storeFile, validateUpload, computeSHA256 } from "@/lib/storage";
import { queueDocumentProcessing } from "@/lib/document-processor";
import { logEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.DOCUMENT_READ)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }
  if (!user.organizationId) {
    return NextResponse.json({ error: "کاربر به سازمانی تعلق ندارد" }, { status: 400 });
  }

  const docs = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, user.organizationId),
        isNull(documents.deletedAt)
      )
    )
    .orderBy(desc(documents.createdAt))
    .limit(100);

  return NextResponse.json(docs);
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

  // Validate file
  const validation = validateUpload(buffer, filename, mimeType);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // Check for duplicate
  const fileHash = computeSHA256(buffer);
  const [existing] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, user.organizationId),
        eq(documents.fileHash, fileHash),
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

  // Store file
  const stored = await storeFile(buffer, filename, user.organizationId);

  // Create document record
  const [doc] = await db
    .insert(documents)
    .values({
      organizationId: user.organizationId,
      departmentId: user.departmentId,
      ownerId: user.id,
      title: title ?? filename,
      originalFilename: filename,
      fileType: filename.split(".").pop()?.toLowerCase() ?? "unknown",
      mimeType,
      fileSizeBytes: buffer.length,
      fileHash,
      storagePath: stored.path,
      status: "UPLOADED",
      visibility: "department",
    })
    .returning();

  // Queue for processing
  await queueDocumentProcessing(doc.id, user.organizationId);

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
    metadata: { filename, fileType: doc.fileType, sizeBytes: buffer.length },
  });

  return NextResponse.json(doc, { status: 201 });
}
