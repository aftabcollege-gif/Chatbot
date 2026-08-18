import { normalizePersian } from "@/lib/utils";

export interface TextChunk {
  content: string;
  contentNormalized: string;
  chunkIndex: number;
  pageNumber?: number;
  section?: string;
  heading?: string;
  tokenCount: number;
}

const TARGET_CHUNK_SIZE = 512; // target tokens
const OVERLAP_SIZE = 64; // overlap tokens
const MIN_CHUNK_SIZE = 100; // minimum chars

/** Rough token count estimate (1 token ≈ 4 chars for mixed Persian/English) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into overlapping chunks suitable for embedding and RAG.
 * Respects paragraph and sentence boundaries where possible.
 */
export function chunkText(
  text: string,
  options?: {
    targetTokens?: number;
    overlapTokens?: number;
    pageNumber?: number;
    section?: string;
    heading?: string;
  }
): TextChunk[] {
  const targetChars = (options?.targetTokens ?? TARGET_CHUNK_SIZE) * 4;
  const overlapChars = (options?.overlapTokens ?? OVERLAP_SIZE) * 4;

  if (!text || text.trim().length < MIN_CHUNK_SIZE) {
    if (text?.trim()) {
      const normalized = normalizePersian(text.trim());
      return [
        {
          content: text.trim(),
          contentNormalized: normalized,
          chunkIndex: 0,
          pageNumber: options?.pageNumber,
          section: options?.section,
          heading: options?.heading,
          tokenCount: estimateTokens(text.trim()),
        },
      ];
    }
    return [];
  }

  // Split into paragraphs first
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: TextChunk[] = [];
  let currentChunk = "";
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    // If adding this paragraph would exceed target size, flush current chunk
    if (
      currentChunk.length > 0 &&
      currentChunk.length + paragraph.length > targetChars
    ) {
      const content = currentChunk.trim();
      if (content.length >= MIN_CHUNK_SIZE) {
        chunks.push({
          content,
          contentNormalized: normalizePersian(content),
          chunkIndex: chunkIndex++,
          pageNumber: options?.pageNumber,
          section: options?.section,
          heading: options?.heading,
          tokenCount: estimateTokens(content),
        });

        // Keep overlap from end of previous chunk
        const words = currentChunk.split(/\s+/);
        const overlapWords = Math.floor(overlapChars / 8); // avg word ~8 chars
        currentChunk = words.slice(-overlapWords).join(" ") + "\n\n";
      } else {
        currentChunk = "";
      }
    }

    // If single paragraph is too large, split by sentences
    if (paragraph.length > targetChars) {
      const sentences = splitSentences(paragraph);
      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > targetChars && currentChunk.length >= MIN_CHUNK_SIZE) {
          const content = currentChunk.trim();
          chunks.push({
            content,
            contentNormalized: normalizePersian(content),
            chunkIndex: chunkIndex++,
            pageNumber: options?.pageNumber,
            section: options?.section,
            heading: options?.heading,
            tokenCount: estimateTokens(content),
          });
          // Overlap
          const words = currentChunk.split(/\s+/);
          const overlapWords = Math.floor(overlapChars / 8);
          currentChunk = words.slice(-overlapWords).join(" ") + " ";
        }
        currentChunk += sentence + " ";
      }
    } else {
      currentChunk += paragraph + "\n\n";
    }
  }

  // Flush remaining
  if (currentChunk.trim().length >= MIN_CHUNK_SIZE) {
    const content = currentChunk.trim();
    chunks.push({
      content,
      contentNormalized: normalizePersian(content),
      chunkIndex: chunkIndex++,
      pageNumber: options?.pageNumber,
      section: options?.section,
      heading: options?.heading,
      tokenCount: estimateTokens(content),
    });
  } else if (chunks.length === 0 && text.trim().length >= 10) {
    // Safety: always produce at least one chunk
    const content = text.trim();
    chunks.push({
      content,
      contentNormalized: normalizePersian(content),
      chunkIndex: 0,
      pageNumber: options?.pageNumber,
      section: options?.section,
      heading: options?.heading,
      tokenCount: estimateTokens(content),
    });
  }

  return chunks;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?؟\n])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Extract section/heading structure from document text.
 * Detects lines that look like headings (short, followed by content).
 */
export function detectStructure(text: string): { sections: { heading: string; content: string }[] } {
  const lines = text.split("\n");
  const sections: { heading: string; content: string }[] = [];
  let currentHeading = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Detect heading: short line (< 100 chars), possibly followed by colon or numbering
    const isHeading =
      trimmed.length > 0 &&
      trimmed.length < 100 &&
      (
        /^(\d+[\.\-\)]\s+|[۰-۹]+[\.\-\)]\s+|#{1,6}\s+)/.test(trimmed) ||
        (trimmed.length < 60 && lines.indexOf(line) < lines.length - 1 &&
          lines[lines.indexOf(line) + 1]?.trim().length === 0)
      );

    if (isHeading && currentContent.join("").trim().length > 50) {
      if (currentContent.length > 0) {
        sections.push({ heading: currentHeading, content: currentContent.join("\n").trim() });
      }
      currentHeading = trimmed;
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  if (currentContent.join("").trim()) {
    sections.push({ heading: currentHeading, content: currentContent.join("\n").trim() });
  }

  return { sections };
}
