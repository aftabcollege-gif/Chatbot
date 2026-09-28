/**
 * Resolve a follow-up question against the conversation **before** retrieving.
 *
 * A user rarely repeats the subject: after «کارکنان چند روز مرخصی استحقاقی
 * دارند؟» the next message is «برای مدیران هم همین‌طور است؟». Sent to the
 * search index on its own, that message carries no subject at all, so the
 * hybrid search returns the wrong chunks (or nothing) even though the answer is
 * in the knowledge base.
 *
 * `resolveStandaloneQuery()` turns such a message into a self-contained query:
 *
 * 1. when the local LLM is available it is asked (in Persian) to rewrite the
 *    last user message using the previous turns — a language model is the only
 *    component that resolves pronouns and elided subjects reliably;
 * 2. without the LLM a conservative heuristic applies (same rules as the
 *    offline Windows app): a question that only refers back to the previous
 *    turn — reference marker («همین‌طور»، «بیشتر»، «درباره آن» …), conjunction
 *    opener («و …»، «اما …»), anaphoric opener («چطور»، «چرا» …) or a very short
 *    question that shares a word with the previous one — is combined with that
 *    previous question. A topic change keeps its own query, so a new subject
 *    never inherits the old one.
 *
 * The rewritten query is used for **retrieval only**; the answer is still
 * generated from the user's own wording plus the real conversation history.
 */

import { searchTokens } from "@/lib/text/normalize";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface QueryResolution {
  /** Query to hand to the retriever (the user's own text when unchanged). */
  query: string;
  /** True when the query differs from the user's message. */
  rewritten: boolean;
  /** How the query was produced — surfaced in the UI/trace. */
  method: "llm" | "heuristic" | "none";
}

/** Words that cannot stand alone: they refer back to something already said. */
const REFERENCE_MARKERS = [
  "همینطور",
  "همین",
  "همان",
  "آنها",
  "آنرا",
  "اینها",
  "دربارهاش",
  "درباره آن",
  "مورد آن",
  "موردش",
  "بیشتر",
  "ادامه",
  "توضیح بده",
  "توضیح دهید",
  "مثال بزن",
  "یعنی",
  "ایشان",
];

/** A message that starts with one of these simply continues the previous turn. */
const CONJUNCTION_STARTS = ["و ", "اما ", "پس ", "خب ", "نیز ", "در این مورد", "درباره این"];

/** Short questions opening with these words have no subject of their own. */
const ANAPHORIC_OPENERS = ["چطور", "چگونه", "چرا", "یعنی", "بیشتر", "ادامه بده"];

/** Very short questions usually omit their subject. */
const SHORT_QUESTION_WORDS = 4;

/** How many previous turns are handed to the rewriter. */
const HISTORY_TURNS = 6;

const REWRITE_PROMPT_FA = `تو یک دستیار بازنویسی پرسش هستی. با توجه به گفت‌وگوی زیر، آخرین پیام کاربر را به یک پرسش مستقل و کامل به فارسی بازنویسی کن؛ طوری که بدون خواندن گفت‌وگو هم موضوع آن روشن باشد. قواعد:
- فقط خودِ پرسش بازنویسی‌شده را بنویس؛ هیچ توضیح، مقدمه یا نقل‌قولی اضافه نکن.
- اگر آخرین پیام کاربر خودش مستقل و کامل است، همان را بی‌کم‌وکاست برگردان.
- زمان، عدد یا شرطی از خودت اضافه نکن.`;

const REWRITE_PROMPT_EN = `You rewrite questions. Given the conversation below, rewrite the user's last message as a standalone question that makes sense without the conversation. Output only the rewritten question, with no explanation. If the last message is already standalone, return it unchanged. Do not invent facts.`;

/** ZWNJ-free copy, so «همین‌طور» and «همینطور» match the same marker. */
function compact(text: string): string {
  return (text || "").replace(/[\u200c\u200d\u200e\u200f]/g, "").trim();
}

/** Meaningful words of a text (stop-words and single letters removed). */
export function contentWords(text: string): Set<string> {
  return new Set(searchTokens(text ?? ""));
}

function hasReferenceMarker(text: string): boolean {
  const flat = compact(text);
  const spaced = ` ${flat} `;
  return REFERENCE_MARKERS.some((marker) => spaced.includes(compact(marker)));
}

/** The last user message before the current one. */
export function lastUserQuestion(history: ChatTurn[]): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].role === "user") return (history[i].content ?? "").trim();
  }
  return "";
}

