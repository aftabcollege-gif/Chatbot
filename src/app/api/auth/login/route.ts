import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, roles, userRoles, sessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { v4 as uuidv4 } from "uuid";
import { logEvent } from "@/lib/audit";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "change-this-to-random-64-char-string"
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "نام کاربری و رمز عبور الزامی است" },
        { status: 400 }
      );
    }

    // Find user by username or email
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (!user) {
      [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, username))
        .limit(1);
    }

    if (!user) {
      await logEvent({ eventCode: "auth.login_failed", actorName: username, request });
      return NextResponse.json(
        { error: "نام کاربری یا رمز عبور اشتباه است" },
        { status: 401 }
      );
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      await logEvent({ eventCode: "auth.login_failed", actorId: user.id, actorName: user.name, request });
      return NextResponse.json(
        { error: "نام کاربری یا رمز عبور اشتباه است" },
        { status: 401 }
      );
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: "حساب کاربری غیرفعال است" },
        { status: 403 }
      );
    }

    await logEvent({ eventCode: "auth.login", actorId: user.id, actorName: user.name, request });
    return await createSession(user, request);
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "خطا در سرور" },
      { status: 500 }
    );
  }
}

async function createSession(user: typeof users.$inferSelect, request: NextRequest) {
  const userRolesList = await db
    .select({ role: roles })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, user.id));

  const roleName = userRolesList[0]?.role.name || (user.isSuperadmin ? "admin" : "user");

  const accessToken = await new SignJWT({
    userId: user.id,
    email: user.email,
    role: roleName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .setIssuedAt()
    .sign(JWT_SECRET);

  const refreshToken = uuidv4();
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({
    userId: user.id,
    refreshTokenHash,
    ipAddress: request.headers.get("x-forwarded-for") || "unknown",
    userAgent: request.headers.get("user-agent") || "unknown",
    expiresAt,
  });

  await db
    .update(users)
    .set({ lastLogin: new Date() })
    .where(eq(users.id, user.id));

  const response = NextResponse.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: roleName,
      avatarUrl: user.avatarUrl,
      permissions: user.isSuperadmin ? ["*"] : [],
      preferences: user.preferences as {
        theme: "dark" | "light";
        language: "fa" | "en";
        calendar: "jalali" | "gregorian";
      },
    },
    accessToken,
    expiresIn: 3600,
  });

  response.cookies.set("access_token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 3600,
    path: "/",
  });

  response.cookies.set("refresh_token", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 3600,
    path: "/",
  });

  return response;
}
