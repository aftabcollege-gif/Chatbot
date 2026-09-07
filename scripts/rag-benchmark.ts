#!/usr/bin/env -S npx tsx
/**
 * Retrieval benchmark on a synthetic Persian corpus — measures how the
 * database side of RAG (keyword + vector) behaves as the corpus grows.
 *
 *   npm run rag:bench -- --chunks 200000 --queries 20
 *   npm run rag:bench -- --chunks 50000 --no-vectors   # keyword path only
 *
 * Uses a throw-away PGlite database in .scratch/bench-db (deleted afterwards)
 * so it never touches the real data. Vectors are random (we are measuring
 * index/query cost, not model quality); when a real embedding model is
 * installed, pass --real-embeddings to embed the queries with it.
 */
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (name: string, def: number) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : def;
};
const CHUNKS = opt("chunks", 100_000);
const QUERIES = opt("queries", 10);
const WITH_VECTORS = !argv.includes("--no-vectors");
const DIM = 1024;
const DB_DIR = path.resolve(process.cwd(), ".scratch/bench-db");

process.env.PORTABLE_DATABASE_DIR = DB_DIR;
process.env.LOCAL_EMBEDDING_ENABLED = "false"; // never load a model here
process.env.LOCAL_LLM_ENABLED = "false";

const WORDS = (
  "مرخصی استعلاجی استحقاقی کارکنان قرارداد حقوق دستمزد بیمه تأمین اجتماعی مالیات پاداش اضافه‌کاری " +
  "شیفت مأموریت سفر هزینه بازپرداخت فاکتور تدارکات خرید مناقصه پیمانکار تحویل انبار کالا موجودی " +
  "ایمنی حادثه گزارش بازرسی آموزش گواهینامه ارزیابی عملکرد ارتقا انتصاب استخدام مصاحبه آزمون " +
  "بودجه هزینه درآمد سود زیان ترازنامه حسابرسی صورتحساب پرداخت دریافت چک وام تسهیلات سپرده " +
  "نرم‌افزار سامانه کاربر رمز عبور دسترسی امنیت شبکه سرور پشتیبان بازیابی خرابی تعمیر نگهداری " +
  "جلسه صورتجلسه مصوبه هیئت مدیره مدیرعامل معاون رئیس کارشناس واحد دفتر شعبه استان شهرستان " +
  "مشتری شکایت رضایت پاسخگویی پیگیری مهلت روز هفته ماه سال ساعت دقیقه درصد ریال تومان"
).split(/\s+/);

const FILLER = "این بند بر اساس آیین‌نامه داخلی سازمان تنظیم شده است و برای همه واحدها لازم‌الاجرا می‌باشد".split(" ");

