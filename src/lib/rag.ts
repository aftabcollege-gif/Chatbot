import { aiChat, createEmbedding } from "@/lib/ai";
import { cosineSearch, type SearchResult } from "@/lib/vector-search";

const SYSTEM_PROMPT = `تو دستیار سازمانی هستی. فقط بر اساس منابع بازیابی‌شده پاسخ بده.
اگر پاسخ در منابع وجود ندارد، صریحاً بگو «در منابع موجود اطلاعات کافی برای پاسخ دقیق پیدا نشد» و حدس نزن.
پاسخ را به زبان سؤال بده. برای ادعاهای مهم، با [منبع 1]، [منبع 2] و ... استناد کن.
هیچ اطلاعاتی خارج از منابع را به عنوان واقعیت سازمانی ارائه نکن.`;

export async function retrieveRag(question: string, organizationId: string, departmentId: string | null, userId: string, limit = 8) {
  const embedding = await createEmbedding(question);
  return cosineSearch(embedding, organizationId, departmentId, userId, limit);
}

export async function answerWithRag(question: string, organizationId: string, departmentId: string | null, userId: string, limit = 8) {
  const sources = await retrieveRag(question, organizationId, departmentId, userId, limit);
  if (!sources.length) {
    return {
      answer: "در منابع موجود اطلاعات کافی برای پاسخ دقیق پیدا نشد.",
      sources: [],
      confidence: 0,
    };
  }

  const context = sources.map((source, index) =>
    `[منبع ${index + 1}] ${source.title}\n${source.content}`
  ).join("\n\n---\n\n");

  const answer = await aiChat([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `منابع:\n${context}\n\nسؤال: ${question}` },
  ]);

  const confidence = Math.max(0, Math.min(1, Number(sources[0].relevanceScore ?? 0)));
  return { answer, sources, confidence };
}

export type RAGSource = SearchResult;
