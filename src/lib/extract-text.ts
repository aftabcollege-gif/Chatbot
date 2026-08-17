export async function extractText(buffer: Buffer, mimeOrFilename: string) {
  const value = mimeOrFilename.toLowerCase();
  if (value.includes("text/") || /\.(txt|md|csv|json|xml|html?)$/i.test(value)) {
    return buffer.toString("utf8");
  }
  if (value.includes("pdf") || value.endsWith(".pdf")) {
    const pdf = (await import("pdf-parse")).default;
    return (await pdf(buffer)).text;
  }
  if (value.includes("word") || /\.(docx)$/i.test(value)) {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer })).value;
  }
  throw new Error("فرمت فایل پشتیبانی نمی‌شود. TXT, MD, CSV, JSON, PDF و DOCX مجاز هستند.");
}
