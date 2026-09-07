import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Fixed-window rate limiter backed by the local database.
 *
 * One atomic UPSERT per check (`INSERT … ON CONFLICT DO UPDATE … RETURNING`)
 * instead of the previous COUNT + INSERT pair, and one row per
 * (key, action, window) instead of one row per attempt — the table stays
 * tiny no matter how many requests arrive, and the check costs a single
 * primary-key lookup. Windows are aligned to the clock, so `resetAt` is
 * exact. Old windows are purged by the periodic maintenance task.
 */

export interface RateLimitConfig {
  maxAttempts: number;
  windowMinutes: number;
}

function readInt(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const CONFIGS: Record<string, RateLimitConfig> = {
  login: {
    maxAttempts: readInt(process.env.RATE_LIMIT_LOGIN_MAX, 5),
    windowMinutes: readInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MINUTES, 15),
  },
  chat: {
    maxAttempts: readInt(process.env.RATE_LIMIT_CHAT_MAX, 30),
    windowMinutes: readInt(process.env.RATE_LIMIT_CHAT_WINDOW_MINUTES, 1),
  },
  // Abuse guard only: multi-file uploads from the UI legitimately send a few
  // hundred files per hour; bulk loads should use the folder importer.
  upload: {
    maxAttempts: readInt(process.env.RATE_LIMIT_UPLOAD_MAX, 300),
    windowMinutes: readInt(process.env.RATE_LIMIT_UPLOAD_WINDOW_MINUTES, 60),
  },
};

const DEFAULT_CONFIG: RateLimitConfig = { maxAttempts: 100, windowMinutes: 60 };

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export function rateLimitConfigFor(action: string): RateLimitConfig {
  return CONFIGS[action] ?? DEFAULT_CONFIG;
}

/** Check and record a rate limit attempt. Returns whether the action is allowed. */
export async function checkRateLimit(
  key: string,
  action: string,
  _ipAddress?: string,
): Promise<RateLimitResult> {
  const config = rateLimitConfigFor(action);
  const windowMs = config.windowMinutes * 60_000;
  const windowStartMs = Math.floor(Date.now() / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs);
  const resetAt = new Date(windowStartMs + windowMs);
  const bucketKey = `${action}:${key}`.slice(0, 250);

  const result = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limit_buckets (bucket_key, window_start, count)
    VALUES (${bucketKey}, ${windowStart.toISOString()}::timestamptz, 1)
    ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET count = rate_limit_buckets.count + 1
    RETURNING count
  `);
  const count = Number((result as unknown as { rows: Array<{ count: number }> }).rows[0]?.count ?? 1);

  return {
    allowed: count <= config.maxAttempts,
    remaining: Math.max(0, config.maxAttempts - count),
    resetAt,
  };
}

/** Seconds until the current window of `action` resets (for Retry-After headers). */
export function retryAfterSeconds(action: string, result: RateLimitResult): number {
  void action;
  return Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
}

export function rateLimitKeyFromRequest(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Purge windows that ended more than a day ago (called by maintenance). */
export async function cleanOldRateLimits(): Promise<number> {
  const result = await db.execute(
    sql`DELETE FROM rate_limit_buckets WHERE window_start < now() - INTERVAL '1 day'`,
  );
  return Number((result as unknown as { affectedRows?: number }).affectedRows ?? 0);
}
