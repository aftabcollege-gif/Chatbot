/**
 * Database seeder — creates system roles, permissions, and initial setup records
 */

import { db } from "@/db";
import { permissions, roles, rolePermissions, setupStatus, systemSettings, users, userRoles } from "@/db/schema";
import { ROLE_DEFAULT_PERMISSIONS, ROLE_NAMES } from "@/lib/permissions";
import { and, eq, isNull } from "drizzle-orm";

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

  // One statement for all permissions (unique index on code makes this idempotent).
  await db.insert(permissions).values(allPermissions).onConflictDoNothing();

  // 2. Create system roles (no organizationId — system-wide). `roles.name`
  // has no unique constraint, so check for existing system roles explicitly
  // to stay idempotent across re-runs.
  const existingRoles = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(and(isNull(roles.organizationId), eq(roles.isSystem, true)));
  const roleIdByName = new Map(existingRoles.map((r) => [r.name, r.id]));
  const missingRoles = Object.values(ROLE_NAMES).filter((name) => !roleIdByName.has(name));
  if (missingRoles.length > 0) {
    const inserted = await db
      .insert(roles)
      .values(missingRoles.map((name) => ({ name, description: name, isSystem: true })))
      .returning({ id: roles.id, name: roles.name });
    for (const r of inserted) roleIdByName.set(r.name, r.id);
  }

  // 3. Assign default permissions to roles (bulk, idempotent).
  const permissionRows = await db.select({ id: permissions.id, code: permissions.code }).from(permissions);
  const permissionIdByCode = new Map(permissionRows.map((p) => [p.code, p.id]));
  const rolePermissionRows: { roleId: string; permissionId: string }[] = [];
  for (const [roleName, perms] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
    const roleId = roleIdByName.get(roleName);
    if (!roleId) continue;
    for (const permCode of perms) {
      const permissionId = permissionIdByCode.get(permCode);
      if (permissionId) rolePermissionRows.push({ roleId, permissionId });
    }
  }
  if (rolePermissionRows.length > 0) {
    await db.insert(rolePermissions).values(rolePermissionRows).onConflictDoNothing();
  }

  // Superadmin accounts always carry the SUPER_ADMIN role so role-based UI
  // and reports see them consistently.
  const superAdminRoleId = roleIdByName.get(ROLE_NAMES.SUPER_ADMIN);
  if (superAdminRoleId) {
    const superadmins = await db.select({ id: users.id }).from(users).where(eq(users.isSuperadmin, true));
    if (superadmins.length > 0) {
      await db
        .insert(userRoles)
        .values(superadmins.map((u) => ({ userId: u.id, roleId: superAdminRoleId })))
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
