// Next.js instrumentation hook: runs once when the server process starts.
//
// NOTE: with a `src/` directory Next.js only honours `src/instrumentation.ts`
// (a root-level `instrumentation.ts` is silently ignored), so everything that
// must happen at boot lives here:
//
//   1. apply pending database migrations (base schema + scale/pgvector
//      upgrade) so the schema exists before the very first request;
//   2. start the background ingestion worker;
//   3. start the periodic maintenance task (rate-limit / session purge,
//      orphaned-job requeue, ANALYZE).
export async function register() {
  // Only in the real Node.js server runtime — never during edge/middleware
  // compilation or static analysis.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { ensureDatabaseMigrated } = await import("@/db/migrate");
  try {
    await ensureDatabaseMigrated();
  } catch (error) {
    console.error("[instrumentation] database migration failed", error);
  }

  if (process.env.DISABLE_JOB_WORKER === "true") {
    console.log("[instrumentation] job worker disabled by DISABLE_JOB_WORKER");
    return;
  }
  const { startJobWorker } = await import("@/lib/jobs/worker");
  startJobWorker();

  const { startMaintenanceScheduler } = await import("@/lib/jobs/maintenance");
  startMaintenanceScheduler();
}
