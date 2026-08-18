import { db } from "@/db";
import { rateLimitAttempts } from "@/db/schema";
import { and, eq, gte, count } from "drizzle-orm";

export interface RateLimitConfig {
  maxAttempts: number;
  windowMinutes: number;
}

const CONFIGS: Record<string, RateLimitConfig> = {
  login: {
    maxAttempts: parseInt(process.env.RATE_LIMIT_LOGIN_MAX ?? "5"),
    windowMinutes: parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MINUTES ?? "15"),
  },
  chat: {
    maxAttempts: parseInt(process.env.RATE_LIMIT_CHAT_MAX ?? "30"),
    windowMinutes: parseInt(process.env.RATE_LIMIT_CHAT_WINDOW_MINUTES ?? "1"),
  },
  upload: {
    maxAttempts: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX ?? "10"),
    windowMinutes: parseInt(process.env.RATE_LIMIT_UPLOAD_WINDOW_MINUTES ?? "60"),
  },
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/** Check and record a rate limit attempt. Returns whether the action is allowed. */
export async function checkRateLimit(
  key: string,
  action: string,
  ipAddress?: string
): Promise<RateLimitResult> {
  const config = CONFIGS[action] ?? { maxAttempts: 100, windowMinutes: 60 };
  const windowStart = new Date();
  windowStart.setMinutes(windowStart.getMinutes() - config.windowMinutes);
  const resetAt = new Date();
  resetAt.setMinutes(resetAt.getMinutes() + config.windowMinutes);

  // Count existing attempts in window
  const [result] = await db
    .select({ cnt: count() })
    .from(rateLimitAttempts)
    .where(
      and(
        eq(rateLimitAttempts.key, key),
        eq(rateLimitAttempts.action, action),
        gte(rateLimitAttempts.createdAt, windowStart)
      )
    );

  const attempts = result?.cnt ?? 0;

  if (attempts >= config.maxAttempts) {
    return { allowed: false, remaining: 0, resetAt };
  }

  // Record this attempt
  await db.insert(rateLimitAttempts).values({
    key,
    action,
    ipAddress,
  });

  return {
    allowed: true,
    remaining: config.maxAttempts - attempts - 1,
    resetAt,
  };
}

/** Clean up old rate limit records (call periodically) */
export async function cleanOldRateLimits(): Promise<void> {
  const oneHourAgo = new Date();
  oneHourAgo.setHours(oneHourAgo.getHours() - 1);

  await db.delete(rateLimitAttempts).where(
    // drizzle doesn't support lt on date directly, use raw comparison
    gte(rateLimitAttempts.createdAt, new Date(0)) // placeholder - see below
  );

  // Use raw SQL for proper cleanup
  const { sql } = await import("drizzle-orm");
  await db.execute(
    sql`DELETE FROM rate_limit_attempts WHERE created_at < NOW() - INTERVAL '1 hour'`
  );
}
