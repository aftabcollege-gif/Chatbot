import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import Papa from "papaparse";
import { extensionOf } from "@/lib/documents/validate";
import { ocrImageBuffer, ocrScannedPdf } from "@/lib/documents/ocr";

const execFileAsync = promisify(execFile);

export interface ExtractedPage {
  page: number;
  text: string;
}

export interface ExtractionResult {
  pages: ExtractedPage[];
  ocrUsed: boolean;
  pageCount: number | null;
}

function stripXmlTags(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  let pageTexts: string[] = [];
  let numpages = 0;
  try {
    const result = await parser.getText();
    numpages = result.total ?? result.pages?.length ?? 0;
    pageTexts = (result.pages ?? []).map((p) => p.text ?? "");
  } finally {
    await parser.destroy();
  }

  const totalTextLength = pageTexts.reduce((sum, t) => sum + t.trim().length, 0);
  const avgPerPage = numpages > 0 ? totalTextLength / numpages : 0;

  // Heuristic: fewer than ~20 chars/page on average means the PDF is likely
  // scanned images with no embedded text layer -> run local OCR instead.
  if (avgPerPage < 20) {
    const ocrPages = await ocrScannedPdf(buffer);
    return { pages: ocrPages, ocrUsed: true, pageCount: numpages };
  }

  return {
    pages: pageTexts.map((text, idx) => ({ page: idx + 1, text })),
    ocrUsed: false,
    pageCount: numpages,
  };
}

async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer });
  return { pages: [{ page: 1, text: value }], ocrUsed: false, pageCount: null };
}

async function extractLegacyDoc(buffer: Buffer): Promise<ExtractionResult> {
  const tmpFile = path.join(os.tmpdir(), `doc-${Date.now()}-${Math.random().toString(36).slice(2)}.doc`);
  await fs.writeFile(tmpFile, buffer);
  try {
    const { stdout } = await execFileAsync("antiword", [tmpFile], { maxBuffer: 20 * 1024 * 1024 });
    return { pages: [{ page: 1, text: stdout }], ocrUsed: false, pageCount: null };
  } catch {
    const { stdout } = await execFileAsync("catdoc", [tmpFile], { maxBuffer: 20 * 1024 * 1024 });
    return { pages: [{ page: 1, text: stdout }], ocrUsed: false, pageCount: null };
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

async function extractXlsx(buffer: Buffer): Promise<ExtractionResult> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const pages: ExtractedPage[] = workbook.SheetNames.map((name, idx) => {
    const sheet = workbook.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return { page: idx + 1, text: `# ${name}\n${csv}` };
  });
  return { pages, ocrUsed: false, pageCount: pages.length };
}

async function extractPptx(buffer: Buffer): Promise<ExtractionResult> {
  const zip = new AdmZip(buffer);
  const slideEntries = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => {
      const na = Number(a.entryName.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      const nb = Number(b.entryName.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      return na - nb;
    });

  const pages: ExtractedPage[] = slideEntries.map((entry, idx) => ({
    page: idx + 1,
    text: stripXmlTags(entry.getData().toString("utf8")),
  }));

  return { pages, ocrUsed: false, pageCount: pages.length };
}

async function extractOdt(buffer: Buffer): Promise<ExtractionResult> {
  const zip = new AdmZip(buffer);
  const contentEntry = zip.getEntry("content.xml");
  if (!contentEntry) return { pages: [{ page: 1, text: "" }], ocrUsed: false, pageCount: null };
  const text = stripXmlTags(contentEntry.getData().toString("utf8"));
  return { pages: [{ page: 1, text }], ocrUsed: false, pageCount: null };
}

async function extractRtf(buffer: Buffer): Promise<ExtractionResult> {
  const tmpFile = path.join(os.tmpdir(), `doc-${Date.now()}-${Math.random().toString(36).slice(2)}.rtf`);
  await fs.writeFile(tmpFile, buffer);
  try {
    const { stdout } = await execFileAsync("unrtf", ["--text", tmpFile], { maxBuffer: 20 * 1024 * 1024 });
    const text = stdout.replace(/^###.*$/gm, "").trim();
    return { pages: [{ page: 1, text }], ocrUsed: false, pageCount: null };
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

async function extractCsv(buffer: Buffer): Promise<ExtractionResult> {
  const text = buffer.toString("utf8");
  const parsed = Papa.parse<string[]>(text.trim());
  const rows = parsed.data.map((row: string[]) => row.join(" | "));
  return { pages: [{ page: 1, text: rows.join("\n") }], ocrUsed: false, pageCount: null };
}

async function extractPlainText(buffer: Buffer): Promise<ExtractionResult> {
  return { pages: [{ page: 1, text: buffer.toString("utf8") }], ocrUsed: false, pageCount: null };
}

async function extractImage(buffer: Buffer): Promise<ExtractionResult> {
  const text = await ocrImageBuffer(buffer);
  return { pages: [{ page: 1, text }], ocrUsed: true, pageCount: 1 };
}

export async function extractText(buffer: Buffer, fileName: string): Promise<ExtractionResult> {
  const ext = extensionOf(fileName);
  switch (ext) {
    case "pdf":
      return extractPdf(buffer);
    case "docx":
      return extractDocx(buffer);
    case "doc":
      return extractLegacyDoc(buffer);
    case "xlsx":
    case "xls":
      return extractXlsx(buffer);
    case "pptx":
      return extractPptx(buffer);
    case "odt":
      return extractOdt(buffer);
    case "rtf":
      return extractRtf(buffer);
    case "csv":
      return extractCsv(buffer);
    case "txt":
    case "md":
      return extractPlainText(buffer);
    case "png":
    case "jpg":
    case "jpeg":
    case "tiff":
    case "bmp":
      return extractImage(buffer);
    default:
      throw new Error(`No extractor registered for extension: ${ext}`);
  }
}
