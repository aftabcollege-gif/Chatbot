/**
 * RAG (Retrieval-Augmented Generation) Core
 *
 * DIRECTIVE §15 COMPLIANCE: NO SILENT CLOUD FALLBACK.
 * If local LLM is unavailable, extractive answer is used — never cloud.
 *
 * DIRECTIVE §30 COMPLIANCE:
 * - Citations are built from retrieval system, NOT from LLM output
 * - LLM is grounded: only responds based on retrieved evidence
 * - If evidence is insufficient, system says so explicitly
 * - Full trace: Question → Permissions → Retrieved Chunks → Scores → Context → LLM → Answer → Citations
 */

import { llmChat } from "@/lib/ai/orchestrator";
import { getEmbedding } from "@/lib/ai/orchestrator";
import { hybridSearch, type SearchResult } from "@/lib/vector-search";

const SYSTEM_PROMPT = `تو دستیار هوش سازمانی هستی. وظیفه‌ی تو پاسخ دادن بر اساس منابع سازمانی بازیابی‌شده است.

قوانین اجباری:
۱. فقط از اطلاعات موجود در منابع پاسخ بده. هیچ اطلاعات خارجی یا حدس را به عنوان واقعیت سازمانی ارائه نده.
۲. اگر پاسخ در منابع وجود ندارد، صریحاً بگو: «اطلاعات کافی در منابع مجاز سازمان برای پاسخ به این پرسش یافت نشد.»
۳. برای هر ادعای مهم با [منبع ۱]، [منبع ۲] و ... استناد کن.
۴. پاسخ را به زبان سؤال (فارسی یا انگلیسی) بده.
۵. منبع/صفحه/سند/سیاست جدیدی نساز — فقط از آنچه در منابع است استفاده کن.
۶. اگر منبع یک «تجربه ثبت‌شده کارکنان» است (نه سند رسمی)، این موضوع را ذکر کن.`;

export interface RAGResult {
  answer: string;
  sources: SearchResult[];
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

/** Build a context string from retrieved sources, respecting context budget */
function buildContext(sources: SearchResult[]): { context: string; usedSources: SearchResult[] } {
  let totalChars = 0;
  const usedSources: SearchResult[] = [];
  const contextParts: string[] = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const sourceLabel =
      source.sourceType === "experience"
        ? `[تجربه ثبت‌شده ${i + 1}] ${source.title}`
        : `[منبع ${i + 1}] ${source.title}`;

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
function buildExtractiveAnswer(query: string, sources: SearchResult[]): string {
  if (!sources.length) {
    return "اطلاعات کافی در منابع مجاز سازمان برای پاسخ به این پرسش یافت نشد.";
  }

  const topSource = sources[0];
  const excerpt = topSource.content.slice(0, 600);
  const sourceLabel =
    topSource.sourceType === "experience"
      ? `تجربه ثبت‌شده: «${topSource.title}»`
      : `منبع: «${topSource.title}»`;

  return `بر اساس ${sourceLabel}:\n\n${excerpt}\n\n(توجه: مدل هوش مصنوعی محلی در دسترس نیست. این پاسخ مستقیماً از متن منابع استخراج شده است.)`;
}

/**
 * Full RAG pipeline — retrieve, rerank, generate, cite
 *
 * @param question - User's question
 * @param organizationId - Organization scope (REQUIRED — tenant isolation)
 * @param departmentId - Department scope (optional)
 * @param userId - Requesting user ID (for permission-aware retrieval)
 */
export async function answerWithRag(
  question: string,
  organizationId: string,
  departmentId: string | null,
  userId: string,
  options?: {
    limit?: number;
    sourceTypes?: Array<"document" | "knowledge" | "experience">;
  }
): Promise<RAGResult> {
  const startMs = Date.now();
  const limit = options?.limit ?? parseInt(process.env.RAG_TOP_K ?? "8");

  // Step 1: Embed the question
  const queryEmbedding = await getEmbedding(question);

  // Step 2: Hybrid search (semantic + keyword) with permission scope
  const allSources = await hybridSearch(queryEmbedding, question, {
    organizationId,
    departmentId,
    userId,
    limit: limit * 2, // retrieve more, then filter/rerank
    sourceTypes: options?.sourceTypes,
  });

  if (!allSources.length) {
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

  // Step 3: Build context (with token budget)
  const { context, usedSources } = buildContext(allSources);

  const ragTrace = {
    question,
    retrievedCount: allSources.length,
    filteredCount: usedSources.length,
    topScores: allSources.slice(0, 5).map((s) => s.combinedScore ?? s.relevanceScore),
    contextLength: context.length,
    responseTimeMs: 0,
  };

  // Step 4: Generate answer with local LLM (NEVER cloud)
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
      Math.min(1, usedSources[0]?.combinedScore ?? usedSources[0]?.relevanceScore ?? 0)
    );

    return {
      answer: llmResponse.content,
      sources: usedSources.slice(0, limit),
      confidence,
      usedLLM: true,
      ragTrace,
    };
  } catch (llmError) {
    // LLM unavailable — use extractive answer (NEVER cloud)
    console.error("[RAG] Local LLM unavailable, using extractive answer:", llmError);

    ragTrace.responseTimeMs = Date.now() - startMs;

    return {
      answer: buildExtractiveAnswer(question, usedSources),
      sources: usedSources.slice(0, limit),
      confidence: usedSources[0]?.relevanceScore ?? 0,
      usedLLM: false,
      ragTrace,
    };
  }
}

export type { SearchResult as RAGSource };
