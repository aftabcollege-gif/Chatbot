import type { NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { eq, and, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  roles,
  userRoles,
  permissions,
  rolePermissions,
  sessions,
  auditLogs,
} from "@/db/schema";
import { createHash } from "crypto";
import {
  getCachedUser,
  setCachedUser,
  invalidateSessionCache,
  invalidateUserCache,
} from "@/lib/auth-cache";

// ============================================================
// JWT Configuration — FAIL FAST if secret not set
// ============================================================
const rawSecret = process.env.JWT_SECRET;
if (!rawSecret || rawSecret.length < 32) {
  throw new Error("JWT_SECRET must be set and at least 32 characters long");
}
const JWT_SECRET = new TextEncoder().encode(rawSecret);

const SESSION_DURATION_HOURS = parseInt(process.env.SESSION_DURATION_HOURS ?? "8");

// ============================================================
// Token Operations
// ============================================================
export async function signToken(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_HOURS}h`)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ============================================================
// Session Management
// ============================================================
export async function createSession(
  userId: string,
  token: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + SESSION_DURATION_HOURS);

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    ipAddress,
    userAgent,
    expiresAt,
  });
}

export async function validateSession(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  const now = new Date();
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        eq(sessions.isRevoked, false),
        gt(sessions.expiresAt, now)
      )
    )
    .limit(1);
  return !!session;
}

export async function revokeSession(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await db
    .update(sessions)
    .set({ isRevoked: true, revokedAt: new Date() })
    .where(eq(sessions.tokenHash, tokenHash));
  invalidateSessionCache(tokenHash);
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ isRevoked: true, revokedAt: new Date() })
    .where(eq(sessions.userId, userId));
  invalidateUserCache(userId);
}

// ============================================================
// Current User
// ============================================================
export interface CurrentUser {
  id: string;
  organizationId: string | null;
  departmentId: string | null;
  name: string;
  email: string;
  username: string;
  isSuperadmin: boolean;
  roles: string[];
  permissions: Set<string>;
  isAdmin: boolean;
}

/**
 * Roles and the union of their permissions for a set of users — ONE query
 * for the roles and ONE for the permissions, regardless of how many roles a
 * user holds (the previous implementation issued one query per role).
 */
export async function loadRolesAndPermissions(
  userId: string,
): Promise<{ roleNames: string[]; permissions: Set<string> }> {
  const userRolesList = await db
    .select({ id: roles.id, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  const roleNames = userRolesList.map((r) => r.name);
  const roleIds = userRolesList.map((r) => r.id);
  const perms = new Set<string>();

  if (roleIds.length > 0) {
    const rows = await db
      .selectDistinct({ code: permissions.code })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(inArray(rolePermissions.roleId, roleIds));
    for (const row of rows) perms.add(row.code);
  }

  return { roleNames, permissions: perms };
}

/**
 * Resolve the caller from the `access_token` cookie.
 *
 * Fast path: a cached, still-fresh resolution for this exact token (see
 * auth-cache.ts). Slow path: JWT verification, then a single session⋈user
 * query, then roles + permissions (two queries). Results are cached for a few
 * seconds; revocation, logout and user/role edits drop the cache entry.
 */
export async function getCurrentUser(request: NextRequest): Promise<CurrentUser | null> {
  const token = request.cookies.get("access_token")?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const cached = getCachedUser(tokenHash);
  if (cached) return cached;

  const payload = await verifyToken(token);
  if (!payload?.userId) return null;

  const now = new Date();
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        eq(sessions.isRevoked, false),
        gt(sessions.expiresAt, now),
        eq(users.id, payload.userId as string),
        eq(users.isActive, true),
      ),
    )
    .limit(1);

  if (!row) return null;
  const user = row.user;

  // Check account lockout
  if (user.lockedUntil && user.lockedUntil > now) {
    return null;
  }

  const { roleNames, permissions: userPermissions } = await loadRolesAndPermissions(user.id);

  const current: CurrentUser = {
    id: user.id,
    organizationId: user.organizationId,
    departmentId: user.departmentId,
    name: user.name,
    email: user.email,
    username: user.username,
    isSuperadmin: !!user.isSuperadmin,
    roles: roleNames,
    permissions: userPermissions,
    isAdmin: !!user.isSuperadmin || roleNames.includes("SUPER_ADMIN") || roleNames.includes("ORG_ADMIN"),
  };
  setCachedUser(tokenHash, current);
  return current;
}

/** Id of the authenticated caller, or null. */
export async function getUserIdFromRequest(request: NextRequest): Promise<string | null> {
  const user = await getCurrentUser(request);
  return user?.id ?? null;
}

/** Check if user has a specific permission — DENY BY DEFAULT */
export function hasPermission(user: CurrentUser, permission: string): boolean {
  if (user.isSuperadmin) return true;
  return user.permissions.has(permission);
}

/** Check multiple permissions (AND logic) */
export function hasAllPermissions(user: CurrentUser, perms: string[]): boolean {
  if (user.isSuperadmin) return true;
  return perms.every((p) => user.permissions.has(p));
}

/** Check multiple permissions (OR logic) */
export function hasAnyPermission(user: CurrentUser, perms: string[]): boolean {
  if (user.isSuperadmin) return true;
  return perms.some((p) => user.permissions.has(p));
}

// ============================================================
// Audit helper (non-blocking)
// ============================================================
export async function logAuthEvent(params: {
  eventCode: string;
  actorId?: string;
  actorName?: string;
  organizationId?: string;
  resourceType?: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  outcome?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await db.insert(auditLogs).values({
      eventCode: params.eventCode,
      actorId: params.actorId ?? null,
      actorName: params.actorName ?? null,
      organizationId: params.organizationId ?? null,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      outcome: params.outcome ?? "SUCCESS",
      metadata: params.metadata ?? {},
    });
  } catch (err) {
    // Audit must never break primary flow
    console.error("[AUDIT] Failed to write audit log:", err);
  }
}
