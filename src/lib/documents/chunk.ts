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
    /^[0-9۰-۹]+[.)]\s/.test(trimmed) ||
    (trimmed === trimmed.toUpperCase() && /[A-Za-z]/.test(trimmed)) ||
    /^(فصل|بخش|ماده|بند)\s/.test(trimmed);
  return looksLikeHeading ? trimmed.replace(/^#{1,6}\s/, "") : null;
}

/** Split one sentence on punctuation into readable parts. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?؟…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Split an oversized paragraph into pieces of at most `maxChars`:
 * first by sentence boundaries, then by hard word windows with overlap for
 * sentences that are still too long.
 */
function splitOversized(paragraph: string, maxChars: number, overlapChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];

  const sentences = splitSentences(paragraph);
  const pieces: string[] = [];
  let buffer = "";

  const flush = () => {
    if (buffer.trim()) pieces.push(buffer.trim());
    buffer = "";
  };

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      flush();
      // Hard window over the sentence with word-boundary overlap.
      const words = sentence.split(" ");
      let windowStart = 0;
      while (windowStart < words.length) {
        let end = windowStart;
        let len = 0;
        while (end < words.length && len + words[end].length + 1 <= maxChars) {
          len += words[end].length + 1;
          end++;
        }
        pieces.push(words.slice(windowStart, end).join(" "));
        // Next window starts so that ~overlapChars of words carry over,
        // aligned to a word boundary.
        let overlapWords = 0;
        let overlapLen = 0;
        while (
          end - overlapWords - 1 > windowStart &&
          overlapLen + words[end - overlapWords - 1].length < overlapChars
        ) {
          overlapWords++;
          overlapLen += words[end - overlapWords - 1].length;
        }
        windowStart = end - overlapWords;
        if (windowStart === end) windowStart = end + 1;
      }
      continue;
    }
    if ((buffer ? buffer.length + 1 + sentence.length : sentence.length) > maxChars) {
      flush();
    }
    buffer = buffer ? `${buffer} ${sentence}` : sentence;
  }
  flush();
  return pieces;
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
      buffer = "";
    };

    const overlapTail = (prev: string): string => {
      // Carry over the tail of the previous chunk to a word boundary so the
      // overlap never starts in the middle of a word.
      if (prev.length <= overlap) return prev;
      const tail = prev.slice(prev.length - overlap);
      const cut = tail.search(/\s/);
      return cut >= 0 ? tail.slice(cut + 1) : tail;
    };

    for (const paragraph of paragraphs) {
      const heading = detectSectionHeading(paragraph);
      if (heading) {
        currentSection = heading;
      }

      if (paragraph.length > chunkSize) {
        // Oversized paragraph (common in PDFs with one long block): flush the
        // open buffer, then index each sentence/word window on its own so the
        // answer can be located precisely.
        flush();
        const pieces = splitOversized(paragraph, chunkSize, overlap);
        let carry = "";
        for (const piece of pieces) {
          const candidate = carry ? `${carry}\n${piece}` : piece;
          if (buffer && (buffer + "\n\n" + candidate).length > chunkSize) {
            flush();
            carry = overlapTail(buffer);
          }
          buffer = buffer ? `${buffer}\n\n${candidate}` : candidate;
        }
        continue;
      }

      if ((buffer + "\n\n" + paragraph).length > chunkSize) {
        const prev = buffer;
        flush();
        const tail = overlapTail(prev);
        buffer = tail ? `${tail}\n\n${paragraph}` : paragraph;
      } else {
        buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      }
    }
    flush();
  }

  return chunks;
}
