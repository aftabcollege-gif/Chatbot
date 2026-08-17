import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users, roles, userRoles } from "@/db/schema";
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
  const body = await request.json().catch(() => ({}));
  const { isActive, roleName, password, name, email } = body as {
    isActive?: boolean; roleName?: string; password?: string; name?: string; email?: string;
  };

  const update: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (typeof isActive === "boolean") update.isActive = isActive;
  if (name) update.name = name;
  if (email) update.email = email;
  if (password) {
    if (password.length < 8) return NextResponse.json({ error: "رمز عبور باید حداقل ۸ کاراکتر باشد" }, { status: 400 });
    update.passwordHash = await bcrypt.hash(password, 12);
  }

  const [updated] = await db.update(users).set(update).where(eq(users.id, id)).returning();
  if (!updated) return NextResponse.json({ error: "کاربر یافت نشد" }, { status: 404 });

  if (roleName && current.organizationId) {
    const [role] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.organizationId, current.organizationId), eq(roles.name, roleName)))
      .limit(1);
    if (role) {
      await db.delete(userRoles).where(eq(userRoles.userId, id));
      await db.insert(userRoles).values({ userId: id, roleId: role.id });
    }
  }

  await logEvent({
    eventCode: "user.update",
    actorId: current.id,
    resourceType: "user",
    resourceId: id,
    resourceName: updated.name,
    metadata: { isActive, roleName },
    request,
  });

  return NextResponse.json({ user: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const current = await getCurrentUser(request);
  if (!current) return NextResponse.json({ error: "غیر مجاز" }, { status: 401 });
  if (!current.isAdmin) return NextResponse.json({ error: "دسترسی غیرمجاز" }, { status: 403 });

  const { id } = await params;
  if (id === current.id) {
    return NextResponse.json({ error: "امکان حذف حساب خودتان وجود ندارد" }, { status: 400 });
  }

  await db.delete(users).where(eq(users.id, id));

  await logEvent({
    eventCode: "user.delete",
    actorId: current.id,
    resourceType: "user",
    resourceId: id,
    request,
  });

  return NextResponse.json({ success: true });
}
