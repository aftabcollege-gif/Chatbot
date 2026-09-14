/**
 * RAG (Retrieval-Augmented Generation) Core
 *
 * OFFLINE-FIRST / NO SILENT CLOUD FALLBACK:
 * - Retrieval runs fully inside PostgreSQL (pgvector HNSW + tsvector GIN).
 * - Generation uses the local LLM (llama.cpp / local GGUF) via the AI
 *   orchestrator. If the local model is unavailable, a grounded extractive
 *   answer is built directly from the retrieved sources — never cloud.
 * - If the embedding model is unavailable, retrieval degrades to
 *   keyword-only search (tsvector) so the system stays usable offline.
 * - Citations come from the retrieval system, NOT from the LLM output.
 */

import { hybridSearch, type RetrievedChunk } from "@/lib/rag/search";
import { llmChat } from "@/lib/ai/orchestrator";
import { queryTerms, searchTokens } from "@/lib/text/normalize";

/** Warn once per process (the portable console is user-visible). */
const warned = new Set<string>();
function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[RAG] ${message}`);
}

function readEnvInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Context budget sized for the default local model (Qwen2.5-1.5B with a
// 4096-token window). Persian text is dense (~2.5 chars/token), so ~5000
// chars of context + system prompt + question stays well inside the window.
const MAX_CONTEXT_CHARS = readEnvInt("RAG_MAX_CONTEXT_CHARS", 5000);
const PER_SOURCE_CHARS = readEnvInt("RAG_CONTEXT_PER_SOURCE_CHARS", 700);

const SYSTEM_PROMPT = `تو دستیار هوش سازمانی هستی. وظیفه‌ی تو پاسخ دادن بر اساس منابع سازمانی بازیابی‌شده است.

