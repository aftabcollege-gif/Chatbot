import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { client } from "@/db";
import { normalizeForIndex } from "@/lib/text/normalize";

// PGlite deliberately does not bundle the pgvector extension. The portable
// schema stores embeddings as JSON and uses the built-in PostgreSQL full-text
// index for retrieval, so no external database or extension is required.
function portableMigrationSql(source: string): string {
  return source
    .replace(/CREATE EXTENSION IF NOT EXISTS vector;\s*/g, "")
    .replace(/vector\(1024\)/g, "jsonb")
    .replace(/^CREATE INDEX "knowledge_chunks_embedding_hnsw_idx".*$/gm, "");
}

/**
 * Migration 0001 — Persian full-text fix for databases created by 0000.
 *
 * 0000 computed `content_tsv` from the RAW `content` column. The PostgreSQL
 * default parser keeps the Persian ZWNJ inside indexed tokens, which made a
 * large share of Persian vocabulary unmatchable. This migration:
 *   1. adds `content_norm` (normalized copy of `content`),
 *   2. backfills it using the exact same normalizer the ingest pipeline uses,
 *   3. switches the generated `content_tsv` column to `content_norm`,
 *   4. rebuilds the GIN index.
 * Existing uploads become searchable WITHOUT re-uploading the files.
 */
async function migratePersianFts(): Promise<void> {
  const hasCol = async (col: string) =>
    (
      await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM information_schema.columns
         WHERE table_name = 'knowledge_chunks' AND column_name = $1`,
        [col],
      )
    ).rows[0].n;

  if (!(await hasCol("content_norm"))) {
    await client.exec(`ALTER TABLE "knowledge_chunks" ADD COLUMN "content_norm" text;`);
  }

  // Backfill content_norm from the raw content with the app-level normalizer
  // (ZWNJ -> space, ي/ك/ة unification, digit unification, diacritic removal).
  const total = (
    await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "knowledge_chunks" WHERE "content_norm" IS NULL`,
    )
  ).rows[0].n;
  if (total > 0) {
    const BATCH = 200;
    let done = 0;
    while (done < total) {
      const rows = (
        await client.query<{ id: string; content: string }>(
          `SELECT id, content FROM "knowledge_chunks"
           WHERE "content_norm" IS NULL LIMIT $1`,
          [BATCH],
        )
      ).rows;
      if (rows.length === 0) break;
      for (const row of rows) {
        await client.query(
          `UPDATE "knowledge_chunks" SET "content_norm" = $2 WHERE id = $1`,
          [row.id, normalizeForIndex(row.content)],
        );
      }
      done += rows.length;
    }
    console.log(`[db] Persian FTS: normalized ${done} legacy chunks`);
  }

  // Switch the generated tsvector column to the normalized copy (only if it
  // still references the raw content).
  const def = (
    await client.query<{ expr: string | null }>(
      `SELECT pg_get_expr(d.adbin, d.adrelid) AS expr
       FROM pg_attrdef d
       JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       WHERE a.attrelid = '"knowledge_chunks"'::regclass AND a.attname = 'content_tsv'`,
    )
  ).rows[0]?.expr;
  if (def && def.includes("content") && !def.includes("content_norm")) {
    await client.exec(`ALTER TABLE "knowledge_chunks" DROP COLUMN "content_tsv";`);
    await client.exec(
      `ALTER TABLE "knowledge_chunks" ADD COLUMN "content_tsv" "tsvector"
       GENERATED ALWAYS AS (to_tsvector('simple', coalesce("content_norm", ''))) STORED;`,
    );
    console.log("[db] Persian FTS: content_tsv now generated from content_norm");
  }

  await client.exec(
    `CREATE INDEX IF NOT EXISTS "knowledge_chunks_tsv_idx" ON "knowledge_chunks" USING gin ("content_tsv");`,
  );

  // Job results (added for the reindex UI feedback).
  await client.exec(`ALTER TABLE "processing_jobs" ADD COLUMN IF NOT EXISTS "result" text;`);
}

interface Migration {
  id: string;
  apply: () => Promise<void>;
}

