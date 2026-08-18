import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, roles, userRoles, permissions, rolePermissions } from "@/db/schema";
import { signToken, createSession } from "@/lib/auth-server";
import { logEvent } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";

export const dynamic = "force-dynamic";

const LoginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  // Rate limiting
  const rateCheck = await checkRateLimit(ip, "login", ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "تعداد تلاش‌های ورود بیش از حد مجاز است. لطفاً بعداً تلاش کنید." },
      {
        status: 429,
        headers: { "Retry-After": "900" },
      }
    );
  }

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "درخواست نامعتبر" }, { status: 400 });
  }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "اطلاعات ورود نامعتبر است." }, { status: 400 });
  }

  const { username, password } = parsed.data;

  // Find user
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (!user) {
    await logEvent({
      eventCode: "FAILED_LOGIN",
      actorName: username,
      outcome: "FAILURE",
      metadata: { reason: "user_not_found", ip },
    });
    return NextResponse.json(
      { error: "نام کاربری یا رمز عبور اشتباه است." },
      { status: 401 }
    );
  }

  // Check account lock
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const unlockTime = user.lockedUntil.toISOString();
    await logEvent({
      eventCode: "FAILED_LOGIN",
      actorId: user.id,
      actorName: user.username,
      outcome: "FAILURE",
      metadata: { reason: "account_locked", lockedUntil: unlockTime },
    });
    return NextResponse.json(
      { error: "حساب کاربری قفل شده است. بعداً تلاش کنید." },
      { status: 423 }
    );
  }

  // Check active
  if (!user.isActive) {
    await logEvent({
      eventCode: "FAILED_LOGIN",
      actorId: user.id,
      actorName: user.username,
      outcome: "FAILURE",
      metadata: { reason: "account_inactive" },
    });
    return NextResponse.json(
      { error: "حساب کاربری غیرفعال است." },
      { status: 401 }
    );
  }

  // Verify password
  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) {
    // Increment failed attempts
    const newFailedAttempts = (user.failedLoginAttempts ?? 0) + 1;
    const lockThreshold = 5;
    const lockUntil =
      newFailedAttempts >= lockThreshold
        ? new Date(Date.now() + 15 * 60 * 1000) // lock 15 minutes
        : null;

    await db
      .update(users)
      .set({
        failedLoginAttempts: newFailedAttempts,
        lockedUntil: lockUntil,
      })
      .where(eq(users.id, user.id));

    await logEvent({
      eventCode: "FAILED_LOGIN",
      actorId: user.id,
      actorName: user.username,
      outcome: "FAILURE",
      metadata: { reason: "wrong_password", attempts: newFailedAttempts },
    });

    return NextResponse.json(
      { error: "نام کاربری یا رمز عبور اشتباه است." },
      { status: 401 }
    );
  }

  // Reset failed attempts
  await db
    .update(users)
    .set({ failedLoginAttempts: 0, lockedUntil: null, lastLogin: new Date() })
    .where(eq(users.id, user.id));

  // Fetch roles & permissions
  const userRolesList = await db
    .select({ role: roles })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, user.id));

  const roleNames = userRolesList.map((r) => r.role.name);
  const userPerms = new Set<string>();

  for (const ur of userRolesList) {
    const rolePerms = await db
      .select({ code: permissions.code })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, ur.role.id));
    rolePerms.forEach((p) => userPerms.add(p.code));
  }

  if (user.isSuperadmin) {
    // Superadmin gets all permissions implicitly
    // We still return the list empty and let frontend check isSuperadmin
  }

  // Sign token
  const token = await signToken({
    userId: user.id,
    organizationId: user.organizationId,
    isSuperadmin: user.isSuperadmin,
  });

  // Create session record
  await createSession(
    user.id,
    token,
    ip,
    request.headers.get("user-agent") ?? undefined
  );

  // Audit
  await logEvent({
    eventCode: "LOGIN",
    actorId: user.id,
    actorName: user.name,
    organizationId: user.organizationId ?? undefined,
    outcome: "SUCCESS",
    request,
  });

  const response = NextResponse.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      organizationId: user.organizationId,
      departmentId: user.departmentId,
      isSuperadmin: user.isSuperadmin,
      roles: roleNames,
      permissions: user.isSuperadmin ? [] : Array.from(userPerms),
      isAdmin: !!user.isSuperadmin || roleNames.includes("SUPER_ADMIN") || roleNames.includes("ORG_ADMIN"),
    },
  });

  // Set secure cookie
  response.cookies.set("access_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: parseInt(process.env.SESSION_DURATION_HOURS ?? "8") * 3600,
    path: "/",
  });

  return response;
}
