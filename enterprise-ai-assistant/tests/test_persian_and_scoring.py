"""Reported bugs, pinned down by tests.

1. «در نیم‌فاصله مشکل دارد» — ZWNJ (نیم‌فاصله) must not decide whether the
   full-text index matches: «می‌شود» and «می شود» have to find each other, in
   both directions.
2. «در انتخاب منابع اشکال دارد و منابع اشتباهی را انتخاب می‌کند» — a question
   like «فرآیند pm را مختصر توضیح بده» must not cite every document that
   contains a common word; only chunks that carry the *distinctive* term, or
   that are semantically close, may become sources.
3. «یک بخش را تکرار می‌کند» — overlapping chunks and looping models used to make
   the same sentence appear twice in the sources, the context and the answer.
"""
from __future__ import annotations

import asyncio
import sqlite3
import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from services.answer_guard import RepetitionGuard, dedupe_sentences  # noqa: E402
from services.rag_scoring import distinctive_terms, select_sources  # noqa: E402
from utils.persian import (  # noqa: E402
    content_terms,
    fold_joiners,
    fts_query,
    normalize_persian,
    same_word,
    tokenize,
)


class FakeChunk:
    """Minimal stand-in for ``rag_service.RetrievedChunk``."""

    def __init__(self, text, source_id="doc-1", title="", vector=None, rerank=0.0):
        self.content = text
        self.heading = ""
        self.section = ""
        self.source_id = source_id
        self.title = title
        self.vector_score = vector
        self.rerank_score = rerank
        self.lexical_score = 0.0
        self.score = 0.0

    def body_text(self):
        return self.content

    def title_text(self):
        return self.title


class ZwnjNormalizationTests(unittest.TestCase):
    def test_zwnj_is_a_space_and_fold_joiners_ignores_it(self):
        self.assertIn(" ", normalize_persian("می‌شود"))
        self.assertTrue(same_word("می‌شود", "می شود"))
        self.assertEqual(fold_joiners("نیم‌فاصله"), fold_joiners("نیم فاصله"))

    def test_query_terms_cover_both_spellings(self):
        # The user types it without ZWNJ …
        variants = fts_query("می شود")
        self.assertIn('"شود"', variants)
        self.assertIn('"میشود"', variants)
        # … and with it.
        variants = fts_query("می‌شود")
        self.assertIn('"می"', variants)
        self.assertIn('"شود"', variants)
        self.assertIn('"میشود"', variants)

    def test_fts_index_matches_across_the_two_spellings(self):
        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE VIRTUAL TABLE t USING fts5(content, tokenize='unicode61')")
        conn.execute("INSERT INTO t VALUES (?)", ("سامانه می‌شود به‌روزرسانی شود",))
        conn.execute("INSERT INTO t VALUES (?)", ("گزارش ماهانه باید ارسال شود",))
        rows = conn.execute("SELECT rowid FROM t WHERE t MATCH ?", (fts_query("می شود"),)).fetchall()
        self.assertIn((1,), rows, "«می شود» must find the ZWNJ spelling «می‌شود»")
        rows = conn.execute("SELECT rowid FROM t WHERE t MATCH ?", (fts_query("به روزرسانی"),)).fetchall()
        self.assertIn((1,), rows, "the joined spelling must find the ZWNJ one")

    def test_stopwords_are_not_search_terms(self):
        terms = content_terms("فرآیند pm را مختصر توضیح بده")
        self.assertIn("pm", terms)
        self.assertIn("فرآیند", terms)
        for word in ("را", "توضیح", "مختصر", "بده"):
            self.assertNotIn(word, terms, f"«{word}» is not a topic word")

    def test_fts_query_is_quoted_and_bounded(self):
        query = fts_query('«مرخصی» استعلاجی; DROP TABLE users; --')
        self.assertTrue(query.startswith('"'))
        self.assertNotIn(";", query.replace('"', "").replace(" ", ""))


