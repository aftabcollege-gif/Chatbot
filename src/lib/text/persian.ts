/**
 * Persian / Arabic-script text normalisation shared by the indexer (SQL
 * generated column via `fa_normalize`) and the query builder (TypeScript).
 *
 * BOTH sides MUST apply exactly the same transformation, otherwise query
 * tokens will never match indexed tokens. The SQL function body below is
 * generated from the same character tables used by `normalizePersian`.
 *
 * Transformations:
 *   - Arabic letters that have a distinct Persian code point are folded
 *     (ي→ی, ك→ک, ة→ه, ى→ی, ۀ→ه, ؤ→و, إ→ا, أ→ا).
 *   - Persian (۰-۹) and Arabic-Indic (٠-٩) digits are folded to ASCII digits.
 *   - Tashkeel / harakat (U+064B–U+0652, U+0670) and tatweel (U+0640) removed.
 *   - ZWNJ (U+200C) becomes a space so "می‌شود" → "می شود" and "مرخصی‌ها" →
 *     "مرخصی ها"; the base word then matches regardless of how the author
 *     typed the suffix. Other zero-width / directional marks are removed.
 *   - Every run of non-alphanumeric characters becomes a single space
 *     (SQL side only, before to_tsvector). PostgreSQL's parser otherwise
 *     treats "BULK-042" as `bulk` + `-042` (signed integer), "3.14" as one
 *     float token, "a/b" as a path, … while the query tokenizer splits on
 *     every non-letter/digit — so equipment, form and error codes such as
 *     "E-47" or "XR-220" would never match exactly. With the pre-split both
 *     sides see identical tokens ("bulk", "042").
 */

const LETTER_FOLDS: ReadonlyArray<readonly [string, string]> = [
  ["\u064A", "\u06CC"], // ي → ی
  ["\u0643", "\u06A9"], // ك → ک
  ["\u0629", "\u0647"], // ة → ه
  ["\u0649", "\u06CC"], // ى → ی
  ["\u06C0", "\u0647"], // ۀ → ه
  ["\u0624", "\u0648"], // ؤ → و
  ["\u0625", "\u0627"], // إ → ا
  ["\u0623", "\u0627"], // أ → ا
];

const PERSIAN_DIGITS = "\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9";
const ARABIC_INDIC_DIGITS = "\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669";
const ASCII_DIGITS = "0123456789";

const TRANSLATE_FROM =
  LETTER_FOLDS.map(([from]) => from).join("") + PERSIAN_DIGITS + ARABIC_INDIC_DIGITS + "\u200C";
const TRANSLATE_TO =
  LETTER_FOLDS.map(([, to]) => to).join("") + ASCII_DIGITS + ASCII_DIGITS + " ";

const TRANSLATE_MAP: ReadonlyMap<string, string> = new Map(
  Array.from(TRANSLATE_FROM).map((ch, i) => [ch, TRANSLATE_TO[i]]),
);

// Combining marks + tatweel + zero-width/directional controls (except ZWNJ,
// which is handled above as a word separator).
const REMOVE_RE = /[\u064B-\u0652\u0670\u0640\u200B\u200D-\u200F\uFEFF]/g;

export function normalizePersian(input: string): string {
  let out = "";
  for (const ch of input.replace(REMOVE_RE, "")) {
    out += TRANSLATE_MAP.get(ch) ?? ch;
  }
  return out;
}

/**
 * SQL definition of `fa_normalize(text)`. IMMUTABLE so it can be used inside
 * a GENERATED ALWAYS column and in expression indexes.
 */
