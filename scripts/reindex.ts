#!/usr/bin/env -S npx tsx
/**
 * Back-fill missing embeddings — offline CLI.
 *
 *   npm run reindex                # embed every chunk whose vector is NULL
 *   npm run reindex -- --all       # re-embed everything (model change)
 *   npm run reindex -- --batch 64  # embedding batch size (default 32)
 *
 * Typical use: documents were imported while the embedding model was not
 * installed (keyword-only). After `node scripts/install-model.mjs --embedding`
 * run this once; semantic search starts working for those chunks without
 * re-extracting or re-chunking any file.
 *
 * Stop the app first (PGlite is single-writer).
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env") });

async function main() {
  const argv = process.argv.slice(2);
  const all = argv.includes("--all");
  const batchIdx = argv.indexOf("--batch");
  const batchSize = batchIdx >= 0 ? Math.max(1, Number(argv[batchIdx + 1]) || 32) : 32;

  const { ensureDatabaseMigrated } = await import("@/db/migrate");
  await ensureDatabaseMigrated();
  const { db, client, isVectorSearchAvailable } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  type SQL = import("drizzle-orm").SQL;
  const { getEmbeddingProvider } = await import("@/lib/ai/provider-factory");

  if (!isVectorSearchAvailable()) {
    throw new Error("pgvector is not available in this database; semantic reindex is not possible.");
  }

  const provider = getEmbeddingProvider();
  const health = await provider.health();
  if (!health.available) {
    throw new Error(`Embedding model unavailable: ${health.detail ?? "unknown"}. Run: node scripts/install-model.mjs --embedding`);
  }
  console.log(`[reindex] embedding model: ${health.modelName}`);

  const where = all ? sql`` : sql`WHERE embedding IS NULL`;
  const totalRow = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM knowledge_chunks ${where}`);
  const total = Number((totalRow as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0);
  console.log(`[reindex] chunks to embed: ${total}`);
  if (total === 0) {
    await client.close();
    return;
  }

  const started = Date.now();
  let done = 0;
  let lastId: string | null = null;

  interface ChunkRow {
    id: string;
    content: string;
  }

  for (;;) {
    // Keyset pagination — stable and O(log n) regardless of table size.
    const cursor: SQL = lastId ? sql`AND id > ${lastId}::uuid` : sql``;
    const baseWhere: SQL = all ? sql`WHERE true` : sql`WHERE embedding IS NULL`;
    const page = await db.execute(sql`
      SELECT id, content FROM knowledge_chunks ${baseWhere} ${cursor} ORDER BY id LIMIT ${batchSize}
    `);
    const rows = (page as unknown as { rows: ChunkRow[] }).rows;
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;

    const embeddings = await provider.embed(rows.map((r: ChunkRow) => r.content), "passage");
    // One UPDATE per batch via VALUES join.
    const values: SQL[] = [];
    rows.forEach((r: ChunkRow, i: number) => {
      const vec = embeddings[i]?.vector;
      if (vec && vec.length > 0) values.push(sql`(${r.id}::uuid, ${`[${vec.join(",")}]`}::vector)`);
    });
    if (values.length > 0) {
      await db.execute(sql`
        UPDATE knowledge_chunks kc SET embedding = v.embedding
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, embedding)
        WHERE kc.id = v.id
      `);
    }

    done += rows.length;
    const elapsed = (Date.now() - started) / 1000;
    const rate = done / Math.max(1, elapsed);
    const eta = (total - done) / Math.max(0.01, rate);
    process.stdout.write(`\r[reindex] ${done}/${total}  ${rate.toFixed(1)} chunks/s  ETA ${(eta / 60).toFixed(1)} min   `);
  }
  process.stdout.write("\n");
  console.log(`[reindex] finished in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  await client.close();
}

main().catch((error) => {
  console.error("\n[reindex] error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
