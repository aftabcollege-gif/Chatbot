/**
 * Storage Provider — Local filesystem with path traversal protection
 *
 * Directive §48: SHA-256 for file integrity, path traversal prevention.
 * For production, this can be replaced with any StorageProvider implementation.
 */

import { join, normalize, basename, resolve } from "path";
import { mkdir, writeFile, readFile, unlink, stat } from "fs/promises";
import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";

const STORAGE_ROOT = resolve(process.env.STORAGE_PATH ?? "./storage/uploads");
const MAX_FILE_SIZE_BYTES =
  parseInt(process.env.MAX_FILE_SIZE_MB ?? "50") * 1024 * 1024;

export interface StorageFile {
  path: string;
  sha256: string;
  sizeBytes: number;
}

/** Compute SHA-256 hash of a Buffer */
export function computeSHA256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Prevent path traversal — ensure path is within storage root */
function safePath(relativePath: string): string {
  // Remove any path traversal attempts
  const safe = normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const full = resolve(STORAGE_ROOT, safe);
  if (!full.startsWith(STORAGE_ROOT)) {
    throw new Error("Path traversal attempt detected");
  }
  return full;
}

/** Ensure storage directory exists */
async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/**
 * Store a file securely.
 * Returns the relative storage path and SHA-256 hash.
 */
export async function storeFile(
  buffer: Buffer,
  originalFilename: string,
  subdir?: string
): Promise<StorageFile> {
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `فایل بزرگ‌تر از حداکثر مجاز (${process.env.MAX_FILE_SIZE_MB ?? 50} MB) است.`
    );
  }

  const sha256 = computeSHA256(buffer);
  const ext = originalFilename.toLowerCase().split(".").pop() ?? "bin";
  const filename = `${uuidv4()}.${ext}`;
  const dirPath = subdir ? join(STORAGE_ROOT, subdir) : STORAGE_ROOT;
  const relativePath = subdir ? join(subdir, filename) : filename;
  const fullPath = safePath(relativePath);

  await ensureDir(dirPath);
  await writeFile(fullPath, buffer);

  return {
    path: relativePath,
    sha256,
    sizeBytes: buffer.length,
  };
}

/** Read a stored file */
export async function readStoredFile(relativePath: string): Promise<Buffer> {
  const fullPath = safePath(relativePath);
  return readFile(fullPath);
}

/** Delete a stored file */
export async function deleteStoredFile(relativePath: string): Promise<void> {
  try {
    const fullPath = safePath(relativePath);
    await unlink(fullPath);
  } catch {
    // File may already be deleted — not an error
  }
}

/** Check if a file exists */
export async function fileExists(relativePath: string): Promise<boolean> {
  try {
    const fullPath = safePath(relativePath);
    await stat(fullPath);
    return true;
  } catch {
    return false;
  }
}

/** Get file size */
export async function getFileSize(relativePath: string): Promise<number> {
  const fullPath = safePath(relativePath);
  const info = await stat(fullPath);
  return info.size;
}

/** Validate file integrity by comparing stored hash */
export async function verifyFileIntegrity(
  relativePath: string,
  expectedHash: string
): Promise<boolean> {
  try {
    const buffer = await readStoredFile(relativePath);
    const actual = computeSHA256(buffer);
    return actual === expectedHash;
  } catch {
    return false;
  }
}

/** Validate upload before storing */
export function validateUpload(
  buffer: Buffer,
  filename: string,
  mimeType: string
): { valid: boolean; error?: string } {
  // Size check
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: `فایل بزرگ‌تر از حداکثر مجاز است (${process.env.MAX_FILE_SIZE_MB ?? 50} MB)` };
  }

  // Extension check
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const allowed = (process.env.ALLOWED_FILE_EXTENSIONS ?? "pdf,docx,txt,md")
    .split(",")
    .map((e) => e.trim());

  if (!allowed.includes(ext)) {
    return { valid: false, error: `فرمت فایل «.${ext}» مجاز نیست.` };
  }

  // Filename safety
  const safeName = basename(filename);
  if (safeName !== filename && !filename.match(/^[\w\-. ]+$/)) {
    return { valid: false, error: "نام فایل نامعتبر است." };
  }

  // Buffer empty
  if (buffer.length === 0) {
    return { valid: false, error: "فایل خالی است." };
  }

  return { valid: true };
}
