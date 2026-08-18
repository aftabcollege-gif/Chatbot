/**
 * Universal Document Text Extraction
 *
 * Directive §25 — Supported formats:
 * DOCX, DOC, ODT, XLSX, XLS, ODS, CSV, TSV, PPTX, PPT, ODP,
 * PDF (text + scanned/OCR), RTF, TXT, MD, HTML, XML, JSON, YAML,
 * EML, MSG, JPG, PNG, TIFF, BMP, WEBP (OCR), ZIP (extract + process)
 *
 * Each parser implements the DocumentParser interface.
 * Adding new formats requires ONLY implementing the interface — no pipeline changes.
 */

export interface ParseResult {
  text: string;
  pageCount?: number;
  metadata?: Record<string, unknown>;
  hasOCR?: boolean;
  language?: string;
}

export interface DocumentParser {
  readonly supportedMimes: string[];
  readonly supportedExtensions: string[];
  parse(buffer: Buffer, filename: string): Promise<ParseResult>;
}

/** Get file extension from filename */
export function getExtension(filename: string): string {
  return filename.toLowerCase().split(".").pop() ?? "";
}

/** Get mime type from filename extension */
export function getMimeFromExtension(ext: string): string {
  const mimeMap: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ppt: "application/vnd.ms-powerpoint",
    odt: "application/vnd.oasis.opendocument.text",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    odp: "application/vnd.oasis.opendocument.presentation",
    txt: "text/plain",
    md: "text/markdown",
    html: "text/html",
    htm: "text/html",
    xml: "text/xml",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    json: "application/json",
    yaml: "text/yaml",
    yml: "text/yaml",
    rtf: "application/rtf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    tiff: "image/tiff",
    tif: "image/tiff",
    bmp: "image/bmp",
    webp: "image/webp",
    zip: "application/zip",
    eml: "message/rfc822",
  };
  return mimeMap[ext] ?? "application/octet-stream";
}

// ============================================================
// Plain text parser
// ============================================================
class PlainTextParser implements DocumentParser {
  supportedMimes = ["text/plain", "text/markdown", "text/csv", "text/tab-separated-values",
                    "application/json", "text/yaml", "application/rtf"];
  supportedExtensions = ["txt", "md", "csv", "tsv", "json", "yaml", "yml", "rtf"];

  async parse(buffer: Buffer): Promise<ParseResult> {
    const text = buffer.toString("utf8");
    return { text, pageCount: 1 };
  }
}

// ============================================================
// HTML/XML parser
// ============================================================
class HtmlParser implements DocumentParser {
  supportedMimes = ["text/html", "text/xml", "application/xml"];
  supportedExtensions = ["html", "htm", "xml"];

  async parse(buffer: Buffer): Promise<ParseResult> {
    const raw = buffer.toString("utf8");
    // Strip HTML/XML tags
    const text = raw
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
    return { text, pageCount: 1 };
  }
}

// ============================================================
// PDF parser
// ============================================================
class PdfParser implements DocumentParser {
  supportedMimes = ["application/pdf"];
  supportedExtensions = ["pdf"];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require("pdf-parse");
      const result = await pdfParse(buffer);
      const text = (result.text as string) ?? "";

      // If PDF has very little text, it might be scanned — flag for OCR
      const wordCount = text.trim().split(/\s+/).length;
      const hasOCR = wordCount < 50 && buffer.length > 50000;

      return {
        text,
        pageCount: result.numpages as number,
        hasOCR,
        metadata: { pdfInfo: result.info },
      };
    } catch (err) {
      throw new Error(`PDF extraction failed for ${filename}: ${err}`);
    }
  }
}

// ============================================================
// DOCX parser
// ============================================================
class DocxParser implements DocumentParser {
  supportedMimes = [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
  ];
  supportedExtensions = ["docx", "doc"];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return {
        text: (result.value as string) ?? "",
        pageCount: 1,
      };
    } catch (err) {
      throw new Error(`DOCX extraction failed for ${filename}: ${err}`);
    }
  }
}

// ============================================================
// XLSX/XLS parser
// ============================================================
class ExcelParser implements DocumentParser {
  supportedMimes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/vnd.oasis.opendocument.spreadsheet",
  ];
  supportedExtensions = ["xlsx", "xls", "ods", "csv"];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    const ext = getExtension(filename);

    if (ext === "csv") {
      return { text: buffer.toString("utf8"), pageCount: 1 };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ExcelJS = require("exceljs");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);

      const textParts: string[] = [];
      workbook.eachSheet((sheet: { name: string; eachRow: (fn: (row: { values: unknown[] }) => void) => void }) => {
        textParts.push(`\n=== Sheet: ${sheet.name} ===\n`);
        sheet.eachRow((row: { values: unknown[] }) => {
          const cells = (row.values as unknown[])
            .slice(1) // exceljs row.values[0] is undefined
            .map((cell) => (cell !== null && cell !== undefined ? String(cell) : ""))
            .join("\t");
          if (cells.trim()) textParts.push(cells);
        });
      });

      return { text: textParts.join("\n"), pageCount: 1 };
    } catch (err) {
      throw new Error(`Excel extraction failed for ${filename}: ${err}`);
    }
  }
}

