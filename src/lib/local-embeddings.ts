/**
 * Fully offline, dependency-free "embedding" and lexical utilities.
 *
 * The project must work without any external AI provider, API key, or
 * installed extension (such as pgvector). To achieve semantic-ish search
 * without a real embedding model, we use a deterministic hashing-trick
 * vectorizer (similar to scikit-learn's HashingVectorizer): every token
 * (and bigram) is hashed into a fixed-size vector. Cosine similarity between
 * these vectors correlates well with lexical/term overlap, which is enough
 * to power retrieval-augmented answers for an internal knowledge base.
 */

export const LOCAL_EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS ?? "512");

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "of", "to", "in", "on",
  "and", "or", "for", "with", "that", "this", "it", "as", "by", "at",
  "از", "به", "با", "را", "که", "در", "این", "آن", "است", "هست", "بود", "شد", "برای",
  "یا", "و", "تا", "می", "های", "ها", "کرد", "کند", "شود", "شده", "هم", "نیز", "اگر",
]);

export function tokenize(text: string): string[] {
  if (!text) return [];
  const normalized = text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u200c\u200f\u200e]/g, " ")
    .replace(/[یي]/g, "ی")
    .replace(/[کك]/g, "ک");
  const raw = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  return raw.filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function localEmbedding(text: string, dimensions = LOCAL_EMBEDDING_DIMENSIONS): number[] {
  const vector = new Array(dimensions).fill(0);
  const tokens = tokenize(text);
  if (!tokens.length) return vector;

  for (const token of tokens) {
    const hash = hashToken(token);
    const index = hash % dimensions;
    const sign = hash & 1 ? 1 : -1;
    vector[index] += sign;
  }

  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]}_${tokens[i + 1]}`;
    const hash = hashToken(bigram);
    const index = hash % dimensions;
    const sign = hash & 1 ? 1 : -1;
    vector[index] += sign * 0.5;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length) return 0;
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function splitSentences(text: string): string[] {
  if (!text) return [];
  return text
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?؟\n])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** Simple lexical overlap score between a query and a piece of text (0..1). */
export function lexicalScore(query: string[], candidate: string): number {
  const candidateTokens = tokenize(candidate);
  if (!query.length || !candidateTokens.length) return 0;
  const candidateSet = new Set(candidateTokens);
  const overlap = query.filter((token) => candidateSet.has(token)).length;
  return overlap / Math.sqrt(candidateTokens.length);
}
