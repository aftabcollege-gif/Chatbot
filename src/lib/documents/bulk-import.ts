/**
 * Bulk folder import — registers every supported file under a directory as a
 * document and enqueues it for background ingestion.
 *
 * Designed for 100k+ files:
 *  - the directory is streamed (async generator), never materialised in RAM;
 *  - files are hashed with a streaming SHA-256 (no full-file buffers);
 *  - duplicates (same content hash within the organisation) are skipped, so
 *    re-running the import over the same folder is incremental;
 *  - document rows and jobs are inserted in batches of 200/500;
 *  - the server keeps serving chat while the worker drains the queue.
 *
 * Used by `scripts/import-folder.mjs` (CLI) and POST /api/documents/import.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { config } from "@/lib/config";
import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE_BYTES, extensionOf } from "@/lib/documents/validate";
import { resolveOrgStoragePath } from "@/lib/documents/storage";
import { enqueueJobs } from "@/lib/jobs/queue";

export interface BulkImportOptions {
  organizationId: string;
  departmentId?: string | null;
  uploadedBy?: string | null;
  sourceDir: string;
  /** Copy files into STORAGE_DIR (default) or reference them in place. */
  mode?: "copy" | "link";
  /** Only import files with these extensions (default: all supported). */
  extensions?: string[];
  /** Skip files larger than this (default MAX_FILE_SIZE_BYTES). */
  maxFileSizeBytes?: number;
  /** Stop after this many files (useful for smoke tests). */
  limit?: number;
  /** Do everything except writing to the database / storage. */
  dryRun?: boolean;
  /** Progress callback, called every `progressEvery` files. */
  onProgress?: (p: BulkImportProgress) => void;
  progressEvery?: number;
  signal?: AbortSignal;
}

export interface BulkImportProgress {
  scanned: number;
  imported: number;
  skippedDuplicate: number;
  skippedUnsupported: number;
  skippedTooLarge: number;
  failed: number;
  bytes: number;
  elapsedMs: number;
}

export interface BulkImportResult extends BulkImportProgress {
  batchId: string | null;
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  rtf: "application/rtf",
  odt: "application/vnd.oasis.opendocument.text",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tiff: "image/tiff",
  bmp: "image/bmp",
};

async function* walk(dir: string, signal?: AbortSignal): AsyncGenerator<string> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (error) {
    console.error(`[import] cannot read directory ${dir}:`, error);
    return;
  }
  // Deterministic order makes re-runs and progress reporting predictable.
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (signal?.aborted) return;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, signal);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function sha256Stream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

interface PendingFile {
  absolutePath: string;
  fileName: string;
  ext: string;
  size: number;
  sha256: string;
}

const DB_BATCH = 200;

