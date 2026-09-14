// Next.js instrumentation hook: runs once when the server process starts.
// It (1) applies pending schema migrations so the database is always ready
// before the first request, and (2) starts the in-process background job
// worker that processes document uploads (extract → chunk → normalize →
// embed → index) and reindex jobs.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureDatabaseMigrated } = await import("@/db/migrate");
    const { startJobWorker } = await import("@/lib/jobs/worker");

    // Start the worker FIRST so jobs queued during (or right after) the
    // initial migration are picked up as soon as the schema exists.
    startJobWorker();

    try {
      await ensureDatabaseMigrated();
    } catch (error) {
      // Degrade gracefully: serve the existing schema; the worker's jobs
      // will fail loudly (and be retried) until the migration succeeds.
      console.error("[instrumentation] database migration failed", error);
    }
  }
}
