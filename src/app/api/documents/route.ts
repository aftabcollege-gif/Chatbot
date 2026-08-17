import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, documentChunks, users } from "@/db/schema";
import { extractText } from "@/lib/extract-text";
import { splitIntoChunks } from "@/lib/chunking";
import { createEmbeddings } from "@/lib/ai";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "change-this-to-random-64-char-string");

async function getUser(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload.userId as string;
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  const userId = await getUser(request);
  if (!userId) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  const rows = await db.select().from(documents).where(eq(documents.ownerId, userId)).orderBy(documents.createdAt);
  return NextResponse.json({ items: rows });
}

export async function POST(request: NextRequest) {
  const userId = await getUser(request);
  if (!userId) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "فایل الزامی است" }, { status: 400 });
    if (file.size > Number(process.env.MAX_UPLOAD_BYTES ?? 20 * 1024 * 1024)) {
      return NextResponse.json({ error: "حجم فایل بیش از حد مجاز است" }, { status: 413 });
    }

    const [owner] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!owner?.organizationId) return NextResponse.json({ error: "سازمان کاربر مشخص نیست" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = createHash("sha256").update(buffer).digest("hex");
    const [existing] = await db.select().from(documents).where(and(eq(documents.organizationId, owner.organizationId), eq(documents.fileHash, hash))).limit(1);
    if (existing) return NextResponse.json({ error: "این فایل قبلاً ثبت شده است", document: existing }, { status: 409 });

    const text = (await extractText(buffer, file.type || file.name)).trim();
    if (!text) return NextResponse.json({ error: "متن قابل استخراج از فایل پیدا نشد" }, { status: 422 });
    const chunks = splitIntoChunks(text);
    if (!chunks.length) return NextResponse.json({ error: "فایل محتوای متنی قابل پردازش ندارد" }, { status: 422 });

    const [document] = await db.insert(documents).values({
      organizationId: owner.organizationId,
      departmentId: owner.departmentId,
      ownerId: owner.id,
      title: file.name.replace(/\.[^.]+$/, ""),
      originalFilename: file.name,
      fileType: file.name.split(".").pop()?.toLowerCase() || "unknown",
      mimeType: file.type || "application/octet-stream",
      fileSizeBytes: file.size,
      fileHash: hash,
      storagePath: `database://${hash}`,
      status: "PROCESSING",
      processingProgress: 10,
      visibility: "organization",
      metadata: { extractedCharacters: text.length },
    }).returning();

    try {
      const batchSize = 32;
      const rows: typeof documentChunks.$inferInsert[] = [];
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const embeddings = await createEmbeddings(batch.map((item) => item.content));
        rows.push(...batch.map((item, j) => ({
          documentId: document.id,
          organizationId: owner.organizationId!,
          departmentId: owner.departmentId,
          chunkIndex: item.chunkIndex,
          content: item.content,
          contentNormalized: item.content.toLowerCase(),
          sourceType: "document",
          visibility: "organization",
          tokenCount: Math.ceil(item.content.length / 4),
          embedding: embeddings[j],
          metadata: {},
        })));
        await db.update(documents).set({ processingProgress: Math.min(95, Math.round(((i + batch.length) / chunks.length) * 85) + 10) }).where(eq(documents.id, document.id));
      }
      await db.insert(documentChunks).values(rows);
      const [ready] = await db.update(documents).set({ status: "READY", processingProgress: 100, updatedAt: new Date() }).where(eq(documents.id, document.id)).returning();
      return NextResponse.json({ document: ready, chunks: rows.length }, { status: 201 });
    } catch (processingError) {
      await db.update(documents).set({ status: "ERROR", processingError: processingError instanceof Error ? processingError.message : "خطای پردازش", updatedAt: new Date() }).where(eq(documents.id, document.id));
      throw processingError;
    }
  } catch (error) {
    console.error("Document upload error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "خطا در پردازش فایل" }, { status: 500 });
  }
}
