/**
 * Local Embedding — Offline Hashing-Trick Vectorizer
 *
 * IMPORTANT: This is a FALLBACK-ONLY implementation using a hashing trick
 * (similar to scikit-learn's HashingVectorizer). It provides lexical similarity,
 * NOT semantic similarity. For production-quality RAG, configure Ollama with
 * nomic-embed-text or mxbai-embed-large (see OLLAMA_BASE_URL in .env).
 *
 * This fallback ensures the system works without any external dependency,
 * but RAG quality will be based on keyword overlap only.
 */

export const LOCAL_EMBEDDING_DIMENSIONS = parseInt(
  process.env.EMBEDDING_DIMENSIONS ?? "768"
);

const STOPWORDS_FA = new Set([
  "از", "به", "با", "را", "که", "در", "این", "آن", "است", "هست", "بود",
  "شد", "برای", "یا", "و", "تا", "می", "های", "ها", "کرد", "کند", "شود",
  "شده", "هم", "نیز", "اگر", "اما", "ولی", "چون", "زیرا", "پس", "بر",
  "هر", "چه", "که", "دیگر", "بین", "روی", "زیر", "کنار", "طبق", "حتی",
]);

const STOPWORDS_EN = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "of", "to",
  "in", "on", "and", "or", "for", "with", "that", "this", "it", "as", "by",
  "at", "from", "we", "our", "us", "you", "your", "they", "their", "he",
  "she", "his", "her", "its", "not", "no", "but", "if", "then",
]);

export function tokenize(text: string): string[] {
  if (!text) return [];
  const normalized = text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u200c\u200f\u200e]/g, " ")
    .replace(/[یي]/g, "ی")
    .replace(/[کك]/g, "ک")
    .replace(/[ۀة]/g, "ه");

  const raw = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  return raw.filter(
    (token) =>
      token.length > 1 &&
      !STOPWORDS_FA.has(token) &&
      !STOPWORDS_EN.has(token)
  );
}

function hashToken(token: string): number {
  // FNV-1a 32-bit hash
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function localEmbedding(
  text: string,
  dimensions = LOCAL_EMBEDDING_DIMENSIONS
): number[] {
  const vector = new Array(dimensions).fill(0);
  const tokens = tokenize(text);
  if (!tokens.length) return vector;

  // Unigrams
  for (const token of tokens) {
    const hash = hashToken(token);
    const index = hash % dimensions;
    const sign = hash & 1 ? 1 : -1;
    vector[index] += sign;
  }

  // Bigrams (weighted lower than unigrams)
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]}_${tokens[i + 1]}`;
    const hash = hashToken(bigram);
    const index = hash % dimensions;
    const sign = hash & 1 ? 1 : -1;
    vector[index] += sign * 0.5;
  }

  // L2 normalize
  const norm =
    Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
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

/** Simple lexical overlap score (0..1) */
export function lexicalScore(queryTokens: string[], text: string): number {
  const candidateTokens = tokenize(text);
  if (!queryTokens.length || !candidateTokens.length) return 0;
  const candidateSet = new Set(candidateTokens);
  const overlap = queryTokens.filter((t) => candidateSet.has(t)).length;
  return overlap / Math.sqrt(candidateTokens.length);
}
