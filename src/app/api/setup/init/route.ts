import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, organizations, roles, userRoles, permissions, rolePermissions, setupStatus } from "@/db/schema";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, username, password, organizationName } = body;

    // Validate input
    if (!name || !email || !username || !password) {
      return NextResponse.json(
        { error: "تمام فیلدها الزامی است" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "رمز عبور باید حداقل ۸ کاراکتر باشد" },
        { status: 400 }
      );
    }

    // Check if setup already completed
    const existingUsers = await db.select().from(users).limit(1);
    if (existingUsers.length > 0) {
      return NextResponse.json(
        { error: "راه‌اندازی قبلاً انجام شده است" },
        { status: 400 }
      );
    }

    // Create organization
    const [org] = await db
      .insert(organizations)
      .values({
        name: organizationName || "سازمان پیش‌فرض",
        description: "سازمان اصلی",
        settings: {},
      })
      .returning();

    // Create default permissions
    const permissionCodes = [
      { code: "chat.create", description: "ایجاد گفتگو" },
      { code: "chat.read", description: "مشاهده گفتگوها" },
      { code: "documents.upload", description: "بارگذاری فایل" },
      { code: "documents.read", description: "مشاهده فایل‌ها" },
      { code: "documents.delete", description: "حذف فایل‌ها" },
      { code: "knowledge.create", description: "ثبت تجربه" },
      { code: "knowledge.read", description: "مشاهده تجربیات" },
      { code: "knowledge.approve", description: "تأیید تجربیات" },
      { code: "admin.users", description: "مدیریت کاربران" },
      { code: "admin.roles", description: "مدیریت نقش‌ها" },
      { code: "admin.settings", description: "تنظیمات سیستم" },
      { code: "admin.logs", description: "مشاهده لاگ‌ها" },
    ];

    const insertedPermissions = await db
      .insert(permissions)
      .values(permissionCodes)
      .returning();

    // Create default roles
    const [adminRole] = await db
      .insert(roles)
      .values({
        organizationId: org.id,
        name: "admin",
        description: "مدیر سیستم",
        isSystem: true,
      })
      .returning();

    const [userRole] = await db
      .insert(roles)
      .values({
        organizationId: org.id,
        name: "user",
        description: "کاربر عادی",
        isSystem: true,
      })
      .returning();

    // Assign all permissions to admin role
    await db.insert(rolePermissions).values(
      insertedPermissions.map((p) => ({
        roleId: adminRole.id,
        permissionId: p.id,
      }))
    );

    // Assign basic permissions to user role
    const userPermissions = insertedPermissions.filter((p) =>
      ["chat.create", "chat.read", "documents.read", "knowledge.read"].includes(p.code)
    );
    await db.insert(rolePermissions).values(
      userPermissions.map((p) => ({
        roleId: userRole.id,
        permissionId: p.id,
      }))
    );

    // Create admin user
    const passwordHash = await bcrypt.hash(password, 12);
    const [adminUser] = await db
      .insert(users)
      .values({
        organizationId: org.id,
        username,
        email,
        name,
        passwordHash,
        isActive: true,
        isSuperadmin: true,
        preferences: {
          theme: "dark",
          language: "fa",
          calendar: "jalali",
        },
      })
      .returning();

    // Assign admin role to user
    await db.insert(userRoles).values({
      userId: adminUser.id,
      roleId: adminRole.id,
    });

    // Mark setup as completed
    await db
      .insert(setupStatus)
      .values({
        id: 1,
        completed: true,
        currentStep: 8,
        completedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: setupStatus.id,
        set: {
          completed: true,
          currentStep: 8,
          completedAt: new Date(),
        },
      });

    return NextResponse.json({
      success: true,
      message: "راه‌اندازی با موفقیت انجام شد",
      user: {
        id: adminUser.id,
        name: adminUser.name,
        email: adminUser.email,
        username: adminUser.username,
      },
    });
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json(
      { error: "خطا در راه‌اندازی سیستم" },
      { status: 500 }
    );
  }
}