export async function importFolder(options: BulkImportOptions): Promise<BulkImportResult> {
  const started = Date.now();
  const sourceDir = path.resolve(options.sourceDir);
  const stat = await fsp.stat(sourceDir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Import source is not a directory: ${sourceDir}`);
  }
  const mode = options.mode ?? "copy";
  const allowed = new Set((options.extensions ?? ALLOWED_EXTENSIONS).map((e) => e.toLowerCase()));
  const maxSize = options.maxFileSizeBytes ?? MAX_FILE_SIZE_BYTES;
  const progressEvery = options.progressEvery ?? 100;

  const progress: BulkImportProgress = {
    scanned: 0,
    imported: 0,
    skippedDuplicate: 0,
    skippedUnsupported: 0,
    skippedTooLarge: 0,
    failed: 0,
    bytes: 0,
    elapsedMs: 0,
  };
  const report = () => {
    progress.elapsedMs = Date.now() - started;
    options.onProgress?.({ ...progress });
  };

  let batchId: string | null = null;
  if (!options.dryRun) {
    const row = await db.execute<{ id: string }>(sql`
      INSERT INTO import_batches (organization_id, source_path) VALUES (${options.organizationId}, ${sourceDir}) RETURNING id
    `);
    batchId = (row as unknown as { rows: Array<{ id: string }> }).rows[0]?.id ?? null;
  }

  const storageDir = options.dryRun ? null : resolveOrgStoragePath(options.organizationId, "documents");
  if (storageDir) await fsp.mkdir(storageDir, { recursive: true });

  const seenHashes = new Set<string>(); // duplicates within this run
  let pending: PendingFile[] = [];

  const flush = async () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];

    // One query to find hashes already present for this organisation.
    const existing = options.dryRun
      ? new Set<string>()
      : new Set(
          (
            await db
              .select({ sha256: documents.sha256 })
              .from(documents)
              .where(
                and(
                  eq(documents.organizationId, options.organizationId),
                  isNull(documents.deletedAt),
                  inArray(
                    documents.sha256,
                    batch.map((f) => f.sha256),
                  ),
                ),
              )
          ).map((r) => r.sha256),
        );

    const rows: (typeof documents.$inferInsert)[] = [];
    for (const file of batch) {
      if (existing.has(file.sha256)) {
        progress.skippedDuplicate++;
        continue;
      }
      let storagePath: string;
      try {
        if (options.dryRun) {
          storagePath = file.absolutePath;
        } else if (mode === "copy") {
          const target = path.join(storageDir!, `${crypto.randomUUID()}.bin`);
          await fsp.copyFile(file.absolutePath, target);
          storagePath = path.relative(config.storageDir, target);
        } else {
          // "link" mode: reference the original file. absoluteStoragePath()
          // rejects paths outside STORAGE_DIR, so we store an absolute path
          // marker that the pipeline resolves explicitly.
          storagePath = `abs:${file.absolutePath}`;
        }
      } catch (error) {
        progress.failed++;
        console.error(`[import] failed to store ${file.absolutePath}:`, error);
        continue;
      }
      rows.push({
        organizationId: options.organizationId,
        departmentId: options.departmentId ?? null,
        uploadedBy: options.uploadedBy ?? null,
        title: path.basename(file.fileName, path.extname(file.fileName)).slice(0, 500),
        fileName: file.fileName.slice(0, 500),
        mimeType: MIME_BY_EXT[file.ext] ?? "application/octet-stream",
        fileSize: file.size,
        sha256: file.sha256,
        storagePath,
        status: "pending",
      });
      progress.bytes += file.size;
    }

    if (rows.length > 0 && !options.dryRun) {
      const inserted = await db.insert(documents).values(rows).returning({ id: documents.id });
      await enqueueJobs(
        options.organizationId,
        "document_ingest",
        inserted.map((d) => d.id),
        { batchId },
      );
    }
    progress.imported += rows.length;
    report();
  };

  try {
    for await (const absolutePath of walk(sourceDir, options.signal)) {
      if (options.signal?.aborted) break;
      if (options.limit && progress.scanned >= options.limit) break;
      progress.scanned++;

      const fileName = path.basename(absolutePath);
      const ext = extensionOf(fileName);
      if (!allowed.has(ext)) {
        progress.skippedUnsupported++;
        continue;
      }
      let size: number;
      try {
        size = (await fsp.stat(absolutePath)).size;
      } catch {
        progress.failed++;
        continue;
      }
      if (size <= 0) {
        progress.skippedUnsupported++;
        continue;
      }
      if (size > maxSize) {
        progress.skippedTooLarge++;
        continue;
      }
      let sha256: string;
      try {
        sha256 = await sha256Stream(absolutePath);
      } catch (error) {
        progress.failed++;
        console.error(`[import] cannot hash ${absolutePath}:`, error);
        continue;
      }
      if (seenHashes.has(sha256)) {
        progress.skippedDuplicate++;
        continue;
      }
      seenHashes.add(sha256);

      pending.push({ absolutePath, fileName, ext, size, sha256 });
      if (pending.length >= DB_BATCH) await flush();
      else if (progress.scanned % progressEvery === 0) report();
    }
    await flush();
  } finally {
    report();
    if (batchId) {
      await db.execute(sql`
        UPDATE import_batches
        SET status = ${options.signal?.aborted ? "CANCELLED" : "COMPLETED"},
            total_files = ${progress.scanned},
            imported_files = ${progress.imported},
            skipped_files = ${progress.skippedDuplicate + progress.skippedUnsupported + progress.skippedTooLarge},
            failed_files = ${progress.failed},
            finished_at = now()
        WHERE id = ${batchId}
      `);
    }
  }

  return { ...progress, elapsedMs: Date.now() - started, batchId };
}