const migrations: Migration[] = [
  {
    id: "0000_portable_pglite",
    apply: async () => {
      const filename = path.join(process.cwd(), "drizzle", "0000_steady_stryfe.sql");
      const source = await fs.readFile(filename, "utf8");
      try {
        await client.exec(portableMigrationSql(source));
      } catch (error) {
        // An existing install whose migration marker was lost: the schema is
        // already present (0000 is not idempotent — plain CREATE TABLE).
        // Verify the core tables and continue instead of failing startup.
        const code = (error as { code?: string })?.code;
        const tables = (
          await client.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM information_schema.tables
             WHERE table_schema = 'public'
               AND table_name IN ('organizations','users','documents','knowledge_chunks','setup_status')`,
          )
        ).rows[0]?.n ?? 0;
        if (code !== "42P07" || tables < 5) throw error;
        console.log("[db] 0000 schema already present; skipping table creation");
      }

      // A usable local database is included from the first launch. The
      // bootstrap account is intentionally marked in preferences so the UI
      // can require a password change before ordinary use.
      const orgCount =
        (
          await client.query<{ n: number }>("SELECT count(*)::int AS n FROM organizations")
        ).rows[0]?.n ?? 0;
      if (orgCount > 0) return;

      const orgId = crypto.randomUUID();
      const departmentId = crypto.randomUUID();
      const adminId = crypto.randomUUID();
      const initialPasswordHash = "$2b$12$we2lb1xZyKhwdKWvFMMS9u7xUzgN5y6/ER7xSF71lDkVqD2sD.BsS"; // ChangeMe123!
      await client.query(
        "INSERT INTO organizations (id, name, slug, is_active) VALUES ($1, $2, $3, true)",
        [orgId, "سازمان پیش‌فرض", "default-organization"],
      );
      await client.query(
        "INSERT INTO departments (id, organization_id, name, is_active) VALUES ($1, $2, $3, true)",
        [departmentId, orgId, "واحد مرکزی"],
      );
      await client.query(
        `INSERT INTO users (id, organization_id, department_id, name, email, username, password_hash, role, is_superadmin, is_active, preferences)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'admin', true, true, $8::jsonb)`,
        [adminId, orgId, departmentId, "مدیر سامانه", "admin@localhost", "admin", initialPasswordHash, JSON.stringify({ mustChangePassword: true })],
      );
      await client.query(
        "UPDATE setup_status SET completed = true, current_step = 5, organization_name = $1, completed_at = now() WHERE id = 1",
        ["سازمان پیش‌فرض"],
      );
      console.log("[db] portable PGlite schema applied successfully");
    },
  },
  { id: "0001_persian_fts", apply: migratePersianFts },
];

const globalForMigrations = globalThis as typeof globalThis & {
  __arenaMigrationsPromise?: Promise<void>;
};

/**
 * Apply the bundled schema once to the file-backed PGlite database.
 * Migration markers live in the same local database and therefore survive
 * restarts and transfers of the portable folder. Migrations run in order and
 * are skipped once their marker is present, so existing installs are upgraded
 * in place on the next start.
 */
export function ensureDatabaseMigrated(): Promise<void> {
  if (!globalForMigrations.__arenaMigrationsPromise) {
    globalForMigrations.__arenaMigrationsPromise = (async () => {
      await client.exec(`
        CREATE TABLE IF NOT EXISTS __portable_migrations (
          id text PRIMARY KEY,
          applied_at timestamp with time zone NOT NULL DEFAULT now()
        );
      `);
      const appliedRows = (
        await client.query<{ id: string }>(
          "SELECT id FROM __portable_migrations",
        )
      ).rows;
      const applied = new Set(appliedRows.map((r) => r.id));

      for (const migration of migrations) {
        if (applied.has(migration.id)) continue;
        await migration.apply();
        await client.query(
          "INSERT INTO __portable_migrations (id) VALUES ($1)",
          [migration.id],
        );
        console.log(`[db] migration ${migration.id} applied`);
      }
    })().catch((error) => {
      globalForMigrations.__arenaMigrationsPromise = undefined;
      console.error("[db] failed to apply portable schema", error);
      throw error;
    });
  }
  return globalForMigrations.__arenaMigrationsPromise;
}
