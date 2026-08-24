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
