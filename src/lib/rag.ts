import { aiChat, isAIConfigured } from "@/lib/ai";
import { getEmbedding } from "@/lib/embeddings";
import { cosineSearch, type SearchResult } from "@/lib/vector-search";
import { buildExtractiveAnswer } from "@/lib/local-answer";

const SYSTEM_PROMPT = `تو دستیار سازمانی هستی. فقط بر اساس منابع بازیابی‌شده پاسخ بده.
اگر پاسخ در منابع وجود ندارد، صریحاً بگو «در منابع موجود اطلاعات کافی برای پاسخ دقیق پیدا نشد» و حدس نزن.
پاسخ را به زبان سؤال بده. برای ادعاهای مهم، با [منبع 1]، [منبع 2] و ... استناد کن.
هیچ اطلاعاتی خارج از منابع را به عنوان واقعیت سازمانی ارائه نکن.`;

export async function retrieveRag(
  question: string,
  organizationId: string,
  departmentId: string | null,
  userId: string,
  limit = 8
) {
  const embedding = await getEmbedding(question);
  return cosineSearch(embedding, organizationId, departmentId, userId, limit);
}

export async function answerWithRag(
  question: string,
  organizationId: string,
  departmentId: string | null,
  userId: string,
  limit = 8
) {
  const sources = await retrieveRag(question, organizationId, departmentId, userId, limit);
  if (!sources.length) {
    return {
      answer: "در منابع موجود اطلاعات کافی برای پاسخ دقیق پیدا نشد.",
      sources: [],
      confidence: 0,
    };
  }

  // If an external OpenAI-compatible chat model is configured, use it for a
  // more fluent answer. Otherwise (default, zero-setup mode) build a grounded
  // extractive answer locally from the retrieved sources.
  if (isAIConfigured()) {
    try {
      const context = sources
        .map((source, index) => `[منبع ${index + 1}] ${source.title}\n${source.content}`)
        .join("\n\n---\n\n");

      const answer = await aiChat([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `منابع:\n${context}\n\nسؤال: ${question}` },
      ]);

      const confidence = Math.max(0, Math.min(1, Number(sources[0].relevanceScore ?? 0)));
      return { answer, sources, confidence };
    } catch (error) {
      console.error("External chat model failed, falling back to local extractive answer:", error);
    }
  }

  const { answer, confidence } = buildExtractiveAnswer(question, sources);
  return { answer, sources, confidence };
}

export type RAGSource = SearchResult;
