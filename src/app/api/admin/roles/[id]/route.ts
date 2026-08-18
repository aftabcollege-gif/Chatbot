import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { roles, rolePermissions, permissions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth-server";
import { logEvent } from "@/lib/audit";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const current = await getCurrentUser(request);
  if (!current) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  if (!current.isAdmin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 403 });

  const { id } = await params;
  const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!role) return NextResponse.json({ error: "نقش یافت نشد" }, { status: 404 });
  if (role.isSystem) return NextResponse.json({ error: "نقش‌های سیستمی قابل ویرایش نیستند" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const { description, permissionCodes } = body as { description?: string; permissionCodes?: string[] };

  if (description !== undefined) {
    await db.update(roles).set({ description }).where(eq(roles.id, id));
  }

  if (permissionCodes) {
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
    if (permissionCodes.length) {
      const matched = await db.select().from(permissions);
      const rows = matched.filter((p) => permissionCodes.includes(p.code));
      if (rows.length) {
        await db.insert(rolePermissions).values(rows.map((p) => ({ roleId: id, permissionId: p.id })));
      }
    }
  }

  await logEvent({ eventCode: "ROLE_UPDATE", actorId: current.id, resourceType: "role", resourceId: id, resourceName: role.name, request });

  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const current = await getCurrentUser(request);
  if (!current) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  if (!current.isAdmin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 403 });

  const { id } = await params;
  const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!role) return NextResponse.json({ error: "نقش یافت نشد" }, { status: 404 });
  if (role.isSystem) return NextResponse.json({ error: "نقش‌های سیستمی قابل حذف نیستند" }, { status: 400 });

  await db.delete(roles).where(eq(roles.id, id));

  await logEvent({ eventCode: "ROLE_DELETE", actorId: current.id, resourceType: "role", resourceId: id, request });

  return NextResponse.json({ success: true });
}
