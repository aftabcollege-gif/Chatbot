import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { client, markVectorSearchAvailable } from "@/db";
import { EMBEDDING_DIMENSIONS } from "@/db/schema";
import { FA_NORMALIZE_FUNCTION_SQL, FA_NORMALIZE_VERSION } from "@/lib/text/persian";
import { seedSystemData } from "@/lib/seed";

// pgvector is bundled with PGlite via @electric-sql/pglite-pgvector, so the
// schema can use the real `vector(1024)` type and an HNSW index. In case the
// extension fails to load on some machine, the schema is still applied with a
// jsonb column and the app degrades to keyword-only retrieval.
function portableMigrationSql(source: string, vectorAvailable: boolean): string {
  if (vectorAvailable) return source;
  return source
    .replace(/CREATE EXTENSION IF NOT EXISTS vector;\s*/g, "")
    .replace(/vector\(1024\)/g, "jsonb")
    .replace(/^CREATE INDEX "knowledge_chunks_embedding_hnsw_idx".*$/gm, "");
}

const globalForMigrations = globalThis as typeof globalThis & {
  __arenaMigrationsPromise?: Promise<void>;
  __arenaMigrationState?: MigrationState;
};

export type MigrationState =
  | { status: "pending" }
  | { status: "running"; startedAt: string }
  | { status: "ok"; finishedAt: string; durationMs: number }
  | { status: "failed"; error: string; failedAt: string };

/**
 * Last known outcome of `ensureDatabaseMigrated()` in this process. Surfaced
 * by /api/health so a broken bundle (missing schema file, unwritable database
 * directory, …) is reported as `ok: false` instead of a healthy-looking server
 * whose every request then fails with "relation does not exist".
 */
export function migrationState(): MigrationState {
  return globalForMigrations.__arenaMigrationState ?? { status: "pending" };
}

async function tryEnableVectorExtension(): Promise<boolean> {
  try {
    await client.exec("CREATE EXTENSION IF NOT EXISTS vector;");
    markVectorSearchAvailable(true);
    return true;
  } catch (error) {
    console.error(
      "[db] pgvector extension could not be enabled — semantic search disabled, keyword search only:",
      error,
    );
    markVectorSearchAvailable(false);
    return false;
  }
}

async function isMigrationApplied(id: string): Promise<boolean> {
  const applied = await client.query<{ id: string }>(
    "SELECT id FROM __portable_migrations WHERE id = $1",
    [id],
  );
  return applied.rows.length > 0;
}

