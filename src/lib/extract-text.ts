export async function extractText(buffer: Buffer, mimeOrFilename: string) {
  const value = mimeOrFilename.toLowerCase();
  if (value.includes("text/") || /\.(txt|md|csv|json|xml|html?)$/i.test(value)) {
    return buffer.toString("utf8");
  }
  if (value.includes("pdf") || value.endsWith(".pdf")) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdf = require("pdf-parse");
      return (await pdf(buffer)).text as string;
    } catch {
      throw new Error("پردازش PDF در دسترس نیست");
    }
  }
  if (value.includes("word") || /\.(docx)$/i.test(value)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require("mammoth");
      return (await mammoth.extractRawText({ buffer })).value as string;
    } catch {
      throw new Error("پردازش DOCX در دسترس نیست");
    }
  }
  throw new Error("فرمت فایل پشتیبانی نمی‌شود. TXT, MD, CSV, JSON, PDF و DOCX مجاز هستند.");
}