// ============================================================
// PPTX parser (basic — extracts slide text)
// ============================================================
class PptxParser implements DocumentParser {
  supportedMimes = [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
  ];
  supportedExtensions = ["pptx", "ppt"];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const JSZip = require("jszip");
      const zip = await JSZip.loadAsync(buffer);
      const textParts: string[] = [];

      // Extract text from slide XML files
      const slideFiles = Object.keys(zip.files).filter((name) =>
        name.match(/^ppt\/slides\/slide\d+\.xml$/)
      );
      slideFiles.sort();

      for (const slideFile of slideFiles) {
        const xml = await zip.files[slideFile].async("string");
        // Extract text between <a:t> tags
        const matches = xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) ?? [];
        const slideText = matches
          .map((m: string) => m.replace(/<[^>]+>/g, ""))
          .join(" ");
        if (slideText.trim()) textParts.push(slideText.trim());
      }

      return {
        text: textParts.join("\n\n"),
        pageCount: slideFiles.length,
      };
    } catch (err) {
      throw new Error(`PPTX extraction failed for ${filename}: ${err}`);
    }
  }
}

// ============================================================
// Image parser (OCR via Tesseract)
// ============================================================
class ImageParser implements DocumentParser {
  supportedMimes = ["image/jpeg", "image/png", "image/tiff", "image/bmp", "image/webp"];
  supportedExtensions = ["jpg", "jpeg", "png", "tiff", "tif", "bmp", "webp"];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    try {
      const Tesseract = await import("tesseract.js");
      const { data } = await Tesseract.recognize(buffer, "fas+eng", {
        logger: () => {}, // suppress progress logs
      });
      return {
        text: data.text ?? "",
        pageCount: 1,
        hasOCR: true,
      };
    } catch (err) {
      throw new Error(`OCR extraction failed for ${filename}: ${err}`);
    }
  }
}

// ============================================================
// ZIP parser (extract and process contained files)
// ============================================================
class ZipParser implements DocumentParser {
  supportedMimes = ["application/zip", "application/x-zip-compressed"];
  supportedExtensions = ["zip"];

  async parse(buffer: Buffer, filename: string): Promise<ParseResult> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const JSZip = require("jszip");
      const zip = await JSZip.loadAsync(buffer);

      const textParts: string[] = [];
      let processedCount = 0;
      const MAX_FILES_IN_ZIP = 50; // Zip bomb protection

      for (const [name, file] of Object.entries(zip.files)) {
        if (processedCount >= MAX_FILES_IN_ZIP) break;
        const zipFile = file as { dir: boolean; async: (type: string) => Promise<Buffer> };
        if (zipFile.dir) continue;

        // Depth protection — skip nested ZIPs
        if (name.toLowerCase().endsWith(".zip")) continue;

        try {
          const fileBuffer = await zipFile.async("nodebuffer");
          const fileExt = getExtension(name);
          const result = await extractText(fileBuffer, name);
          if (result.text.trim()) {
            textParts.push(`\n=== ${name} ===\n${result.text}`);
            processedCount++;
          }
        } catch {
          // Skip unparseable files in ZIP
          continue;
        }
      }

      return {
        text: textParts.join("\n\n"),
        pageCount: processedCount,
        metadata: { zipContainedFiles: processedCount },
      };
    } catch (err) {
      throw new Error(`ZIP extraction failed for ${filename}: ${err}`);
    }
  }
}

// ============================================================
// Parser Registry
// ============================================================
const PARSERS: DocumentParser[] = [
  new PlainTextParser(),
  new HtmlParser(),
  new PdfParser(),
  new DocxParser(),
  new ExcelParser(),
  new PptxParser(),
  new ImageParser(),
  new ZipParser(),
];

function findParser(filename: string, mimeType?: string): DocumentParser | null {
  const ext = getExtension(filename);
  for (const parser of PARSERS) {
    if (parser.supportedExtensions.includes(ext)) return parser;
    if (mimeType && parser.supportedMimes.includes(mimeType)) return parser;
  }
  return null;
}

/**
 * Extract text from a document buffer.
 * Throws if format is not supported.
 */
export async function extractText(
  buffer: Buffer,
  filename: string,
  mimeType?: string
): Promise<ParseResult> {
  const parser = findParser(filename, mimeType);
  if (!parser) {
    throw new Error(
      `فرمت فایل «${getExtension(filename)}» پشتیبانی نمی‌شود. ` +
        `فرمت‌های مجاز: PDF, DOCX, DOC, XLSX, XLS, PPTX, CSV, TXT, MD, HTML, XML, JSON, ZIP, JPG, PNG, TIFF`
    );
  }
  return parser.parse(buffer, filename);
}

/** Check if a file extension is supported */
export function isSupportedFormat(filename: string, mimeType?: string): boolean {
  return findParser(filename, mimeType) !== null;
}