/** True when *question* only makes sense together with the previous turn. */
export function looksLikeFollowUp(question: string, history: ChatTurn[] = []): boolean {
  const text = (question ?? "").trim();
  if (!text) return false;
  if (hasReferenceMarker(text)) return true;
  if (CONJUNCTION_STARTS.some((opener) => text.startsWith(opener))) return true;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 6 && ANAPHORIC_OPENERS.some((opener) => text.startsWith(opener))) return true;

  const previous = lastUserQuestion(history);
  const sharesTopic =
    previous.length > 0
      ? [...contentWords(text)].some((word) => contentWords(previous).has(word))
      : false;
  if (words.length <= SHORT_QUESTION_WORDS && (sharesTopic || !previous)) return true;

  // «مدیران چطور؟» — short and anaphoric, even without a shared word.
  if (words.length <= SHORT_QUESTION_WORDS && ANAPHORIC_OPENERS.some((opener) => text.includes(opener))) {
    return true;
  }
  return false;
}

/** Combine the follow-up with the previous question (no LLM required). */
export function heuristicQuery(question: string, history: ChatTurn[]): string {
  const text = (question ?? "").trim();
  const previous = lastUserQuestion(history);
  if (!previous || previous === text) return text;
  if (!looksLikeFollowUp(text, history)) return text;
  return `${previous} — ${text}`;
}

function asPrompt(history: ChatTurn[], question: string, language: string): { role: "system" | "user"; content: string }[] {
  const prompt = language.startsWith("fa") ? REWRITE_PROMPT_FA : REWRITE_PROMPT_EN;
  const lines = history.slice(-HISTORY_TURNS).map((message) => {
    const role = message.role === "user" ? "کاربر" : "دستیار";
    const content = (message.content ?? "").trim().replace(/\s+/g, " ").slice(0, 500);
    return `${role}: ${content}`;
  });
  return [
    { role: "system", content: prompt },
    {
      role: "user",
      content: `گفت‌وگو:\n${lines.join("\n")}\n\nآخرین پیام کاربر: ${question.trim()}\n\nپرسش بازنویسی‌شده:`,
    },
  ];
}

/** Strip the noise small models like to add around the rewritten question. */
export function cleanRewrite(text: string): string {
  let out = (text ?? "").trim();
  out = out.replace(/^(پرسش بازنویسی‌شده|پرسش مستقل|Rewrite|Question)\s*[:：]\s*/i, "");
  out = out.replace(/^["'«»]+|["'«»]+$/g, "").trim();
  return out.split(/\r?\n/)[0].trim();
}

export interface ResolveOptions {
  /** Test seam: replace the LLM call. */
  rewrite?: (messages: { role: "system" | "user"; content: string }[]) => Promise<string>;
  /** Test seam: force the heuristic path. */
  llmAvailable?: boolean;
}

/**
 * Turn the last user message into a standalone retrieval query.
 * Never throws: any LLM problem falls back to the heuristic.
 */
export async function resolveStandaloneQuery(
  question: string,
  history: ChatTurn[] = [],
  language = "fa",
  options: ResolveOptions = {},
): Promise<QueryResolution> {
  const text = (question ?? "").trim();
  const previous = lastUserQuestion(history);
  if (!text || !previous) return { query: text, rewritten: false, method: "none" };

  // A standalone question is used verbatim — the model is not asked at all.
  if (!looksLikeFollowUp(text, history)) {
    return { query: text, rewritten: false, method: "none" };
  }

  const available = options.llmAvailable ?? true;
  if (available) {
    try {
      const messages = asPrompt(history, text, language);
      let content: string;
      if (options.rewrite) {
        content = await options.rewrite(messages);
      } else {
        // Imported lazily so the pure heuristic stays usable (and testable)
        // without loading the local llama.cpp runtime.
        const { llmChat } = await import("@/lib/ai/orchestrator");
        content = (await llmChat(messages)).content;
      }
      const candidate = cleanRewrite(content);
      const words = candidate.split(/\s+/).filter(Boolean);
      if (candidate && words.length >= 2 && words.length <= 60) {
        return { query: candidate, rewritten: candidate !== text, method: "llm" };
      }
    } catch (error) {
      console.warn("[RAG] Follow-up rewrite failed, using the heuristic:", error);
    }
  }

  const fallback = heuristicQuery(text, history);
  return {
    query: fallback,
    rewritten: fallback !== text,
    method: fallback !== text ? "heuristic" : "none",
  };
}