class SourceSelectionTests(unittest.TestCase):
    PREVIOUS = (
        "فرآیند مدیریت پروژه (PM) شامل مرحله‌های آغاز، برنامه‌ریزی، اجرا و بستن است. "
        "در هر مرحله مستندات مربوطه ثبت می‌شود."
    )
    IRRELEVANT = (
        "فرآیند ثبت درخواست مرخصی استحقاقی در سامانه منابع انسانی انجام می‌شود. "
        "فرآیند تأیید با مدیر مستقیم است."
    )

    def _select(self, chunks, question="فرآیند PM را مختصر توضیح بده", **kwargs):
        terms = content_terms(question)
        options = dict(min_relevance=0.08, max_per_source=2, duplicate_similarity=0.75, limit=5)
        options.update(kwargs)
        return select_sources(chunks, terms, tokenize, **options)

    def test_common_word_alone_is_not_a_source(self):
        chunks = [
            FakeChunk(self.PREVIOUS, source_id="pm"),
            FakeChunk(self.IRRELEVANT, source_id="leave"),
        ]
        kept = self._select(chunks)
        self.assertEqual([c.source_id for c in kept], ["pm"], "only the PM document has evidence")

    def test_semantically_close_chunk_is_kept_without_literal_wording(self):
        # Real pool: the rare term «pm» exists somewhere, so it is *required*;
        # the paraphrased chunk is still kept because the vector search is
        # confident about it, while the leave procedure (common word only) is not.
        paraphrase = FakeChunk(
            "مدیریت پروژه از چهار گام تشکیل شده است: شروع، طرح‌ریزی، پایش و اختتام.",
            source_id="pm-paraphrase",
            vector=0.72,
        )
        common = FakeChunk(self.IRRELEVANT, source_id="leave")
        literal = FakeChunk(self.PREVIOUS, source_id="pm")
        kept = self._select([paraphrase, common, literal])
        self.assertIn("pm-paraphrase", [c.source_id for c in kept])
        self.assertNotIn("leave", [c.source_id for c in kept])

    def test_duplicate_sections_collapse_and_one_doc_is_capped(self):
        duplicated = FakeChunk(self.PREVIOUS, source_id="pm")
        overlapping = FakeChunk(
            "فرآیند مدیریت پروژه (PM) شامل مرحله‌های آغاز، برنامه‌ریزی، اجرا و بستن است.",
            source_id="pm",
        )
        other_chunk = FakeChunk(
            "در مرحله بستن پروژه، فرم تحویل نهایی و گزارش پایان کار تکمیل می‌شود. PM نیز ثبت می‌شود.",
            source_id="pm",
        )
        third = FakeChunk(
            "آیین‌نامه مالی پروژه‌ها: پیش‌پرداخت PM تا ۳۰ درصد مجاز است و تسویه پس از تحویل.",
            source_id="pm",
        )
        kept = self._select([duplicated, overlapping, other_chunk, third], max_per_source=2)
        self.assertEqual(len(kept), 2, "duplicates collapse and one document contributes at most 2")
        self.assertEqual(kept[0].source_id, "pm")

    def test_confidence_survives_the_gate(self):
        chunk = FakeChunk(self.PREVIOUS, source_id="pm")
        kept = self._select([chunk])
        self.assertGreater(kept[0].score, 0.0)
        self.assertLessEqual(kept[0].score, 1.0)

    def test_synonym_question_still_finds_the_document(self):
        # «pm» is nowhere in the corpus (the documents say «مدیریت پروژه»), so a
        # strict gate would answer "nothing found" — the relaxed pass must fall
        # back to the best lexical match instead.
        kept = self._select(
            [FakeChunk(self.IRRELEVANT, source_id="leave"), FakeChunk(self.PREVIOUS, source_id="pm-doc")],
            question="فرآیند mba را مختصر توضیح بده",
        )
        self.assertTrue(kept, "a synonym/typo must not produce an empty answer")
        self.assertIn("pm-doc", [c.source_id for c in kept])

    def test_distinctive_terms_pick_the_rare_word(self):
        # «pm» appears in one of two candidates (rare => required); «فرآیند»
        # appears in both (cannot discriminate => not required).
        chunks = [FakeChunk(self.PREVIOUS, source_id="pm"), FakeChunk(self.IRRELEVANT, source_id="leave")]
        terms = content_terms("فرآیند PM را مختصر توضیح بده")
        kept = self._select(chunks)
        from services.rag_scoring import document_frequency, inverse_document_frequency

        tokenized = [set(tokenize(c.body_text())) for c in chunks]
        required = distinctive_terms(
            terms, inverse_document_frequency(tokenized), document_frequency(tokenized), len(chunks)
        )
        self.assertEqual(required, ["pm"])
        self.assertEqual([c.source_id for c in kept], ["pm"])

    def test_every_candidate_sharing_a_common_word_is_not_filtered_out(self):
        # A question made only of a common word («فرآیند») has no distinctive
        # term at all: the relaxed pass must return the best matches instead of
        # answering "nothing found".
        chunks = [
            FakeChunk(self.PREVIOUS, source_id="a"),
            FakeChunk(self.IRRELEVANT, source_id="b"),
        ]
        kept = self._select(chunks, question="فرآیند را توضیح بده")
        self.assertEqual(sorted(c.source_id for c in kept), ["a", "b"])