قوانین اجباری:
۱. فقط از اطلاعات موجود در منابع پاسخ بده. هیچ اطلاعات خارجی یا حدس را به عنوان واقعیت سازمانی ارائه نده.
۲. اگر پاسخ در منابع وجود ندارد، صریحاً بگو: «اطلاعات کافی در منابع مجاز سازمان برای پاسخ به این پرسش یافت نشد.»
۳. برای هر ادعای مهم با [منبع ۱]، [منبع ۲] و ... استناد کن.
۴. پاسخ را به زبان سؤال (فارسی یا انگلیسی) بده.
۵. منبع/صفحه/سند/سیاست جدیدی نساز — فقط از آنچه در منابع است استفاده کن.
۶. اگر منبع یک «تجربه ثبت‌شده کارکنان» است (نه سند رسمی)، این موضوع را ذکر کن.`;

export interface RagSource {
  id: string; // chunk id
  sourceId: string; // document or experience id
  documentId?: string;
  experienceId?: string;
  sourceType: "document" | "experience";
  sourceTitle: string;
  content: string;
  pageNumber: number | null;
  section: string | null;
  heading: string | null;
  relevanceScore: number;
  excerpt?: string;
}

export interface RAGResult {
  answer: string;
  sources: RagSource[];
  confidence: number;
  usedLLM: boolean;
  ragTrace: {
    question: string;
    retrievedCount: number;
    filteredCount: number;
    topScores: number[];
    contextLength: number;
    responseTimeMs: number;
  };
}

function toRagSource(chunk: RetrievedChunk): RagSource {
  const sourceType = chunk.sourceType;
  return {
    id: chunk.id,
    sourceId: chunk.sourceId,
    documentId: sourceType === "document" ? chunk.sourceId : undefined,
    experienceId: sourceType === "experience" ? chunk.sourceId : undefined,
    sourceType,
    sourceTitle: chunk.sourceTitle,
    content: chunk.content,
    pageNumber: chunk.page,
    section: chunk.section,
    heading: null,
    relevanceScore: chunk.fusedScore,
    excerpt: chunk.content.slice(0, 300),
  };
}

/** Build a context string from retrieved sources, respecting context budget */
function buildContext(sources: RagSource[]): { context: string; usedSources: RagSource[] } {
  let totalChars = 0;
  const usedSources: RagSource[] = [];
  const contextParts: string[] = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const sourceLabel =
      source.sourceType === "experience"
        ? `[تجربه ثبت‌شده ${i + 1}] ${source.sourceTitle}`
        : `[منبع ${i + 1}] ${source.sourceTitle}`;

    const contentPreview = source.content.slice(0, PER_SOURCE_CHARS);
    const part = `${sourceLabel}\n${contentPreview}`;

    if (totalChars + part.length > MAX_CONTEXT_CHARS && usedSources.length > 0) break;

    contextParts.push(part);
    usedSources.push(source);
    totalChars += part.length;
  }

  return { context: contextParts.join("\n\n---\n\n"), usedSources };
}

function splitSentences(text: string): string[] {
  // Split on newlines first so that headings ("ماده ۳: ...") never fuse with
  // the sentence that follows them, then on sentence punctuation.
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?؟…])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Build an extractive, source-grounded answer when the local LLM is not
 * available. Instead of quoting the first 600 chars of the top source (which
 * often starts mid-topic and misses the actual answer), this scores each
 * sentence against the question's significant terms (IDF-weighted, with a
 * preference for the question's distinctive terms) and quotes the best
 * sentences from the top sources — preserving grounding and citations.
 */
function buildExtractiveAnswer(question: string, sources: RagSource[]): string {
  if (sources.length === 0) {
    return "اطلاعات کافی در منابع مجاز سازمان برای پاسخ به این پرسش یافت نشد.";
  }

  const qSet = new Set(queryTerms(question));

  const labelOf = (s: RagSource) =>
    s.sourceType === "experience" ? `تجربه ثبت‌شده «${s.sourceTitle}»` : `منبع «${s.sourceTitle}»`;

  const fallback = (topSource: RagSource) => {
    const excerpt = topSource.content.slice(0, 600);
    return `بر اساس ${labelOf(topSource)}:\n\n${excerpt}`;
  };

  // Candidate pool: sentences from the top sources.
  interface Picked {
    sentence: string;
    source: RagSource;
    score: number;
  }
  const isHeadingLike = (line: string): boolean =>
    line.length <= 60 &&
    (/^#{1,6}\s/.test(line) ||
      /^[0-9۰-۹]+[.)]\s/.test(line) ||
      /^(فصل|بخش|ماده|بند|مطلب)\s/.test(line) ||
      (line === line.toUpperCase() && /[A-Za-z]{3,}/.test(line)));

  const pool: Picked[] = [];
  const tokenSets: Set<string>[] = [];
  for (const source of sources.slice(0, 4)) {
    for (const sentence of splitSentences(source.content)) {
      if (sentence.length < 8) continue;
      if (isHeadingLike(sentence)) continue; // headings are context, not answers
      const toks = new Set(searchTokens(sentence));
      if (toks.size === 0) continue;
      pool.push({ sentence, source, score: 0 });
      tokenSets.push(toks);
    }
  }
  if (pool.length === 0) return fallback(sources[0]);

  // Document frequency of each query term across FULL sentences (headings
  // and fragments under 30 chars don't make a term common).
  const df = new Map<string, number>();
  for (const t of qSet) {
    let n = 0;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].sentence.length >= 30 && tokenSets[i].has(t)) n++;
    }
    if (n > 0) df.set(t, n);
  }

  const scoreSentence = (i: number): number => {
    let score = 0;
    const toks = tokenSets[i];
    for (const t of qSet) {
      if (toks.has(t)) score += 1 / Math.max(1, df.get(t) ?? 1);
    }
    if (score === 0) return 0;
    // Mild completeness bonus (sentences with more context are safer to cite).
    return score + Math.min(1, toks.size / 10) * 0.1;
  };

  // Rare (distinctive) terms — e.g. «استعلاجی» when the user asks about one
  // of several similar topics — must appear in the cited sentence, otherwise
  // a neighboring topic's sentence wins on generic shared words.
  const rarityThreshold = Math.max(2, Math.floor(pool.length / 5));
  const rareTerms = [...qSet].filter((t) => {
    const n = df.get(t);
    return n !== undefined && n <= rarityThreshold;
  });
  let picked = pool
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => rareTerms.length === 0 || rareTerms.some((t) => tokenSets[i].has(t)))
    .map(({ p, i }) => ({ ...p, score: scoreSentence(i) }))
    .filter((p) => p.score > 0);

  if (picked.length === 0) {
    // No sentence covered a distinctive term — best effort over all terms.
    picked = pool
      .map((p, i) => ({ ...p, score: scoreSentence(i) }))
      .filter((p) => p.score > 0);
  }
  picked.sort((a, b) => b.score - a.score);

  if (picked.length === 0) return fallback(sources[0]);

  // Take up to 3, skipping a sentence that duplicates an already-picked one
  // (overlap chunks can carry the same sentence twice).
  const bullets: { text: string; label: string }[] = [];
  for (const p of picked) {
    if (bullets.length >= 3) break;
    const text = p.sentence.replace(/\s+/g, " ");
    if (bullets.some((b) => b.text.includes(text) || text.includes(b.text))) continue;
    bullets.push({ text, label: labelOf(p.source) });
  }
  if (bullets.length === 0) return fallback(sources[0]);

  const answer = bullets
    .map((b) => `• ${b.text}  (${b.label})`)
    .join("\n\n");
  return `${answer}\n\n(توجه: مدل هوش مصنوعی محلی در دسترس نیست. پاسخ بالا مستقیماً از متن منابع استخراج شده است.)`;
}

/**
 * Full RAG pipeline — retrieve, rerank, generate, cite
 *
 * @param question - User's question
 * @param organizationId - Organization scope (REQUIRED — tenant isolation)
 * @param _departmentId - Department scope (kept for API compatibility)
 * @param _userId - Requesting user ID (kept for API compatibility)
 */
export async function answerWithRag(
  question: string,
  organizationId: string,
  _departmentId: string | null,
  _userId: string,
): Promise<RAGResult> {
  const startMs = Date.now();

  // Step 1: Hybrid search (semantic + keyword) — fully in PostgreSQL.
  const chunks = await hybridSearch(organizationId, question);

  if (!chunks.length) {
    return {
      answer: "اطلاعات کافی در منابع مجاز سازمان برای پاسخ به این پرسش یافت نشد.",
      sources: [],
      confidence: 0,
      usedLLM: false,
      ragTrace: {
        question,
        retrievedCount: 0,
        filteredCount: 0,
        topScores: [],
        contextLength: 0,
        responseTimeMs: Date.now() - startMs,
      },
    };
  }

  const sources = chunks.map(toRagSource);

  // Step 2: Build context (with token budget)
  const { context, usedSources } = buildContext(sources);

  const ragTrace = {
    question,
    retrievedCount: chunks.length,
    filteredCount: usedSources.length,
    topScores: chunks.slice(0, 5).map((c) => c.fusedScore),
    contextLength: context.length,
    responseTimeMs: 0,
  };

  // Step 3: Generate answer with local LLM (NEVER cloud)
  try {
    const llmResponse = await llmChat([
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `منابع سازمانی:\n\n${context}\n\n---\n\nسؤال: ${question}`,
      },
    ]);

    ragTrace.responseTimeMs = Date.now() - startMs;

    const confidence = Math.max(
      0,
      Math.min(1, usedSources[0]?.relevanceScore ?? 0),
    );

    return {
      answer: llmResponse.content,
      sources: usedSources,
      confidence,
      usedLLM: true,
      ragTrace,
    };
  } catch (llmError) {
    // LLM unavailable — use extractive answer (NEVER cloud)
    warnOnce("llm-unavailable", `Local LLM unavailable — using extractive answers: ${(llmError as Error)?.message ?? llmError}`);

    ragTrace.responseTimeMs = Date.now() - startMs;

    return {
      answer: buildExtractiveAnswer(question, usedSources),
      sources: usedSources,
      confidence: usedSources[0]?.relevanceScore ?? 0,
      usedLLM: false,
      ragTrace,
    };
  }
}
