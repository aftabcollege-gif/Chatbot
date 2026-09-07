/**
 * Short-lived, in-process cache for resolved sessions.
 *
 * Every API request used to cost 3 + N database round-trips (session, user,
 * roles, then one permission query PER ROLE) before the handler did any real
 * work. With a few hundred users polling the documents page every few
 * seconds that dominated database load on the single-connection PGlite
 * engine. The resolved `CurrentUser` is now cached per session token for a
 * few seconds and explicitly dropped whenever anything that could change the
 * answer happens in this process (logout, revocation, user/role edits).
 *
 * The cache is keyed by the SHA-256 of the token, never by the token itself,
 * and lives only in process memory.
 */
import type { CurrentUser } from "@/lib/auth-server";

interface CacheEntry {
  user: CurrentUser;
  expiresAt: number;
}

interface AuthCacheState {
  entries: Map<string, CacheEntry>;
  hits: number;
  misses: number;
}

const globalForCache = globalThis as typeof globalThis & { __authSessionCache?: AuthCacheState };
const state: AuthCacheState = (globalForCache.__authSessionCache ??= {
  entries: new Map(),
  hits: 0,
  misses: 0,
});

function readTtlMs(): number {
  const raw = process.env.AUTH_CACHE_TTL_MS;
  if (raw === undefined) return 10_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 10_000;
}

/** Cache TTL in milliseconds (AUTH_CACHE_TTL_MS, default 10 s; 0 disables). */
export const AUTH_CACHE_TTL_MS = readTtlMs();

// Bounded so a flood of bogus cookies cannot grow memory without limit.
const MAX_ENTRIES = 5_000;

export function getCachedUser(tokenHash: string): CurrentUser | null {
  if (AUTH_CACHE_TTL_MS === 0) return null;
  const entry = state.entries.get(tokenHash);
  if (!entry) {
    state.misses++;
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    state.entries.delete(tokenHash);
    state.misses++;
    return null;
  }
  state.hits++;
  return entry.user;
}

export function setCachedUser(tokenHash: string, user: CurrentUser): void {
  if (AUTH_CACHE_TTL_MS === 0) return;
  if (state.entries.size >= MAX_ENTRIES) {
    // Drop the oldest insertion (Map preserves insertion order).
    const oldest = state.entries.keys().next().value;
    if (oldest !== undefined) state.entries.delete(oldest);
  }
  state.entries.set(tokenHash, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
}

/** Forget one session (logout / single-session revoke). */
export function invalidateSessionCache(tokenHash: string): void {
  state.entries.delete(tokenHash);
}

/** Forget every cached session of one user (deactivation, role change, password reset). */
export function invalidateUserCache(userId: string): void {
  for (const [key, entry] of state.entries) {
    if (entry.user.id === userId) state.entries.delete(key);
  }
}

/** Forget everything (role/permission definitions changed). */
export function invalidateAllUserCache(): void {
  state.entries.clear();
}

export function authCacheStats(): { size: number; hits: number; misses: number; ttlMs: number } {
  return { size: state.entries.size, hits: state.hits, misses: state.misses, ttlMs: AUTH_CACHE_TTL_MS };
}
