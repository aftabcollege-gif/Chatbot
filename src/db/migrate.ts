import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { client } from "@/db";

// PGlite deliberately does not bundle the pgvector extension. The portable
// schema stores embeddings as JSON and uses the built-in PostgreSQL full-text
// index for retrieval, so no external database or extension is required.
function portableMigrationSql(source: string): string {
  return source
    .replace(/CREATE EXTENSION IF NOT EXISTS vector;\s*/g, "")
    .replace(/vector\(1024\)/g, "jsonb")
    .replace(/^CREATE INDEX "knowledge_chunks_embedding_hnsw_idx".*$/gm, "");
}

const globalForMigrations = globalThis as typeof globalThis & {
  __arenaMigrationsPromise?: Promise<void>;
};

/**
 * Apply the bundled schema once to the file-backed PGlite database.
 * The migration marker lives in the same local database and therefore
 * survives restarts and transfers of the portable folder.
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
      const migrationId = "0000_portable_pglite";
      const applied = await client.query<{ id: string }>(
        "SELECT id FROM __portable_migrations WHERE id = $1",
        [migrationId],
      );
      if (applied.rows.length > 0) return;

      const filename = path.join(process.cwd(), "drizzle", "0000_steady_stryfe.sql");
      const source = await fs.readFile(filename, "utf8");
      await client.exec(portableMigrationSql(source));

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
      await client.query(
        "UPDATE setup_status SET completed = true, current_step = 5, organization_name = $1, completed_at = now() WHERE id = 1",
        ["سازمان پیش‌فرض"],
      );
      await client.query("INSERT INTO __portable_migrations (id) VALUES ($1)", [migrationId]);
      console.log("[db] portable PGlite schema applied successfully");
    })().catch((error) => {
      globalForMigrations.__arenaMigrationsPromise = undefined;
      console.error("[db] failed to apply portable schema", error);
      throw error;
    });
  }
  return globalForMigrations.__arenaMigrationsPromise;
}
