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

const MAX_CONTEXT_CHARS = 8000; // approximately 2000 tokens of context

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

    const contentPreview = source.content.slice(0, 1200);
    const part = `${sourceLabel}\n${contentPreview}`;

    if (totalChars + part.length > MAX_CONTEXT_CHARS && usedSources.length > 0) break;

    contextParts.push(part);
    usedSources.push(source);
    totalChars += part.length;
  }

  return { context: contextParts.join("\n\n---\n\n"), usedSources };
}

/** Build extractive answer when LLM is not available */
function buildExtractiveAnswer(sources: RagSource[]): string {
  const topSource = sources[0];
  if (!topSource) {
    return "اطلاعات کافی در منابع مجاز سازمان برای پاسخ به این پرسش یافت نشد.";
  }

  const excerpt = topSource.content.slice(0, 600);
  const sourceLabel =
    topSource.sourceType === "experience"
      ? `تجربه ثبت‌شده: «${topSource.sourceTitle}»`
      : `منبع: «${topSource.sourceTitle}»`;

  return `بر اساس ${sourceLabel}:\n\n${excerpt}\n\n(توجه: مدل هوش مصنوعی محلی در دسترس نیست. این پاسخ مستقیماً از متن منابع استخراج شده است.)`;
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
    console.error("[RAG] Local LLM unavailable, using extractive answer:", llmError);

    ragTrace.responseTimeMs = Date.now() - startMs;

    return {
      answer: buildExtractiveAnswer(usedSources),
      sources: usedSources,
      confidence: usedSources[0]?.relevanceScore ?? 0,
      usedLLM: false,
      ragTrace,
    };
  }
}
