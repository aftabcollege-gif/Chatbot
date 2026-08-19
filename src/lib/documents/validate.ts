import AdmZip from "adm-zip";

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB per file
export const MAX_ZIP_UNCOMPRESSED_BYTES = 300 * 1024 * 1024; // zip-bomb guard
export const MAX_ZIP_ENTRIES = 2000;

export const ALLOWED_EXTENSIONS = [
  "pdf",
  "docx",
  "doc",
  "xlsx",
  "xls",
  "pptx",
  "txt",
  "csv",
  "md",
  "rtf",
  "odt",
  "png",
  "jpg",
  "jpeg",
  "tiff",
  "bmp",
];

const ZIP_BASED_EXTENSIONS = new Set(["docx", "xlsx", "pptx", "odt"]);

export class FileValidationError extends Error {}

export function extensionOf(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

export function assertSafeFileName(fileName: string): void {
  if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
    throw new FileValidationError("نام فایل نامعتبر است (احتمال Path Traversal).");
  }
  if (fileName.length > 260) {
    throw new FileValidationError("نام فایل بیش از حد طولانی است.");
  }
}

export function assertAllowedFile(fileName: string, mimeType: string, size: number): void {
  assertSafeFileName(fileName);
  const ext = extensionOf(fileName);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new FileValidationError(`فرمت فایل «${ext}» پشتیبانی نمی‌شود.`);
  }
  if (size <= 0) {
    throw new FileValidationError("فایل خالی است.");
  }
  if (size > MAX_FILE_SIZE_BYTES) {
    throw new FileValidationError(
      `حجم فایل از حد مجاز (${MAX_FILE_SIZE_BYTES / (1024 * 1024)} مگابایت) بیشتر است.`,
    );
  }
  void mimeType; // MIME is advisory only; extension + content sniffing below are authoritative.
}

/** Zip-bomb / malicious archive protection for OOXML/ODF formats (they are zip containers). */
export function assertSafeZipContainer(buffer: Buffer, fileName: string): void {
  const ext = extensionOf(fileName);
  if (!ZIP_BASED_EXTENSIONS.has(ext)) return;

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new FileValidationError("فایل آرشیو معتبر نیست یا خراب است.");
  }

  const entries = zip.getEntries();
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new FileValidationError("تعداد اجزای داخلی فایل بیش از حد مجاز است (احتمال Zip Bomb).");
  }

  let totalUncompressed = 0;
  for (const entry of entries) {
    const name = entry.entryName;
    if (name.includes("..") || path_isAbsolute(name)) {
      throw new FileValidationError("مسیر داخلی فایل آرشیو نامعتبر است.");
    }
    totalUncompressed += entry.header.size;
    if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new FileValidationError("حجم غیرفشرده فایل آرشیو بیش از حد مجاز است (احتمال Zip Bomb).");
    }
  }
}

function path_isAbsolute(p: string): boolean {
  return p.startsWith("/") || /^[a-zA-Z]:\\/.test(p);
}
