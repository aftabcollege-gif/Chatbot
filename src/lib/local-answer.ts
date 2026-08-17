import { tokenize, splitSentences } from "@/lib/local-embeddings";
import type { SearchResult } from "@/lib/vector-search";

export interface LocalAnswer {
  answer: string;
  confidence: number;
}

const NO_ANSWER =
  "در منابع موجود اطلاعات کافی برای پاسخ دقیق پیدا نشد.";

/**
 * Builds a grounded, extractive answer directly from retrieved sources
 * without calling any external LLM. This keeps the chatbot fully
 * functional offline: it selects the sentences most relevant to the
 * question from the top-ranked sources and stitches them together with
 * citation markers, following the same "answer only from sources" policy
 * used when an external model is configured.
 */
export function buildExtractiveAnswer(question: string, sources: SearchResult[]): LocalAnswer {
  if (!sources.length) {
    return { answer: NO_ANSWER, confidence: 0 };
  }

  const questionTokens = tokenize(question);
  const questionSet = new Set(questionTokens);

  type Candidate = { sentence: string; score: number; sourceIndex: number };
  const candidates: Candidate[] = [];

  sources.forEach((source, sourceIndex) => {
    const sentences = splitSentences(source.content).slice(0, 40);
    for (const sentence of sentences) {
      const sentenceTokens = tokenize(sentence);
      if (!sentenceTokens.length) continue;
      const overlap = sentenceTokens.filter((token) => questionSet.has(token)).length;
      const lexicalPart = overlap / Math.sqrt(sentenceTokens.length);
      const score = lexicalPart + Number(source.relevanceScore ?? 0) * 0.6;
      candidates.push({ sentence, score, sourceIndex });
    }
  });

  candidates.sort((a, b) => b.score - a.score);

  let picked = candidates.filter((c) => c.score > 0.15).slice(0, 5);
  if (!picked.length) {
    // No sentence had meaningful overlap with the question; still ground the
    // answer in the top source instead of guessing.
    const fallbackSentence =
      splitSentences(sources[0].content)[0] ?? sources[0].content.slice(0, 400);
    picked = [{ sentence: fallbackSentence, score: 0, sourceIndex: 0 }];
  }

  // Keep original reading order within each source, remove duplicates.
  picked.sort((a, b) => a.sourceIndex - b.sourceIndex);
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const item of picked) {
    const key = item.sentence.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    lines.push(`${key} [منبع ${item.sourceIndex + 1}]`);
  }

  const bestScore = Math.max(0, Math.min(1, Number(sources[0].relevanceScore ?? 0)));
  const answer = lines.join(" ");

  return {
    answer: answer || NO_ANSWER,
    confidence: bestScore,
  };
}
