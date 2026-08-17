import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { db } from "@/db";

// Ensures the database schema exists before the app tries to read/write it.
// This is what makes the very first run (fresh database, e.g. right after
// deployment) work correctly: without it, the initial setup wizard would
// try to insert into tables that were never created and fail with a
// generic "خطا در راه‌اندازی سیستم" error on the final step.
//
// The migration runner is idempotent (it tracks applied migrations in a
// "drizzle_migrations" table and uses IF NOT EXISTS semantics under the
// hood), so calling it multiple times / from multiple places is safe.

const globalForMigrations = globalThis as typeof globalThis & {
  __arenaMigrationsPromise?: Promise<void>;
};

export function ensureDatabaseMigrated(): Promise<void> {
  if (!globalForMigrations.__arenaMigrationsPromise) {
    const migrationsFolder = path.join(process.cwd(), "drizzle");
    globalForMigrations.__arenaMigrationsPromise = migrate(db, {
      migrationsFolder,
    })
      .then(() => {
        console.log("[db] migrations applied successfully");
      })
      .catch((error) => {
        console.error("[db] failed to apply migrations", error);
        // Allow future calls to retry instead of caching a permanent failure.
        globalForMigrations.__arenaMigrationsPromise = undefined;
        throw error;
      });
  }
  return globalForMigrations.__arenaMigrationsPromise;
}
