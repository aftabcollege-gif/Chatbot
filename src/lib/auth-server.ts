import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, roles, userRoles } from "@/db/schema";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "change-this-to-random-64-char-string"
);

export async function getUserIdFromRequest(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get("access_token")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload.userId as string;
  } catch {
    return null;
  }
}

export interface CurrentUser {
  id: string;
  organizationId: string | null;
  departmentId: string | null;
  isSuperadmin: boolean;
  roleName: string;
  isAdmin: boolean;
}

export async function getCurrentUser(request: NextRequest): Promise<CurrentUser | null> {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return null;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.isActive) return null;

  const userRolesList = await db
    .select({ role: roles })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, user.id));

  const roleName = userRolesList[0]?.role.name || (user.isSuperadmin ? "admin" : "user");

  return {
    id: user.id,
    organizationId: user.organizationId,
    departmentId: user.departmentId,
    isSuperadmin: !!user.isSuperadmin,
    roleName,
    isAdmin: !!user.isSuperadmin || roleName === "admin",
  };
}
