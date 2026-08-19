import { cookies } from "next/headers";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { signSessionToken, verifySessionToken } from "@/lib/auth/jwt";
import { config } from "@/lib/config";

const SESSION_COOKIE = "session_token";
const CSRF_COOKIE = "csrf_token";

export interface AuthedUser {
  id: string;
  organizationId: string;
  departmentId: string | null;
  name: string;
  email: string;
  role: string;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  user: AuthedUser,
  meta: { userAgent?: string | null; ipAddress?: string | null },
): Promise<void> {
  const csrfSecret = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + config.auth.sessionTtlHours * 3600 * 1000);

  const [sessionRow] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      organizationId: user.organizationId,
      tokenHash: "", // filled below once we know sessionId
      csrfSecret,
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
      expiresAt,
    })
    .returning();

  const token = await signSessionToken({
    sub: user.id,
    sessionId: sessionRow.id,
    organizationId: user.organizationId,
    role: user.role,
  });

  await db.update(sessions).set({ tokenHash: hashToken(token) }).where(eq(sessions.id, sessionRow.id));

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: config.auth.sessionTtlHours * 3600,
  });
  cookieStore.set(CSRF_COOKIE, csrfSecret, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: config.auth.sessionTtlHours * 3600,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const payload = await verifySessionToken(token);
    if (payload?.sessionId) {
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, payload.sessionId));
    }
  }
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(CSRF_COOKIE);
}

export interface CurrentSession {
  user: AuthedUser;
  sessionId: string;
  csrfSecret: string;
}

export async function getCurrentSession(): Promise<CurrentSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const [sessionRow] = await db.select().from(sessions).where(eq(sessions.id, payload.sessionId)).limit(1);
  if (!sessionRow || sessionRow.revokedAt || sessionRow.expiresAt.getTime() < Date.now()) return null;
  if (sessionRow.tokenHash !== hashToken(token)) return null;

  const [userRow] = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
  if (!userRow || !userRow.isActive) return null;

  return {
    user: {
      id: userRow.id,
      organizationId: userRow.organizationId,
      departmentId: userRow.departmentId,
      name: userRow.name,
      email: userRow.email,
      role: userRow.role,
    },
    sessionId: sessionRow.id,
    csrfSecret: sessionRow.csrfSecret ?? "",
  };
}

export function verifyCsrfHeader(request: Request, csrfSecret: string): boolean {
  const header = request.headers.get("x-csrf-token");
  if (!header || header.length !== csrfSecret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(csrfSecret));
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const CSRF_COOKIE_NAME = CSRF_COOKIE;
