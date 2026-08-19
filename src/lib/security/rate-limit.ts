import { sql } from "drizzle-orm";
import { db } from "@/db";
import { config } from "@/lib/config";

/**
 * Fixed-window rate limiter backed by Postgres so it works correctly even
 * with multiple server processes and survives restarts. Not a cloud
 * dependency: pure local DB usage.
 */
export async function checkRateLimit(bucketKey: string): Promise<{ allowed: boolean; remaining: number }> {
  const windowMs = config.rateLimit.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);

  const rows = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limit_buckets (bucket_key, window_start, count)
    VALUES (${bucketKey}, ${windowStart.toISOString()}, 1)
    ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET count = rate_limit_buckets.count + 1
    RETURNING count
  `);

  const count = Number((rows as unknown as { rows: Array<{ count: number }> }).rows[0]?.count ?? 1);
  const allowed = count <= config.rateLimit.maxRequests;
  return { allowed, remaining: Math.max(0, config.rateLimit.maxRequests - count) };
}

export function rateLimitKeyFromRequest(request: Request, suffix: string): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() ?? "unknown";
  return `${ip}:${suffix}`;
}
