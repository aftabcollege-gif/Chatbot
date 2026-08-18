import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  organizations,
  departments,
  users,
  roles,
  userRoles,
  setupStatus,
} from "@/db/schema";
import { seedSystemData } from "@/lib/seed";
import { logEvent } from "@/lib/audit";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SetupSchema = z.object({
  organizationName: z.string().min(2).max(255),
  adminName: z.string().min(2).max(255),
  adminUsername: z.string().min(3).max(100).regex(/^[a-zA-Z0-9_]+$/),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8).max(200),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Check if setup already completed
  const [existing] = await db.select().from(setupStatus).limit(1);
  if (existing?.completed) {
    return NextResponse.json({ error: "راه‌اندازی قبلاً انجام شده است." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "درخواست نامعتبر" }, { status: 400 });
  }

  const parsed = SetupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "اطلاعات نامعتبر", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { organizationName, adminName, adminUsername, adminEmail, adminPassword } = parsed.data;

  try {
    // 1. Seed system data (permissions, roles, settings)
    await seedSystemData();

    // 2. Create organization
    const [org] = await db
      .insert(organizations)
      .values({ name: organizationName, isActive: true })
      .returning();

    // 3. Create default department
    const [dept] = await db
      .insert(departments)
      .values({ organizationId: org.id, name: "واحد مرکزی", isActive: true })
      .returning();

    // 4. Hash admin password
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    // 5. Create admin user
    const [adminUser] = await db
      .insert(users)
      .values({
        organizationId: org.id,
        departmentId: dept.id,
        username: adminUsername,
        email: adminEmail,
        name: adminName,
        passwordHash,
        isActive: true,
        isSuperadmin: true,
      })
      .returning();

    // 6. Assign SUPER_ADMIN role
    const [superAdminRole] = await db
      .select()
      .from(roles)
      .where(eq(roles.name, "SUPER_ADMIN"))
      .limit(1);

    if (superAdminRole) {
      await db.insert(userRoles).values({
        userId: adminUser.id,
        roleId: superAdminRole.id,
      });
    }

    // 7. Mark setup as complete
    await db
      .update(setupStatus)
      .set({
        completed: true,
        currentStep: 5,
        organizationName,
        completedAt: new Date(),
      })
      .where(eq(setupStatus.id, 1));

    // 8. Audit
    await logEvent({
      eventCode: "SETUP_COMPLETE",
      actorId: adminUser.id,
      actorName: adminUser.name,
      organizationId: org.id,
      outcome: "SUCCESS",
      metadata: { organizationName },
    });

    return NextResponse.json({
      success: true,
      message: "راه‌اندازی با موفقیت انجام شد.",
    });
  } catch (error) {
    console.error("[Setup] Error:", error);
    return NextResponse.json(
      { error: "خطا در راه‌اندازی سیستم. لطفاً دوباره تلاش کنید." },
      { status: 500 }
    );
  }
}
