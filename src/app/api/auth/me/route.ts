import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, roles, userRoles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "change-this-to-random-64-char-string"
);

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("access_token")?.value;

    if (!token) {
      return NextResponse.json(
        { error: "غیر مجاز" },
        { status: 401 }
      );
    }

    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = payload.userId as string;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user || !user.isActive) {
      return NextResponse.json(
        { error: "کاربر یافت نشد" },
        { status: 401 }
      );
    }

    const userRolesList = await db
      .select({ role: roles })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, user.id));

    const roleName = userRolesList[0]?.role.name || (user.isSuperadmin ? "admin" : "user");

    return NextResponse.json({
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
    });
  } catch (error) {
    console.error("Auth check error:", error);
    return NextResponse.json(
      { error: "توکن نامعتبر" },
      { status: 401 }
    );
  }
}
