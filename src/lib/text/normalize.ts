/**
 * Persian / Arabic text normalization for full-text indexing and search.
 *
 * WHY THIS EXISTS
 * ---------------
 * The PostgreSQL default text-search parser (C locale, `simple` config)
 * treats the Persian zero-width non-joiner (ZWNJ, U+200C) as a *word*
 * character. So the raw word «می‌رود» is indexed as a single token that
 * contains the invisible joiner: «می‌رود». The chat/search side normalizes
 * ZWNJ to a space (producing «می» + «رود»), and the two sides never match.
 * In Persian, ZWNJ appears in a very large share of words (every verb with
 * the «می» prefix, most plurals and compound adjectives), so indexing the
 * raw text made huge parts of the corpus unsearchable — the main reason the
 * assistant could not find or cite the right sources.
 *
 * Rule: everything that ends up in the FTS index (`content_norm`) must pass
 * through `normalizeForIndex`, and every query term must pass through
 * `queryTerms`, so both sides tokenize identically.
 */

/** Character variants unified to the common Persian form. */
const CHAR_VARIANTS: Record<string, string> = {
  "\u064a": "ی", // Yeh (Arabic)           -> ی
  "\u0649": "ی", // Yeh final form (ى)     -> ی
  "\u0643": "ک", // Kaf (Arabic)           -> ک
  "\u0629": "ه", // Ta marbuta (ة)         -> ه
  "\u06d5": "ه", // AEF (ە)                -> ه
  "\u06be": "ه", // Hah with 3 dots (ھ)    -> ه
  "\u06c1": "ه", // Ae with madda above (ۀ) -> ه
};

const VARIANTS_RE = new RegExp(`[${Object.keys(CHAR_VARIANTS).join("")}]`, "g");

/** Invisible / joiner / bidi control characters -> space (word separators). */
const INVISIBLE_RE = /[\u200c\u200d\u200e\u200f\u200b\ufeff]/g;

/** Tashkeel (diacritics), wasla and tatweel are removed entirely. */
const DIACRITICS_RE = /[\u064b-\u0652\u0670\u0640]/g;

const DIGIT_MAP = new Map(
  [..."٠١٢٣٤٥٦٧٨٩", ..."۰۱۲۳۴۵٦۷۸۹"].map((ch, i) => [ch, String(i % 10)]),
);

function mapDigits(text: string): string {
  let out = "";
  for (const ch of text) out += DIGIT_MAP.get(ch) ?? ch;
  return out;
}

/**
 * Normalize Persian/Arabic (and multilingual) text for the FTS index.
 * The result is written to `knowledge_chunks.content_norm` at ingest time
 * and is what the generated `content_tsv` column tokenizes.
 */
export function normalizeForIndex(text: string): string {
  if (!text) return "";
  let out = text.normalize("NFKC");
  out = out.replace(INVISIBLE_RE, " ");
  out = out.replace(VARIANTS_RE, (ch) => CHAR_VARIANTS[ch] ?? ch);
  out = mapDigits(out);
  out = out.replace(DIACRITICS_RE, "");
  out = out.replace(/\s+/g, " ");
  return out.trim();
}

// ---------------------------------------------------------------------------
// Query tokenization
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  // function words
  "از", "به", "با", "را", "که", "در", "بر", "بن", "روی", "رو", "سر",
  "این", "آن", "اين", "برای", "براي", "یا", "تا", "و", "می", "مى",
  "های", "هاي", "ها", "هم", "همان", "خود", "دیگر", "ديگر", "نیز", "نيز",
  "فقط", "تنها", "بسیار", "خیلی", "کمتر", "بیشتر", "هست", "هستند",
  "هستیم", "هستید", "هسته", "است", "بود", "بوده", "بودیم", "بودند",
  "شد", "شده", "شود", "بشود", "شدن", "شدند", "خواهد", "خواهند", "خواهم",
  "باید", "بایستی", "بایست", "نمی",
  // inflected auxiliaries (noise for retrieval): توانستن / بودن / داشتن
  "تواند", "توانند", "توانست", "توانستند", "توانستن",
  "باشد", "باشند", "بودی", "داشته", "داشت", "داشتند", "دارند",
  // question words / modals (noise for retrieval)
  "چه", "چو", "چون", "چرا", "چطور", "چگونه", "چقدر", "چند",
  "کجا", "کجاست", "کی", "کدام", "کدامیک", "کدامین", "آیا",
  "اگر", "ولی", "اما", "پس", "زیرا", "زيرا", "وقتی", "هنگام",
  "هر", "همه", "همین", "همون", "آنجا", "اینجا", "اینطور", "آنطور",
  "اینجور", "آنجور",
  // politeness / filler
  "لطفا", "میشه", "میشود", "میتوانم", "میتوانید", "توانم", "توانید",
  "بگویید", "بگو", "گفت", "گویید", "میگه", "میگویم", "میگفت",
  "نیاز", "دارم", "دارید", "داریم", "میخواهم", "میخواهد", "میخواهند",
  "سؤال", "سوال", "پرسش", "پرسیدم", "بپرسید", "تو", "شما", "ما",
  // English
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "of", "to", "in", "on", "and", "or", "for", "with", "that", "this",
  "it", "as", "by", "at", "from", "we", "our", "us", "you", "your",
  "they", "their", "he", "she", "his", "her", "its", "not", "no", "but",
  "if", "then", "what", "which", "who", "whom", "when", "where", "why",
  "how", "do", "does", "did", "have", "has", "had", "can", "could",
  "would", "should", "will", "may", "might", "please",
]);

/**
 * Tokenize text the same way the FTS index does: normalize (ZWNJ→space,
 * variant unification, digit unification, diacritic removal), split on
 * non-alphanumerics, lowercase, drop stop-words and single characters.
 *
 * @param text - raw user query (or chunk content)
 * @param options.dropStopwords - default true; pass false to keep every
 *   token (used as a fallback when a query consists only of stop-words).
 */
export function searchTokens(
  text: string,
  options?: { dropStopwords?: boolean },
): string[] {
  const dropStopwords = options?.dropStopwords ?? true;
  const normalized = normalizeForIndex(text).toLowerCase();
  const raw = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw) {
    if (token.length < 2) continue;
    if (dropStopwords && STOPWORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/** Distinct meaningful terms of a query, capped for tsquery building. */
export function queryTerms(rawQuery: string, limit = 12): string[] {
  let terms = searchTokens(rawQuery, { dropStopwords: true }).slice(0, limit);
  if (terms.length === 0) {
    // Query made only of stop-words (e.g. «آیا هست؟») — fall back to the
    // raw tokens so we still attempt a match instead of returning nothing.
    terms = searchTokens(rawQuery, { dropStopwords: false }).slice(0, limit);
  }
  return terms;
}