function rnd(n: number) {
  return Math.floor(Math.random() * n);
}
function sentence(): string {
  const out: string[] = [];
  const len = 8 + rnd(10);
  for (let i = 0; i < len; i++) out.push(Math.random() < 0.6 ? WORDS[rnd(WORDS.length)] : FILLER[rnd(FILLER.length)]);
  if (Math.random() < 0.3) out.push(String(1 + rnd(365)), "روز");
  return out.join(" ") + ".";
}
function chunkText(): string {
  const n = 3 + rnd(4);
  return Array.from({ length: n }, sentence).join(" ");
}
function randomUnitVector(): number[] {
  const v = Array.from({ length: DIM }, () => Math.random() - 0.5);
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

async function main() {
  fs.rmSync(DB_DIR, { recursive: true, force: true });
  const { ensureDatabaseMigrated } = await import("@/db/migrate");
  await ensureDatabaseMigrated();
  const { db, client, isVectorSearchAvailable } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { hybridSearch, buildTsQueries } = await import("@/lib/rag/search");

  const vectors = WITH_VECTORS && isVectorSearchAvailable();
  console.log(`[bench] chunks=${CHUNKS} vectors=${vectors} (pgvector available: ${isVectorSearchAvailable()})`);

  const orgRow = await db.execute<{ id: string }>(sql`SELECT id FROM organizations LIMIT 1`);
  const orgId = (orgRow as unknown as { rows: Array<{ id: string }> }).rows[0].id;

  // Drop the HNSW index during bulk load and build it once at the end — this
  // is how a real bulk import should be done too (10× faster than
  // maintaining the graph row by row).
  if (vectors) await db.execute(sql`DROP INDEX IF EXISTS knowledge_chunks_embedding_hnsw_idx`);

  const DOCS = Math.max(1, Math.floor(CHUNKS / 40));
  const docIds: string[] = [];
  const t0 = Date.now();
  for (let d = 0; d < DOCS; d += 500) {
    const n = Math.min(500, DOCS - d);
    const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO documents (organization_id, title, file_name, mime_type, file_size, sha256, storage_path, status)
      SELECT ${orgId}::uuid, 'سند شماره ' || g, 'doc-' || g || '.pdf', 'application/pdf', 1000, md5(random()::text) || md5(random()::text), 'x/' || g, 'completed'
      FROM generate_series(${d}::int, ${d + n - 1}::int) g RETURNING id
    `);
    docIds.push(...(rows as unknown as { rows: Array<{ id: string }> }).rows.map((r) => r.id));
  }
  console.log(`[bench] ${docIds.length} documents in ${Date.now() - t0}ms`);

  const t1 = Date.now();
  const BATCH = 200;
  for (let i = 0; i < CHUNKS; i += BATCH) {
    const n = Math.min(BATCH, CHUNKS - i);
    const values = [];
    for (let k = 0; k < n; k++) {
      const idx = i + k;
      const docId = docIds[idx % docIds.length];
      const content = chunkText();
      values.push(
        vectors
          ? sql`(${orgId}, 'document', ${docId}::uuid, 'سند', ${idx % 40}, ${content}, ${`[${randomUnitVector().join(",")}]`}::vector)`
          : sql`(${orgId}, 'document', ${docId}::uuid, 'سند', ${idx % 40}, ${content}, NULL)`,
      );
    }
    await db.execute(sql`
      INSERT INTO knowledge_chunks (organization_id, source_type, source_id, source_title, chunk_index, content, embedding)
      VALUES ${sql.join(values, sql`, `)}
    `);
    if ((i / BATCH) % 25 === 0) process.stdout.write(`\r[bench] inserted ${i + n}/${CHUNKS}  ${(((i + n) / ((Date.now() - t1) / 1000)) | 0)} rows/s   `);
  }
  process.stdout.write("\n");
  console.log(`[bench] insert done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  if (vectors) {
    const t2 = Date.now();
    await db.execute(sql`CREATE INDEX knowledge_chunks_embedding_hnsw_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`);
    console.log(`[bench] HNSW build: ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  }
  await db.execute(sql`ANALYZE knowledge_chunks`);
  await db.execute(sql`ANALYZE documents`);

  const sizeRow = await db.execute<{ s: string }>(sql`SELECT pg_size_pretty(pg_total_relation_size('knowledge_chunks')) AS s`);
  console.log(`[bench] knowledge_chunks total size: ${(sizeRow as unknown as { rows: Array<{ s: string }> }).rows[0].s}`);

  // Stub query embedding: random unit vectors (measures index cost only,
  // not retrieval quality — that needs the real model).
  const embedQuery = vectors ? async () => randomUnitVector() : undefined;

  const queries = [
    "مدت مرخصی استعلاجی کارکنان چقدر است؟",
    "نحوه بازپرداخت هزینه مأموریت",
    "شرایط دریافت وام و تسهیلات",
    "گزارش حادثه ایمنی را چه کسی باید تهیه کند",
    "ارزیابی عملکرد سالانه کارشناس",
    "رمز عبور سامانه",
    "مناقصه",
    "چیست؟",
  ];
  console.log("\n[bench] tsquery examples:");
  for (const q of queries.slice(0, 4)) console.log("  ", q, "→", JSON.stringify(buildTsQueries(q)));

  console.log("\n[bench] hybrid search latency (ms):");
  const lat: number[] = [];
  for (let i = 0; i < QUERIES; i++) {
    const q = queries[i % queries.length];
    let diag: unknown = null;
    const t = Date.now();
    const res = await hybridSearch(orgId, q, { diagnostics: (d) => (diag = d), embedQuery });
    const ms = Date.now() - t;
    lat.push(ms);
    console.log(`  ${String(ms).padStart(5)} ms  results=${res.length}  ${JSON.stringify(diag)}  "${q}"`);
  }
  lat.sort((a, b) => a - b);
  console.log(`\n[bench] p50=${lat[Math.floor(lat.length / 2)]}ms  p90=${lat[Math.floor(lat.length * 0.9)]}ms  max=${lat[lat.length - 1]}ms`);

  await client.close();
  fs.rmSync(DB_DIR, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
