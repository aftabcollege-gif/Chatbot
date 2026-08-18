import { NextRequest, NextResponse } from "next/server";
import { eq, or, isNull, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users, roles, userRoles, departments } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth-server";
import { logEvent } from "@/lib/audit";

export async function GET(request: NextRequest) {
  const current = await getCurrentUser(request);
  if (!current) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  if (!current.isAdmin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 403 });
  if (!current.organizationId) return NextResponse.json({ items: [] });

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      isActive: users.isActive,
      isSuperadmin: users.isSuperadmin,
      lastLogin: users.lastLogin,
      createdAt: users.createdAt,
      departmentName: departments.name,
    })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(eq(users.organizationId, current.organizationId));

  const allUserRoles = await db
    .select({ userId: userRoles.userId, roleName: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id));

  const roleByUser = new Map<string, string>();
  for (const r of allUserRoles) roleByUser.set(r.userId, r.roleName);

  return NextResponse.json({
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      username: row.username,
      role: roleByUser.get(row.id) || (row.isSuperadmin ? "admin" : "user"),
      department: row.departmentName || "-",
      isActive: row.isActive,
      lastLogin: row.lastLogin?.toISOString() || null,
      createdAt: row.createdAt?.toISOString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const current = await getCurrentUser(request);
  if (!current) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  if (!current.isAdmin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 403 });
  if (!current.organizationId) return NextResponse.json({ error: "سازمان یافت نشد" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const { name, email, username, password, roleName, departmentId } = body as {
    name?: string; email?: string; username?: string; password?: string; roleName?: string; departmentId?: string;
  };

  if (!name || !email || !username || !password) {
    return NextResponse.json({ error: "تمام فیلدها الزامی است" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "رمز عبور باید حداقل ۸ کاراکتر باشد" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [newUser] = await db
    .insert(users)
    .values({
      organizationId: current.organizationId,
      departmentId: departmentId || null,
      name,
      email,
      username,
      passwordHash,
      isActive: true,
      isSuperadmin: false,
      preferences: { theme: "dark", language: "fa", calendar: "jalali" },
    })
    .returning();

  const desiredRole = roleName || "EMPLOYEE";
  const [role] = await db
    .select()
    .from(roles)
    .where(
      and(
        or(eq(roles.organizationId, current.organizationId), isNull(roles.organizationId)),
        eq(roles.name, desiredRole)
      )
    )
    .limit(1);

  if (role) {
    await db.insert(userRoles).values({ userId: newUser.id, roleId: role.id });
  }

  await logEvent({
    eventCode: "USER_CREATE",
    actorId: current.id,
    resourceType: "user",
    resourceId: newUser.id,
    resourceName: newUser.name,
    request,
  });

  return NextResponse.json({ user: newUser }, { status: 201 });
}
