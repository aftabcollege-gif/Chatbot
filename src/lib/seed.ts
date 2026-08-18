/**
 * Database seeder — creates system roles, permissions, and initial setup records
 */

import { db } from "@/db";
import { permissions, roles, rolePermissions, setupStatus, systemSettings } from "@/db/schema";
import { ROLE_DEFAULT_PERMISSIONS, ROLE_NAMES } from "@/lib/permissions";
import { eq } from "drizzle-orm";

export async function seedSystemData(): Promise<void> {
  console.log("[Seed] Seeding system permissions and roles...");

  // 1. Insert all permissions
  const allPermissions = [
    // Documents
    { code: "document.read", description: "مشاهده اسناد", category: "document" },
    { code: "document.create", description: "بارگذاری سند", category: "document" },
    { code: "document.update", description: "ویرایش سند", category: "document" },
    { code: "document.delete", description: "حذف سند", category: "document" },
    { code: "document.publish", description: "انتشار سند", category: "document" },
    { code: "document.reindex", description: "باز-ایندکس‌گذاری سند", category: "document" },
    // Knowledge
    { code: "knowledge.read", description: "مشاهده دانش", category: "knowledge" },
    { code: "knowledge.create", description: "ایجاد دانش", category: "knowledge" },
    { code: "knowledge.update", description: "ویرایش دانش", category: "knowledge" },
    { code: "knowledge.delete", description: "حذف دانش", category: "knowledge" },
    { code: "knowledge.review", description: "بررسی دانش", category: "knowledge" },
    { code: "knowledge.approve", description: "تأیید دانش", category: "knowledge" },
    { code: "knowledge.publish", description: "انتشار دانش", category: "knowledge" },
    // Experience
    { code: "experience.read", description: "مشاهده تجربیات", category: "experience" },
    { code: "experience.create", description: "ایجاد تجربه", category: "experience" },
    { code: "experience.update", description: "ویرایش تجربه", category: "experience" },
    { code: "experience.delete", description: "حذف تجربه", category: "experience" },
    { code: "experience.submit", description: "ارسال تجربه برای بررسی", category: "experience" },
    { code: "experience.review", description: "بررسی تجربه", category: "experience" },
    { code: "experience.approve", description: "تأیید تجربه", category: "experience" },
    { code: "experience.publish", description: "انتشار تجربه", category: "experience" },
    // Chat
    { code: "chat.use", description: "استفاده از چت هوشمند", category: "chat" },
    { code: "chat.view_trace", description: "مشاهده ردپای RAG", category: "chat" },
    // Search
    { code: "search.use", description: "جستجو در منابع", category: "search" },
    // Admin
    { code: "admin.access", description: "دسترسی به پنل مدیریت", category: "admin" },
    { code: "admin.system", description: "تنظیمات سیستم", category: "admin" },
    // Audit
    { code: "audit.read", description: "مشاهده گزارش حسابرسی", category: "audit" },
    // Users
    { code: "user.read", description: "مشاهده کاربران", category: "user" },
    { code: "user.create", description: "ایجاد کاربر", category: "user" },
    { code: "user.update", description: "ویرایش کاربر", category: "user" },
    { code: "user.delete", description: "حذف کاربر", category: "user" },
    { code: "user.manage", description: "مدیریت کاربران", category: "user" },
    // Roles
    { code: "role.read", description: "مشاهده نقش‌ها", category: "role" },
    { code: "role.manage", description: "مدیریت نقش‌ها", category: "role" },
    // Org & Dept
    { code: "org.read", description: "مشاهده سازمان", category: "org" },
    { code: "org.manage", description: "مدیریت سازمان", category: "org" },
    { code: "dept.read", description: "مشاهده واحدها", category: "dept" },
    { code: "dept.manage", description: "مدیریت واحدها", category: "dept" },
    // Backup
    { code: "backup.create", description: "ایجاد پشتیبان", category: "backup" },
    { code: "backup.restore", description: "بازگردانی پشتیبان", category: "backup" },
  ];

  for (const perm of allPermissions) {
    await db
      .insert(permissions)
      .values(perm)
      .onConflictDoNothing();
  }

  // 2. Create system roles (no organizationId — system-wide)
  for (const roleName of Object.values(ROLE_NAMES)) {
    await db
      .insert(roles)
      .values({
        name: roleName,
        description: roleName,
        isSystem: true,
      })
      .onConflictDoNothing();
  }

  // 3. Assign permissions to roles
  for (const [roleName, perms] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
    // Find role
    const [role] = await db
      .select()
      .from(roles)
      .where(eq(roles.name, roleName))
      .limit(1);

    if (!role) continue;

    for (const permCode of perms) {
      // Find permission
      const [perm] = await db
        .select()
        .from(permissions)
        .where(eq(permissions.code, permCode))
        .limit(1);

      if (!perm) continue;

      await db
        .insert(rolePermissions)
        .values({ roleId: role.id, permissionId: perm.id })
        .onConflictDoNothing();
    }
  }

  // 4. Initialize setup status
  await db
    .insert(setupStatus)
    .values({ id: 1, completed: false, currentStep: 1 })
    .onConflictDoNothing();

  // 5. Initialize system settings
  const defaultSettings = [
    { key: "app.name", value: "سامانه هوش سازمانی", description: "نام برنامه", category: "app" },
    { key: "ai.model", value: "qwen2.5:7b", description: "مدل زبانی", category: "ai" },
    { key: "ai.embed_model", value: "nomic-embed-text", description: "مدل Embedding", category: "ai" },
    { key: "rag.top_k", value: 8, description: "تعداد نتایج RAG", category: "rag" },
    { key: "rag.min_score", value: 0.15, description: "حداقل امتیاز مرتبط", category: "rag" },
  ];

  for (const setting of defaultSettings) {
    await db
      .insert(systemSettings)
      .values({ key: setting.key, value: setting.value, description: setting.description, category: setting.category })
      .onConflictDoNothing();
  }

  console.log("[Seed] System data seeded successfully.");
}
