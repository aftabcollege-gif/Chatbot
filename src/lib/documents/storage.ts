import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "@/lib/config";

/**
 * All stored files live under STORAGE_DIR/<organizationId>/<category>/<uuid>.
 * File names are never derived from user input to prevent path traversal;
 * the original file name is kept only as metadata in the database.
 */
export function resolveOrgStoragePath(organizationId: string, category: "documents" | "experiences"): string {
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) {
    throw new Error("Invalid organizationId for storage path");
  }
  return path.join(config.storageDir, organizationId, category);
}

export async function saveBufferSecurely(
  organizationId: string,
  category: "documents" | "experiences",
  buffer: Buffer,
): Promise<{ storagePath: string; absolutePath: string }> {
  const dir = resolveOrgStoragePath(organizationId, category);
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.bin`;
  const absolutePath = path.join(dir, fileName);

  // Defense in depth: ensure the resolved path is still within storageDir.
  const normalized = path.normalize(absolutePath);
  if (!normalized.startsWith(path.normalize(config.storageDir))) {
    throw new Error("Path traversal attempt detected while saving file");
  }

  await fs.writeFile(absolutePath, buffer);
  const storagePath = path.relative(config.storageDir, absolutePath);
  return { storagePath, absolutePath };
}

export function absoluteStoragePath(storagePath: string): string {
  const absolute = path.join(config.storageDir, storagePath);
  const normalized = path.normalize(absolute);
  if (!normalized.startsWith(path.normalize(config.storageDir))) {
    throw new Error("Path traversal attempt detected while reading file");
  }
  return normalized;
}

export async function deleteStoredFile(storagePath: string): Promise<void> {
  try {
    await fs.unlink(absoluteStoragePath(storagePath));
  } catch {
    // Already gone - ignore.
  }
}

export function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
