import { sql } from "drizzle-orm";
import { db } from "@/db";
import { cleanOldRateLimits } from "@/lib/rate-limit";

/**
 * Light housekeeping that keeps the hot tables small and the planner
 * statistics fresh on a long-running portable installation:
 *
 *  - purge finished rate-limit windows and long-expired sessions;
 *  - requeue jobs stuck in PROCESSING (process killed mid-job) so a crash
 *    never leaves documents in "processing" forever;
 *  - prune old COMPLETED job rows (the documents themselves are untouched);
 *  - ANALYZE the tables whose row counts change the most so retrieval and
 *    list queries keep using the right indexes after bulk imports.
 *
 * Everything is idempotent and cheap; it runs shortly after boot and then
 * every MAINTENANCE_INTERVAL_MINUTES (default 30).
 */

interface MaintenanceState {
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  lastRunAt: Date | null;
  lastResult: MaintenanceResult | null;
}

export interface MaintenanceResult {
  rateLimitRows: number;
  expiredSessions: number;
  requeuedJobs: number;
  prunedJobs: number;
  durationMs: number;
  error?: string;
}

const globalForMaintenance = globalThis as typeof globalThis & { __maintenanceState?: MaintenanceState };
const state: MaintenanceState = (globalForMaintenance.__maintenanceState ??= {
  timer: null,
  running: false,
  lastRunAt: null,
  lastResult: null,
});

function readMinutes(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const INTERVAL_MINUTES = readMinutes("MAINTENANCE_INTERVAL_MINUTES", 30);
/** Jobs still PROCESSING after this long are assumed orphaned. */
const STALE_JOB_MINUTES = readMinutes("STALE_JOB_MINUTES", 120);
/** Completed job bookkeeping older than this is pruned. */
const JOB_RETENTION_DAYS = readMinutes("JOB_RETENTION_DAYS", 30);

function affected(result: unknown): number {
  return Number((result as { affectedRows?: number })?.affectedRows ?? 0);
}

export async function runMaintenanceOnce(): Promise<MaintenanceResult> {
  if (state.running) {
    return state.lastResult ?? { rateLimitRows: 0, expiredSessions: 0, requeuedJobs: 0, prunedJobs: 0, durationMs: 0 };
  }
  state.running = true;
  const started = Date.now();
  const result: MaintenanceResult = { rateLimitRows: 0, expiredSessions: 0, requeuedJobs: 0, prunedJobs: 0, durationMs: 0 };
  try {
    result.rateLimitRows = await cleanOldRateLimits();

    result.expiredSessions = affected(
      await db.execute(sql`DELETE FROM sessions WHERE expires_at < now() - INTERVAL '7 days'`),
    );

    result.requeuedJobs = affected(
      await db.execute(sql`
        UPDATE processing_jobs
        SET status = 'PENDING', started_at = NULL,
            error = COALESCE(error, '') || ' [requeued after interrupted run]'
        WHERE status = 'PROCESSING'
          AND started_at < now() - make_interval(mins => ${STALE_JOB_MINUTES}::int)
      `),
    );

    result.prunedJobs = affected(
      await db.execute(sql`
        DELETE FROM processing_jobs
        WHERE status = 'COMPLETED'
          AND completed_at < now() - make_interval(days => ${JOB_RETENTION_DAYS}::int)
      `),
    );

    await db.execute(sql`ANALYZE documents`);
    await db.execute(sql`ANALYZE knowledge_chunks`);
    await db.execute(sql`ANALYZE processing_jobs`);
    await db.execute(sql`ANALYZE sessions`);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    console.error("[maintenance] run failed:", result.error);
  } finally {
    result.durationMs = Date.now() - started;
    state.running = false;
    state.lastRunAt = new Date();
    state.lastResult = result;
  }
  return result;
}

export function startMaintenanceScheduler(): void {
  if (state.timer) return;
  // First run shortly after boot (after migrations), then periodically.
  const first = setTimeout(() => void runMaintenanceOnce(), 20_000);
  first.unref?.();
  state.timer = setInterval(() => void runMaintenanceOnce(), INTERVAL_MINUTES * 60_000);
  state.timer.unref?.();
}

export function stopMaintenanceScheduler(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

export function maintenanceStatus(): { lastRunAt: string | null; lastResult: MaintenanceResult | null; intervalMinutes: number } {
  return { lastRunAt: state.lastRunAt?.toISOString() ?? null, lastResult: state.lastResult, intervalMinutes: INTERVAL_MINUTES };
}
