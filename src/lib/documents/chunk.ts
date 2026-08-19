import type { ExtractedPage } from "@/lib/documents/extract";
import { config } from "@/lib/config";

export interface TextChunk {
  content: string;
  page: number | null;
  section: string | null;
  chunkIndex: number;
  tokenCount: number;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function estimateTokenCount(text: string): number {
  // Rough heuristic (~4 chars/token for Latin, ~2-3 for Persian). Good
  // enough for chunk-size budgeting without pulling in a full tokenizer.
  return Math.ceil(text.length / 3);
}

function detectSectionHeading(paragraph: string): string | null {
  const trimmed = paragraph.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return null;
  const looksLikeHeading =
    /^#{1,6}\s/.test(trimmed) ||
    /^[0-9]+[.)]\s/.test(trimmed) ||
    (trimmed === trimmed.toUpperCase() && /[A-Za-z]/.test(trimmed)) ||
    /^(فصل|بخش|ماده|بند)\s/.test(trimmed);
  return looksLikeHeading ? trimmed.replace(/^#{1,6}\s/, "") : null;
}

/**
 * Splits extracted pages into overlapping chunks sized for the local LLM's
 * context window, tracking page number and best-effort section heading for
 * accurate citations.
 */
export function chunkPages(pages: ExtractedPage[]): TextChunk[] {
  const chunkSize = config.rag.chunkSize;
  const overlap = config.rag.chunkOverlap;
  const chunks: TextChunk[] = [];
  let chunkIndex = 0;
  let currentSection: string | null = null;

  for (const page of pages) {
    const text = normalizeWhitespace(page.text);
    if (!text) continue;

    const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
    let buffer = "";

    const flush = () => {
      if (buffer.trim().length === 0) return;
      chunks.push({
        content: buffer.trim(),
        page: page.page,
        section: currentSection,
        chunkIndex: chunkIndex++,
        tokenCount: estimateTokenCount(buffer),
      });
    };

    for (const paragraph of paragraphs) {
      const heading = detectSectionHeading(paragraph);
      if (heading) {
        currentSection = heading;
      }

      if ((buffer + "\n\n" + paragraph).length > chunkSize) {
        flush();
        const overlapText = buffer.slice(Math.max(0, buffer.length - overlap));
        buffer = overlapText ? `${overlapText}\n\n${paragraph}` : paragraph;
      } else {
        buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      }
    }
    flush();
  }

  return chunks;
}