async function markMigrationApplied(id: string): Promise<void> {
  await client.query("INSERT INTO __portable_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
}

/**
 * 0000: bundled Drizzle schema + bootstrap organisation/admin account.
 */
async function applyBaseSchema(vectorAvailable: boolean): Promise<void> {
  const filename = path.join(process.cwd(), "drizzle", "0000_steady_stryfe.sql");
  const source = await fs.readFile(filename, "utf8");
  await client.exec(portableMigrationSql(source, vectorAvailable));

  // A usable local database is included from the first launch. The
  // bootstrap account is intentionally marked in preferences so the UI
  // can require a password change before ordinary use.
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
  // The table starts empty, so this must be an upsert (a plain UPDATE used
  // to match no row and left the setup wizard re-runnable).
  await client.query(
    `INSERT INTO setup_status (id, completed, current_step, organization_name, completed_at)
     VALUES (1, true, 5, $1, now())
     ON CONFLICT (id) DO UPDATE
       SET completed = true, current_step = 5, organization_name = EXCLUDED.organization_name, completed_at = now()`,
    ["سازمان پیش‌فرض"],
  );
}

/**
 * 0001: scale-out changes for large corpora (100k+ documents).
 *
 *  - knowledge_chunks.embedding: jsonb → vector(1024) + HNSW index
 *    (databases created before pgvector was bundled stored embeddings as
 *    jsonb; zero vectors written as a placeholder are converted to NULL).
 *  - content_tsv is rebuilt over `fa_normalize(content)` so Arabic/Persian
 *    letter variants, digits and ZWNJ all match consistently.
 *  - composite/partial indexes that the hot retrieval and job-claim queries
 *    need to stay O(log n) instead of scanning the table.
 *
 * Idempotent: every statement checks the current catalog state, so it is safe
 * to re-run on a partially upgraded database.
 */
async function applyScaleMigration(vectorAvailable: boolean): Promise<void> {
  await client.exec(FA_NORMALIZE_FUNCTION_SQL);

  if (vectorAvailable) {
    await client.exec(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'knowledge_chunks' AND column_name = 'embedding' AND data_type = 'jsonb'
        ) THEN
          ALTER TABLE knowledge_chunks
            ALTER COLUMN embedding TYPE vector(${EMBEDDING_DIMENSIONS})
            USING (
              CASE
                WHEN embedding IS NULL
                  OR jsonb_typeof(embedding) <> 'array'
                  OR jsonb_array_length(embedding) <> ${EMBEDDING_DIMENSIONS}
                THEN NULL
                ELSE embedding::text::vector(${EMBEDDING_DIMENSIONS})
              END
            );
        END IF;
      END $$;
    `);
    // Placeholder all-zero vectors (written when no embedding model was
    // installed) are meaningless for cosine distance — drop them so the HNSW
    // index only contains real embeddings.
    await client.exec(`
      UPDATE knowledge_chunks SET embedding = NULL
      WHERE embedding IS NOT NULL AND vector_norm(embedding) = 0;
    `);
    await client.exec(`
      CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw_idx
        ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
    `);
  }

  // Rebuild the generated tsvector column over normalised text. The
  // expression of a generated column cannot be altered in place, so the
  // column (and its GIN index) are dropped and recreated.
  await client.exec(`
    DO $$
    DECLARE
      current_expr text;
    BEGIN
      SELECT pg_get_expr(d.adbin, d.adrelid) INTO current_expr
      FROM pg_attrdef d
      JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE d.adrelid = 'knowledge_chunks'::regclass AND a.attname = 'content_tsv';

      IF current_expr IS NULL OR position('fa_normalize' in current_expr) = 0 THEN
        DROP INDEX IF EXISTS knowledge_chunks_tsv_idx;
        ALTER TABLE knowledge_chunks DROP COLUMN IF EXISTS content_tsv;
        ALTER TABLE knowledge_chunks
          ADD COLUMN content_tsv tsvector
          GENERATED ALWAYS AS (to_tsvector('simple', fa_normalize(content))) STORED;
        CREATE INDEX knowledge_chunks_tsv_idx ON knowledge_chunks USING gin (content_tsv);
      END IF;
    END $$;
  `);

  // Retrieval filters by organisation + source, and joins back to the
  // source tables; keep those lookups index-only.
  await client.exec(`
    CREATE INDEX IF NOT EXISTS knowledge_chunks_org_source_idx
      ON knowledge_chunks (organization_id, source_type, source_id);
    CREATE INDEX IF NOT EXISTS documents_retrieval_idx
      ON documents (id) WHERE is_deleted = false AND status = 'completed';
    CREATE INDEX IF NOT EXISTS experiences_retrieval_idx
      ON experiences (id) WHERE is_deleted = false AND status = 'PUBLISHED';
    CREATE INDEX IF NOT EXISTS processing_jobs_claim_idx
      ON processing_jobs (created_at) WHERE status = 'PENDING';
    CREATE INDEX IF NOT EXISTS documents_org_created_idx
      ON documents (organization_id, created_at DESC);
  `);

  // Bulk-import bookkeeping: which on-disk file (by path hash) produced
  // which document, so re-running a folder import is incremental.
  await client.exec(`
    CREATE TABLE IF NOT EXISTS import_batches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      source_path text NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'RUNNING',
      total_files integer NOT NULL DEFAULT 0,
      imported_files integer NOT NULL DEFAULT 0,
      skipped_files integer NOT NULL DEFAULT 0,
      failed_files integer NOT NULL DEFAULT 0,
      error text,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    );
  `);
}

/**
 * 0002: request-path performance for many concurrent users.
 *
 *  - rate_limit_buckets: one row per (key, window) updated with an atomic
 *    UPSERT (replaces the per-attempt log table that grew without bound).
 *  - sessions(token_hash): every authenticated request looks a session up by
 *    token hash; without this index that was a sequential scan.
 *  - conversations / messages / audit_logs ordering indexes so list
 *    endpoints stay O(log n) as history accumulates.
 *  - statistics refresh so the planner has row estimates for tables that
 *    were bulk loaded before autovacuum ever looked at them.
 *
 * Idempotent (IF NOT EXISTS everywhere).
 */
async function applyPerformanceMigration(): Promise<void> {
  await client.exec(`
    CREATE TABLE IF NOT EXISTS rate_limit_buckets (
      bucket_key varchar(250) NOT NULL,
      window_start timestamptz NOT NULL,
      count integer NOT NULL DEFAULT 0,
      PRIMARY KEY (bucket_key, window_start)
    );
    CREATE INDEX IF NOT EXISTS sessions_token_hash_idx
      ON sessions (token_hash) WHERE is_revoked = false;
    CREATE INDEX IF NOT EXISTS sessions_expires_idx
      ON sessions (expires_at);
    CREATE INDEX IF NOT EXISTS conversations_user_updated_idx
      ON conversations (user_id, updated_at DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
      ON messages (conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS audit_logs_org_created_idx
      ON audit_logs (organization_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS audit_logs_created_idx
      ON audit_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS documents_org_status_created_idx
      ON documents (organization_id, status, created_at DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS documents_org_title_idx
      ON documents (organization_id, lower(title)) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS knowledge_items_org_created_idx
      ON knowledge_items (organization_id, created_at DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS experiences_org_created_idx
      ON experiences (organization_id, created_at DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS processing_jobs_org_status_idx
      ON processing_jobs (organization_id, status);
  `);
  // The legacy per-attempt table is no longer written; drop its rows so it
  // stops taking space (the table itself stays for schema compatibility).
  await client.exec(`TRUNCATE rate_limit_attempts;`).catch(() => undefined);
  await client.exec(
    `ANALYZE documents; ANALYZE knowledge_chunks; ANALYZE processing_jobs; ANALYZE sessions; ANALYZE users;`,
  );
}

/**
 * Recompute the keyword index with the current fa_normalize. Dropping and
 * re-adding the generated column is the only way PostgreSQL recomputes stored
 * generated values; the GIN index is rebuilt afterwards. Cost is one pass
 * over knowledge_chunks (~0.5 ms/chunk) — logged so long upgrades are visible.
 */
async function rebuildKeywordIndex(): Promise<void> {
  await client.exec(FA_NORMALIZE_FUNCTION_SQL);
  const countRow = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM knowledge_chunks");
  const total = Number(countRow.rows[0]?.n ?? 0);
  if (total > 0) console.log(`[db] rebuilding keyword index for ${total} chunks (fa_normalize v${FA_NORMALIZE_VERSION})…`);
  const started = Date.now();
  await client.exec(`
    DROP INDEX IF EXISTS knowledge_chunks_tsv_idx;
    ALTER TABLE knowledge_chunks DROP COLUMN IF EXISTS content_tsv;
    ALTER TABLE knowledge_chunks
      ADD COLUMN content_tsv tsvector
      GENERATED ALWAYS AS (to_tsvector('simple', fa_normalize(content))) STORED;
    CREATE INDEX knowledge_chunks_tsv_idx ON knowledge_chunks USING gin (content_tsv);
    ANALYZE knowledge_chunks;
  `);
  console.log(`[db] keyword index rebuilt in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

/**
 * Retrieval visibility for the knowledge base + experience status fix.
 *
 *  - experiences_retrieval_idx was created with a lower-case `'published'`
 *    predicate while the API writes `PUBLISHED`; recreate it so the retrieval
 *    EXISTS probe is index-backed (and, more importantly, so published
 *    experiences are retrievable at all — the search predicate had the same
 *    case mismatch);
 *  - knowledge_items become a chunked RAG source (source_type = 'knowledge'),
 *    so they get the same partial index;
 *  - legacy lower-case experience statuses written by older builds are
 *    upper-cased in place.
 */
async function applyKnowledgeRetrievalMigration(): Promise<void> {
  await client.exec(`
    UPDATE experiences SET status = upper(status) WHERE status <> upper(status);
    UPDATE experiences SET status = 'SUBMITTED' WHERE status = 'PENDING_APPROVAL';
    UPDATE experiences SET status = 'CHANGES_REQUESTED' WHERE status = 'REJECTED';
    ALTER TABLE experiences ALTER COLUMN status SET DEFAULT 'DRAFT';
    DROP INDEX IF EXISTS experiences_retrieval_idx;
    CREATE INDEX IF NOT EXISTS experiences_retrieval_idx
      ON experiences (id) WHERE is_deleted = false AND status = 'PUBLISHED';
    CREATE INDEX IF NOT EXISTS knowledge_items_retrieval_idx
      ON knowledge_items (id) WHERE is_deleted = false AND deleted_at IS NULL AND status = 'PUBLISHED';
  `);

  // Earlier builds "indexed" a published experience by writing a jsonb
  // embedding on the experiences row itself and never produced
  // knowledge_chunks, so nothing was retrievable. Back-fill by queueing an
  // ingest job for every published experience / knowledge item that has no
  // chunks yet; the background worker drains the queue after boot.
  await client.exec(`
    INSERT INTO processing_jobs (organization_id, type, resource_id, status, payload)
    SELECT e.organization_id, 'experience_ingest', e.id, 'PENDING',
           jsonb_build_object('title', e.title, 'backfill', true)
    FROM experiences e
    WHERE e.is_deleted = false AND e.status = 'PUBLISHED'
      AND NOT EXISTS (
        SELECT 1 FROM knowledge_chunks kc WHERE kc.source_type = 'experience' AND kc.source_id = e.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM processing_jobs j
        WHERE j.type = 'experience_ingest' AND j.resource_id = e.id AND j.status IN ('PENDING', 'PROCESSING')
      );
    INSERT INTO processing_jobs (organization_id, type, resource_id, status, payload)
    SELECT k.organization_id, 'knowledge_ingest', k.id, 'PENDING',
           jsonb_build_object('title', k.title, 'backfill', true)
    FROM knowledge_items k
    WHERE k.is_deleted = false AND k.deleted_at IS NULL AND k.status = 'PUBLISHED'
      AND NOT EXISTS (
        SELECT 1 FROM knowledge_chunks kc WHERE kc.source_type = 'knowledge' AND kc.source_id = k.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM processing_jobs j
        WHERE j.type = 'knowledge_ingest' AND j.resource_id = k.id AND j.status IN ('PENDING', 'PROCESSING')
      );
  `);
}

/**
 * Apply the bundled schema once to the file-backed PGlite database, then any
 * incremental upgrades. The migration markers live in the same local
 * database and therefore survive restarts and transfers of the portable
 * folder.
 */
export function ensureDatabaseMigrated(): Promise<void> {
  if (!globalForMigrations.__arenaMigrationsPromise) {
    const startedAt = Date.now();
    globalForMigrations.__arenaMigrationState = { status: "running", startedAt: new Date(startedAt).toISOString() };
    globalForMigrations.__arenaMigrationsPromise = (async () => {
      await client.exec(`
        CREATE TABLE IF NOT EXISTS __portable_migrations (
          id text PRIMARY KEY,
          applied_at timestamp with time zone NOT NULL DEFAULT now()
        );
      `);

      const vectorAvailable = await tryEnableVectorExtension();

      const baseId = "0000_portable_pglite";
      if (!(await isMigrationApplied(baseId))) {
        await applyBaseSchema(vectorAvailable);
        await markMigrationApplied(baseId);
        console.log("[db] portable PGlite schema applied successfully");
      }

      // The scale migration is keyed on whether pgvector was available when
      // it ran, so a database first migrated without the extension is
      // upgraded automatically once the extension loads.
      const scaleId = vectorAvailable ? "0001_scale_pgvector" : "0001_scale_keyword_only";
      let scaleAppliedNow = false;
      if (!(await isMigrationApplied(scaleId))) {
        await applyScaleMigration(vectorAvailable);
        await markMigrationApplied(scaleId);
        scaleAppliedNow = true;
        console.log(`[db] scale migration applied (${scaleId})`);
      }

      const perfId = "0002_performance";
      if (!(await isMigrationApplied(perfId))) {
        await applyPerformanceMigration();
        await markMigrationApplied(perfId);
        console.log(`[db] performance migration applied (${perfId})`);
      }

      // System roles/permissions. The portable bootstrap marks setup as
      // completed, which used to skip the seeder entirely — leaving every
      // non-superadmin account without a single permission. Idempotent, so
      // it also back-fills databases created by earlier builds.
      const rbacId = "0003_rbac_seed";
      if (!(await isMigrationApplied(rbacId))) {
        await seedSystemData();
        // Databases bootstrapped by earlier builds have an organisation and a
        // superadmin but no completed setup_status row — mark setup done so
        // the wizard cannot create a second organisation on top of them.
        await client.exec(`
          INSERT INTO setup_status (id, completed, current_step, organization_name, completed_at)
          SELECT 1, true, 5, (SELECT name FROM organizations ORDER BY created_at LIMIT 1), now()
          WHERE EXISTS (SELECT 1 FROM users WHERE is_superadmin = true)
          ON CONFLICT (id) DO UPDATE
            SET completed = true,
                current_step = 5,
                organization_name = COALESCE(setup_status.organization_name, EXCLUDED.organization_name),
                completed_at = COALESCE(setup_status.completed_at, now());
        `);
        await markMigrationApplied(rbacId);
        console.log(`[db] system roles and permissions seeded (${rbacId})`);
      }

      const knowledgeId = "0004_knowledge_retrieval";
      if (!(await isMigrationApplied(knowledgeId))) {
        await applyKnowledgeRetrievalMigration();
        await markMigrationApplied(knowledgeId);
        console.log(`[db] knowledge retrieval migration applied (${knowledgeId})`);
      }

      // Keyword tokenizer version. The scale migration above always installs
      // the current fa_normalize and (re)builds content_tsv with it, so a
      // database that ran it in this boot is already up to date; one that ran
      // an older version needs its stored tsvectors recomputed once.
      const tsvId = `0005_fa_normalize_v${FA_NORMALIZE_VERSION}`;
      if (!(await isMigrationApplied(tsvId))) {
        if (!scaleAppliedNow) {
          await rebuildKeywordIndex();
        }
        await markMigrationApplied(tsvId);
      }
      globalForMigrations.__arenaMigrationState = {
        status: "ok",
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
      };
    })().catch((error) => {
      globalForMigrations.__arenaMigrationsPromise = undefined;
      globalForMigrations.__arenaMigrationState = {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        failedAt: new Date().toISOString(),
      };
      console.error("[db] failed to apply portable schema", error);
      throw error;
    });
  }
  return globalForMigrations.__arenaMigrationsPromise;
}