class RepetitionGuardTests(unittest.TestCase):
    def _run(self, tokens):
        guard = RepetitionGuard()
        out = []
        for token in tokens:
            out.append(guard.push(token))
        out.append(guard.flush())
        return "".join(out), guard

    def test_repeated_sentence_is_dropped(self):
        answer, guard = self._run(
            [
                "فرآیند ثبت درخواست مرخصی در سامانه انجام می‌شود. ",
                "مدیر مستقیم آن را تأیید می‌کند. ",
                "فرآیند ثبت درخواست مرخصی در سامانه انجام می شود. ",
            ]
        )
        self.assertEqual(answer.count("مدیر مستقیم"), 1)
        self.assertEqual(answer.count("درخواست مرخصی"), 1)
        self.assertGreaterEqual(guard.dropped, 1)

    def test_paraphrase_with_same_words_is_dropped(self):
        answer, _ = self._run(
            [
                "گزارش حادثه باید حداکثر تا ۲۴ ساعت پس از وقوع ثبت شود. ",
                "ثبت گزارش حادثه باید حداکثر تا 24 ساعت پس از وقوع انجام شود. ",
                "واحد ایمنی گزارش را بررسی می‌کند.",
            ]
        )
        self.assertEqual(len(answer.split(".")), 3, "the paraphrased repeat is gone")
        self.assertIn("واحد ایمنی", answer)

    def test_streaming_does_not_hold_back_text(self):
        text = " ".join(f"جمله شماره {i} درباره فرایند ثبت است." for i in range(5))
        answer, _ = self._run(list(text))
        self.assertEqual(answer.strip(), text.strip())


class DedupeContextTests(unittest.TestCase):
    def test_context_deduplication_keeps_one_copy(self):
        first = "بند ۳: مرخصی استعلاجی نیازمند گواهی پزشک است. مدت آن حداکثر ۷ روز است."
        second = "مرخصی استعلاجی نیازمند گواهی پزشک است. مدیر باید آن را تأیید کند."
        seen = set()
        merged = dedupe_sentences(first, seen) + " " + dedupe_sentences(second, seen)
        self.assertEqual(merged.count("نیازمند گواهی پزشک"), 1)
        self.assertIn("مدیر باید", merged)

    def test_extractive_stream_deduplicates_sources(self):
        from services import llm_service

        sources = [
            {"content": "فرآیند PM شامل آغاز و برنامه‌ریزی است. بستن پروژه گزارش نهایی دارد.", "title": "PM"},
            {"content": "فرآیند PM شامل آغاز و برنامه ریزی است.", "title": "PM"},
        ]

        async def collect():
            parts = []
            gen = llm_service.extractive_stream("فرآیند PM چیست؟", sources, [], "fa")
            async for token in gen:
                parts.append(token)
            return "".join(parts)

        answer = asyncio.run(collect())
        self.assertIn("[1]", answer)
        self.assertNotIn("[2]", answer, "the duplicate source is not quoted again")
        self.assertEqual(answer.count("برنامه"), 1, "the repeated passage is quoted once")


if __name__ == "__main__":
    unittest.main()
