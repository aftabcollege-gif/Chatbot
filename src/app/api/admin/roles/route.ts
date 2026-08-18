import { NextRequest, NextResponse } from "next/server";
import { eq, or, isNull } from "drizzle-orm";
import { db } from "@/db";
import { roles, rolePermissions, permissions, userRoles } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth-server";
import { logEvent } from "@/lib/audit";

export async function GET(request: NextRequest) {
  const current = await getCurrentUser(request);
  if (!current) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  if (!current.isAdmin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 403 });
  if (!current.organizationId) return NextResponse.json({ roles: [], permissions: [] });

  // Roles visible to an org admin: system-wide roles (organizationId IS NULL,
  // e.g. SUPER_ADMIN/ORG_ADMIN/EMPLOYEE seeded by seedSystemData) PLUS any
  // custom roles created specifically for this organization.
  const orgRoles = await db
    .select()
    .from(roles)
    .where(or(eq(roles.organizationId, current.organizationId), isNull(roles.organizationId)));
  const allPermissions = await db.select().from(permissions);

  const allRolePermissions = await db
    .select({ roleId: rolePermissions.roleId, code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id));

  const allUserRoles = await db.select({ roleId: userRoles.roleId }).from(userRoles);
  const usersCountByRole = new Map<string, number>();
  for (const ur of allUserRoles) {
    usersCountByRole.set(ur.roleId, (usersCountByRole.get(ur.roleId) || 0) + 1);
  }

  const permsByRole = new Map<string, string[]>();
  for (const rp of allRolePermissions) {
    const list = permsByRole.get(rp.roleId) || [];
    list.push(rp.code);
    permsByRole.set(rp.roleId, list);
  }

  return NextResponse.json({
    roles: orgRoles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      usersCount: usersCountByRole.get(role.id) || 0,
      permissions: permsByRole.get(role.id) || [],
    })),
    permissions: allPermissions.map((p) => ({ code: p.code, description: p.description })),
  });
}

export async function POST(request: NextRequest) {
  const current = await getCurrentUser(request);
  if (!current) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  if (!current.isAdmin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 403 });
  if (!current.organizationId) return NextResponse.json({ error: "سازمان یافت نشد" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const { name, description, permissionCodes } = body as { name?: string; description?: string; permissionCodes?: string[] };

  if (!name?.trim()) return NextResponse.json({ error: "نام نقش الزامی است" }, { status: 400 });

  const [role] = await db
    .insert(roles)
    .values({ organizationId: current.organizationId, name: name.trim(), description, isSystem: false })
    .returning();

  if (permissionCodes?.length) {
    const matched = await db.select().from(permissions);
    const rows = matched.filter((p) => permissionCodes.includes(p.code));
    if (rows.length) {
      await db.insert(rolePermissions).values(rows.map((p) => ({ roleId: role.id, permissionId: p.id })));
    }
  }

  await logEvent({ eventCode: "ROLE_CREATE", actorId: current.id, resourceType: "role", resourceId: role.id, resourceName: role.name, request });

  return NextResponse.json({ role }, { status: 201 });
}