export const FA_NORMALIZE_FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION fa_normalize(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $fn$
  SELECT regexp_replace(
    translate(
      regexp_replace(input, '[\u064B-\u0652\u0670\u0640\u200B\u200D-\u200F\uFEFF]', '', 'g'),
      '${TRANSLATE_FROM}',
      '${TRANSLATE_TO}'
    ),
    '[^[:alnum:]]+', ' ', 'g'
  )
$fn$;
`.trim();

/**
 * Bumped whenever FA_NORMALIZE_FUNCTION_SQL changes in a way that alters the
 * produced tokens; the migration runner rebuilds `content_tsv` once per
 * version so stored vectors never lag behind the query tokenizer.
 */
export const FA_NORMALIZE_VERSION = 2;

// ---------------------------------------------------------------------------
// Tokenisation & stop words for keyword (tsvector) queries
// ---------------------------------------------------------------------------

/**
 * High-frequency Persian function words. These appear in virtually every
 * paragraph, so OR-ing them into a tsquery makes the query match (and rank)
 * millions of chunks in a large corpus — the single biggest cause of slow
 * keyword search. They carry no retrieval signal and are dropped.
 */
export const PERSIAN_STOP_WORDS: ReadonlySet<string> = new Set([
  "و", "در", "به", "از", "که", "این", "را", "با", "است", "برای", "آن", "یک",
  "خود", "تا", "کرد", "بر", "هم", "نیز", "گفت", "می", "شود", "شد", "های", "ها",
  "اما", "یا", "هر", "چه", "اگر", "ما", "من", "او", "شما", "آنها", "ایشان",
  "بود", "باشد", "بودن", "شدن", "کردن", "دارد", "داشت", "دارند", "داشته",
  "کند", "کنند", "کنید", "کنم", "کرده", "شده", "شوند", "شوید", "نمی", "نیست",
  "هست", "هستند", "بودند", "خواهد", "خواهند", "باید", "نباید", "توان", "میتوان",
  "چند", "چون", "زیرا", "پس", "ولی", "بلکه", "حتی", "فقط", "همه", "هیچ", "دیگر",
  "دیگری", "بین", "روی", "زیر", "پیش", "بعد", "قبل", "طی", "طبق", "درباره",
  "بدون", "همین", "همان", "چنین", "چگونه", "چطور", "چیست", "کیست", "کجا", "کجاست",
  "چقدر", "چرا", "آیا", "کدام", "چیزی", "چیز", "کسی", "کس", "وقتی", "هنگام",
  "مورد", "نسبت", "توسط", "جهت", "ضمن", "بنابراین", "لذا", "سپس", "همچنین",
  "مثل", "مانند", "نظر", "طور", "بسیار", "خیلی", "کم", "بیش", "بیشتر", "کمتر",
  "اول", "دوم", "سوم", "یعنی", "البته", "شاید", "حدود", "تقریبا", "دقیقا",
  "لطفا", "بفرمایید", "بگویید", "بگو", "میخواهم", "خواهم", "میشود", "نمیشود",
  "ی", "ای", "ام", "ات", "اش", "مان", "تان", "شان", "تر", "ترین",
]);

export const ENGLISH_STOP_WORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "of", "to",
  "in", "on", "and", "or", "for", "with", "that", "this", "these", "those", "it",
  "as", "by", "at", "from", "we", "our", "us", "you", "your", "they", "their",
  "he", "she", "his", "her", "its", "not", "no", "but", "if", "then", "than",
  "what", "which", "who", "whom", "how", "when", "where", "why", "can", "could",
  "should", "would", "will", "shall", "may", "might", "do", "does", "did", "have",
  "has", "had", "about", "into", "over", "under", "please", "tell", "me", "my",
]);

/**
 * Split normalised text into word tokens. Anything that is not a letter or a
 * digit (Persian punctuation «»،؛؟ included) is a separator, mirroring how
 * PostgreSQL's `simple` parser tokenises the indexed text.
 */
export function tokenizePersian(normalized: string): string[] {
  // Mirror of the SQL side: letters, digits and combining marks form tokens,
  // everything else separates them.
  return normalized
    .toLowerCase()
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export interface KeywordTerms {
  /** Content-bearing terms (stop words removed), in original order. */
  terms: string[];
  /** Whether stop-word removal left us with nothing (very short queries). */
  usedStopWordsOnly: boolean;
}

export function extractKeywordTerms(rawQuery: string, maxTerms = 12): KeywordTerms {
  const tokens = tokenizePersian(normalizePersian(rawQuery));
  const seen = new Set<string>();
  const content: string[] = [];
  const all: string[] = [];
  for (const token of tokens) {
    if (token.length < 2 && !/\p{N}/u.test(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    all.push(token);
    if (PERSIAN_STOP_WORDS.has(token) || ENGLISH_STOP_WORDS.has(token)) continue;
    content.push(token);
  }
  if (content.length === 0) {
    return { terms: all.slice(0, maxTerms), usedStopWordsOnly: all.length > 0 };
  }
  // Prefer longer (more specific) terms when we have to truncate.
  const terms =
    content.length <= maxTerms
      ? content
      : [...content].sort((a, b) => b.length - a.length).slice(0, maxTerms);
  return { terms, usedStopWordsOnly: false };
}

/** Escape a token for safe embedding inside a to_tsquery() expression. */
export function tsqueryLexeme(term: string, prefix: boolean): string {
  const escaped = term.replace(/\\/g, "\\\\").replace(/'/g, "''");
  return `'${escaped}'${prefix ? ":*" : ""}`;
}
