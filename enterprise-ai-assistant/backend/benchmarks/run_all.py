"""Orchestrator: run the full scale benchmark and emit JSON + Markdown report.

Example:
    cd enterprise-ai-assistant/backend
    ../../bench-venv/bin/python -m benchmarks.run_all \\
        --scales-files 200,2000,20000 --embed-workers 4
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import platform
import sys
import tempfile
import time
from pathlib import Path
from typing import Dict, List

BACKEND_DIR = str(Path(__file__).resolve().parent.parent)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Isolate BEFORE importing settings (singleton reads XDG at import time).
os.environ.setdefault("XDG_DATA_HOME", tempfile.mkdtemp(prefix="bench-xdg-"))

from core import database as db  # noqa: E402
from core.config import settings  # noqa: E402


def switch_db(root: Path) -> Path:
    """Point settings at a fresh throwaway database directory."""
    old = getattr(db._LOCAL, "conn", None)
    if old is not None:
        try:
            old.close()
        except Exception:
            pass
    db._LOCAL.conn = None  # force reconnect on next get_conn()
    appdata = root / "EnterpriseAI"
    (appdata / "data").mkdir(parents=True, exist_ok=True)
    (appdata / "storage" / "documents").mkdir(parents=True, exist_ok=True)
    settings.appdata = appdata
    db.init_db()
    return appdata


# --------------------------------------------------------------------------- #
def bench_ingest_sample(num_docs: int = 12) -> Dict:
    """End-to-end ingestion of real .txt files via workers.document_processor."""
    import random
    from benchmarks.gen_data import generate_doc
    from benchmarks.load_db import seed_org, ORG_ID, DEPT_IDS, ADMIN_ID
    from workers import document_processor as dp

    seed_org()
    rng = random.Random(7)
    storage = settings.storage_path / "documents"
    storage.mkdir(parents=True, exist_ok=True)
    doc_ids: List[str] = []
    for i in range(num_docs):
        d = generate_doc(rng, 900000 + i, sentences=60)
        path = storage / f"ingest-{i}.txt"
        path.write_text(d.title + "\n\n" + d.body, encoding="utf-8")
        doc_id = f"bench-ingest-{i:03d}"
        db.execute(
            "INSERT INTO documents (id, organization_id, department_id, owner_id, title,"
            " original_filename, file_type, mime_type, file_size_bytes, file_hash,"
            " storage_path, status, visibility, metadata)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (doc_id, ORG_ID, DEPT_IDS[0], ADMIN_ID, d.title, path.name,
             "txt", "text/plain", path.stat().st_size, f"ing-{i}",
             str(path), "UPLOADED", "public", "{}"))
        doc_ids.append(doc_id)

    t0 = time.time()
    for doc_id in doc_ids:
        dp._process(doc_id)
    wall = time.time() - t0
    ok = db.query_one("SELECT COUNT(*) AS c FROM documents WHERE status='READY'"
                      " AND id LIKE 'bench-ingest-%'")
    n_chunks = db.query_one("SELECT COUNT(*) AS c FROM document_chunks c JOIN documents d"
                            " ON d.id=c.document_id WHERE d.id LIKE 'bench-ingest-%'")
    return {"docs": num_docs, "ready": ok["c"], "chunks": n_chunks["c"],
            "wall_s": round(wall, 2),
            "sec_per_doc": round(wall / max(1, num_docs), 3)}


# --------------------------------------------------------------------------- #
def machine_info() -> Dict:
    import sqlite3
    try:
        import numpy, httpx  # noqa
        import sqlite_vec  # noqa
        vec_ver = getattr(sqlite_vec, "__version__", "unknown")
    except Exception:
        vec_ver = "missing"
    mem_gb = 0.0
    try:
        with open("/proc/meminfo") as fh:
            for line in fh:
                if line.startswith("MemTotal:"):
                    mem_gb = round(int(line.split()[1]) / 1024 / 1024, 1)
    except OSError:
        pass
    return {"platform": platform.platform(), "cpu_count": os.cpu_count(),
            "mem_gb": mem_gb, "python": platform.python_version(),
            "sqlite": sqlite3.sqlite_version, "sqlite_vec": vec_ver,
            "embedding_dim": settings.embedding_dim,
            "chunk_size_cfg": settings.rag_chunk_size,
            "retrieval_top_k": settings.rag_retrieval_top_k}


def main() -> None:
    ap = argparse.ArgumentParser(description="RAG scale benchmark")
    ap.add_argument("--scales-files", default="200,2000,20000",
                    help="comma-separated document counts, e.g. 200,2000,20000")
    ap.add_argument("--sentences", type=int, default=60,
                    help="sentences per synthetic doc (~6 chunks)")
    ap.add_argument("--embed-workers", type=int, default=4)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default=None,
                    help="results dir (default: benchmarks/results/<timestamp>)")
    ap.add_argument("--skip-ingest", action="store_true")
    args = ap.parse_args()

    from benchmarks import measure as M
    from benchmarks.gen_data import NEEDLES, GENERIC_QUERIES
    from benchmarks.load_db import (admin_user, bulk_load, count_rows,
                                    db_size_bytes, plant_needles, restricted_user,
                                    seed_org)

    scales = [int(x) for x in args.scales_files.split(",") if x.strip()]
    ts = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    outdir = Path(args.out or (Path(__file__).parent / "results" / ts))
    outdir.mkdir(parents=True, exist_ok=True)

    report: Dict = {"started_at": ts, "machine": machine_info(),
                    "args": vars(args), "scales": []}
    exact_q = [n.exact_query for n in NEEDLES]
    para_q = [n.paraphrase_query for n in NEEDLES]
    latency_q = exact_q + para_q + GENERIC_QUERIES

    # ---- Step 0: real end-to-end ingestion sample (isolated DB) ----
    if not args.skip_ingest:
        print("== Step 0: end-to-end ingestion sample (real pipeline) ==", flush=True)
        switch_db(Path(tempfile.mkdtemp(prefix="bench-ingest-")))
        report["ingest_sample"] = bench_ingest_sample()
        print(f"   {report['ingest_sample']}", flush=True)

    # ---- Steps 1..N: one fresh DB per scale ----
    for scale in scales:
        print(f"== Scale: {scale} files ==", flush=True)
        switch_db(Path(tempfile.mkdtemp(prefix=f"bench-{scale}-")))
        seed_org()
        load = bulk_load(scale, sentences_per_doc=args.sentences,
                         seed=args.seed, embed_workers=args.embed_workers)
        gold = plant_needles()
        counts = count_rows()
        size_b = db_size_bytes()

        print("   measuring latency (admin)...", flush=True)
        lat_admin = M.measure_latency(latency_q, admin_user())
        print("   measuring recall (admin)...", flush=True)
        rec_admin = M.measure_recall(exact_q, para_q, gold, admin_user())
        print("   measuring latency+recall (restricted user)...", flush=True)
        lat_user = M.measure_latency(latency_q, restricted_user())
        rec_user = M.measure_recall(exact_q, para_q, gold, restricted_user())

        entry = {"files": scale, "load": load, "rows": counts,
                 "db_size_mb": round(size_b / 1024 / 1024, 1),
                 "latency_admin": lat_admin, "recall_admin": rec_admin,
                 "latency_user": lat_user, "recall_user": rec_user}
        report["scales"].append(entry)
        (outdir / f"scale-{scale}.json").write_text(
            json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"   done: {counts['chunks']} chunks, {entry['db_size_mb']} MB, "
              f"retrieve p50={lat_admin['retrieve_ms']['p50']}ms "
              f"p95={lat_admin['retrieve_ms']['p95']}ms", flush=True)

    # ---- Projection to 100k files (linear, from the largest observed scale) ----
    report["projection_100k"] = project_100k(report)

    (outdir / "results.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    md = render_markdown(report)
    (outdir / "REPORT_FA.md").write_text(md, encoding="utf-8")
    print(f"\nResults written to: {outdir}", flush=True)
    print(md, flush=True)


# --------------------------------------------------------------------------- #
def project_100k(report: Dict) -> Dict:
    """Linear projection to 100k files (~600k chunks). Clearly labeled estimate."""
    scales = report["scales"]
    if not scales:
        return {}
    big = scales[-1]
    chunks = max(1, big["rows"]["chunks"])
    target_chunks = 600_000
    f = target_chunks / chunks
    lat = big["latency_admin"]
    proj = {
        "method": "linear from largest observed scale (vec scan is O(N); FTS sublinear)",
        "basis_files": big["files"], "basis_chunks": chunks,
        "target_files": 100_000, "target_chunks": target_chunks,
        "factor": round(f, 2),
        "db_size_gb": round(big["db_size_mb"] * f / 1024, 1),
        "bulk_load_min": round(big["load"]["load_wall_s"] * f / 60, 1),
        "vec_p50_ms": round(lat["vec_ms"]["p50"] * f, 1),
        "vec_p95_ms": round(lat["vec_ms"]["p95"] * f, 1),
        "fts_p50_ms": round(lat["fts_ms"]["p50"] * f, 1),
        "retrieve_p50_ms": round(lat["retrieve_ms"]["p50"] * f, 1),
        "retrieve_p95_ms": round(lat["retrieve_ms"]["p95"] * f, 1),
    }
    ing = report.get("ingest_sample")
    if ing and ing.get("sec_per_doc"):
        proj["real_pipeline_hours_2workers"] = round(
            ing["sec_per_doc"] * 100_000 / 2 / 3600, 1)
        proj["real_pipeline_sec_per_doc"] = ing["sec_per_doc"]
    return proj


def render_markdown(r: Dict) -> str:
    L: List[str] = []
    m = r["machine"]
    L.append("# گزارش بنچمارک مقیاس‌پذیری RAG\n")
    L.append(f"_تاریخ اجرا: {r['started_at']}_\n")
    L.append("## محیط اجرا\n")
    L.append(f"- سیستم: `{m['platform']}` — CPU: {m['cpu_count']} هسته — RAM: {m['mem_gb']}GB")
    L.append(f"- پایتون {m['python']} — SQLite {m['sqlite']} — sqlite-vec: {m['sqlite_vec']}")
    L.append(f"- بک‌اند امبدینگ: **hash** (بدون مدل ONNX) — بُعد وکتور: {m['embedding_dim']}")
    L.append("- بک‌اند ری‌رنکر: **lexical** — مدل LLM در این بنچمارک دخیل نیست (زمان تولید پاسخ مستقل از حجم کورپوس است)")
    L.append("- هر فایل مصنوعی ≈ ۶ چانک فارسی؛ دیتابیس‌ها موقتی و ایزوله‌اند.\n")

    ing = r.get("ingest_sample")
    if ing:
        L.append("## نمونه ایندکس واقعی (پایپ‌لاین کامل تولید)\n")
        L.append(f"- {ing['docs']} فایل واقعی txt از طریق `document_processor` پردازش شد: "
                 f"{ing['ready']} موفق، {ing['chunks']} چانک در {ing['wall_s']} ثانیه")
        L.append(f"- **میانگین هر فایل: {ing['sec_per_doc']} ثانیه** (شامل استخراج، چانک، امبدینگ hash و ایندکس)\n")

    L.append("## نتایج بر حسب مقیاس\n")
    L.append("| فایل‌ها | چانک‌ها | زمان بارگذاری | حجم DB | retrieve p50 | retrieve p95 | vec p50 | fts p50 |")
    L.append("|---:|---:|---:|---:|---:|---:|---:|---:|")
    for s in r["scales"]:
        la = s["latency_admin"]
        L.append(f"| {s['files']:,} | {s['rows']['chunks']:,} | {s['load']['load_wall_s']}s "
                 f"| {s['db_size_mb']}MB | {la['retrieve_ms']['p50']}ms | {la['retrieve_ms']['p95']}ms "
                 f"| {la['vec_ms']['p50']}ms | {la['fts_ms']['p50']}ms |")
    L.append("")
    L.append("## جزئیات تأخیر (میلی‌ثانیه)\n")
    for s in r["scales"]:
        L.append(f"### {s['files']:,} فایل ({s['rows']['chunks']:,} چانک)\n")
        L.append("| مرحله | mean | p50 | p95 | max |")
        L.append("|---|---:|---:|---:|---:|")
        for stage, fa in (("embed_ms", "امبدینگ سؤال"), ("fts_ms", "جستجوی FTS"),
                          ("vec_ms", "جستجوی وکتوری"), ("rerank20_ms", "ری‌رنک ۲۰ کاندید"),
                          ("assemble_ms", "ساخت کانتکست"), ("retrieve_ms", "بازیابی کامل (کاربر مدیر)")):
            v = s["latency_admin"][stage]
            L.append(f"| {fa} | {v['mean']} | {v['p50']} | {v['p95']} | {v['max']} |")
        u = s["latency_user"]["retrieve_ms"]
        L.append(f"| بازیابی کامل (کاربر محدود) | {u['mean']} | {u['p50']} | {u['p95']} | {u['max']} |")
        L.append("")
    L.append("## ریکال (بازیابی سند درست)\n")
    L.append("| مقیاس | کوئری دقیق hybrid@5 | کوئری دقیق FTS@20 | کوئری دقیق vec@60 | "
             "پارافریز hybrid@5 | پارافریز FTS@20 | پارافریز vec@60 |")
    L.append("|---:|---:|---:|---:|---:|---:|---:|")
    for s in r["scales"]:
        e, p = s["recall_admin"]["exact"], s["recall_admin"]["paraphrase"]
        L.append(f"| {s['files']:,} | {e['hybrid_top5']} | {e['fts_top20']} | {e['vec_top60']} | "
                 f"{p['hybrid_top5']} | {p['fts_top20']} | {p['vec_top60']} |")
    L.append("")
    L.append("> توجه: با بک‌اند hash (غیرمعنایی)، ریکال پارافریز عملاً سقف کیفیت معماری فعلی "
             "بدون مدل ONNX واقعی را نشان می‌دهد.\n")

    p = r.get("projection_100k", {})
    if p:
        L.append("## برون‌یابی به ۱۰۰٬۰۰۰ فایل (≈ ۶۰۰٬۰۰۰ چانک)\n")
        L.append(f"_روش: تعمیم خطی از بزرگ‌ترین مقیاس مشاهده‌شده ({p['basis_files']:,} فایل، ضریب {p['factor']}). "
                 "اسکن وکتوری O(N) است پس تعمیم خطی برای آن دقیق است؛ FTS زیرخطی است._\n")
        L.append(f"- حجم تقریبی دیتابیس: **{p['db_size_gb']} گیگابایت**")
        L.append(f"- زمان بارگذاری توده‌ای (امبدینگ hash): **{p['bulk_load_min']} دقیقه**")
        if "real_pipeline_hours_2workers" in p:
            L.append(f"- زمان ایندکس با پایپ‌لاین واقعی و ۲ ورکر: **{p['real_pipeline_hours_2workers']} ساعت** "
                     f"({p['real_pipeline_sec_per_doc']} ثانیه برای هر فایل)")
            L.append("  - ⚠️ این عدد، کف خوش‌بینانه است (فایل txt کوچک + امبدینگ hash)؛ با PDF واقعی، OCR و مدل ONNX روی CPU، انتظار چند ساعت تا چند روز است.")
        L.append(f"- جستجوی وکتوری هر سؤال: p50 ≈ **{p['vec_p50_ms']}ms** ، p95 ≈ **{p['vec_p95_ms']}ms**")
        L.append(f"- بازیابی کامل هر سؤال ( p50 ): ≈ **{p['retrieve_p50_ms']}ms** ، ( p95 ): ≈ **{p['retrieve_p95_ms']}ms**")
        L.append("- توجه: با مدل ONNX واقعی روی CPU، زمان ایندکس چند برابر و امبدینگ هر سؤال از زیر ۱ms به ده‌ها ms می‌رسد.\n")

    L.append("## نتیجه‌گیری\n")
    L.append("۱. مدل زبانی فقط ۵ چانک نهایی را می‌بیند؛ زمان تولید پاسخ ربطی به تعداد فایل‌ها ندارد.")
    L.append("۲. گلوگاه اصلی، جستجوی وکتوری brute-force در sqlite-vec است که با رشد کورپوس خطی کند می‌شود.")
    L.append("۳. ایندکس اولیه ۱۰۰٬۰۰۰ فایل با ۲ ورکر CPU، مقیاس ساعتی/روزانه دارد نه دقیقه‌ای.")
    if r["scales"]:
        p0 = r["scales"][0]["recall_admin"]["paraphrase"]["hybrid_top5"]
        p1 = r["scales"][-1]["recall_admin"]["paraphrase"]["hybrid_top5"]
        pv = r["scales"][-1]["recall_admin"]["paraphrase"]["vec_top60"]
        if p0 == p1:
            trend = f"در {p1} (پایین) باقی ماند و ریکال وکتوری پارافریز تا {pv} رسید"
        else:
            trend = f"از {p0} به {p1} افت کرد (ریکال وکتوری: {pv})"
        L.append(f"۴. ریکال سؤال‌های پارافریزشده با بک‌اند غیرمعنایی hash {trend}؛ "
                 "برای کیفیت قابل‌قبول در ۱۰۰K فایل، مدل امبدینگ واقعی (ONNX) لازم است.\n")
    return "\n".join(L)


if __name__ == "__main__":
    main()
