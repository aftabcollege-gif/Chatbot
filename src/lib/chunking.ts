export type TextChunk = { content: string; chunkIndex: number };

export function splitIntoChunks(text: string, size = 1200, overlap = 180): TextChunk[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!normalized) return [];
  if (overlap >= size) throw new Error("Chunk overlap must be smaller than chunk size");

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;
  while (start < normalized.length) {
    let end = Math.min(start + size, normalized.length);
    if (end < normalized.length) {
      const boundary = normalized.lastIndexOf("\n", end);
      if (boundary > start + Math.floor(size * 0.55)) end = boundary;
    }
    const content = normalized.slice(start, end).trim();
    if (content) chunks.push({ content, chunkIndex: index++ });
    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
