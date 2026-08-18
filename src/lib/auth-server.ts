import type { NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { eq, and, gt, isNull } from "drizzle-orm";
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
    .set({ isRevoked: true })
    .where(eq(sessions.tokenHash, tokenHash));
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ isRevoked: true })
    .where(eq(sessions.userId, userId));
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

export async function getUserIdFromRequest(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get("access_token")?.value;
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload?.userId) return null;

  // Validate session is not revoked
  const isValid = await validateSession(token);
  if (!isValid) return null;

  return payload.userId as string;
}

export async function getCurrentUser(request: NextRequest): Promise<CurrentUser | null> {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true)))
    .limit(1);

  if (!user) return null;

  // Check account lockout
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return null;
  }

  // Fetch roles
  const userRolesList = await db
    .select({ role: roles })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, user.id));

  const roleNames = userRolesList.map((r) => r.role.name);

  // Fetch permissions for all roles
  const roleIds = userRolesList.map((r) => r.role.id);
  const userPermissions = new Set<string>();

  if (roleIds.length > 0) {
    for (const roleId of roleIds) {
      const rolePerms = await db
        .select({ code: permissions.code })
        .from(rolePermissions)
        .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(eq(rolePermissions.roleId, roleId));
      rolePerms.forEach((p) => userPermissions.add(p.code));
    }
  }

  return {
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
