"use client";

import React, { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  Plus,
  Trash2,
  Users,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Role {
  id: string;
  name: string;
  description: string | null;
  usersCount: number;
  isSystem: boolean;
  permissions: string[];
}

interface Permission {
  code: string;
  description: string | null;
}

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [creating, setCreating] = useState(false);

  const categoryOf = (code: string) => code.split(".")[0];
  const categories = [...new Set(allPermissions.map((p) => categoryOf(p.code)))];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/roles", { credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "خطا در دریافت نقش‌ها");
      }
      const data = (await res.json()) as { roles: Role[]; permissions: Permission[] };
      setRoles(data.roles ?? []);
      setAllPermissions(data.permissions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در ارتباط با سرور");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: newRoleName.trim(), permissionCodes: [] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "خطا در ایجاد نقش");
      setNewRoleName("");
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در ارتباط با سرور");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteRole = async (role: Role) => {
    if (!confirm(`آیا از حذف نقش «${role.name}» مطمئن هستید؟`)) return;
    await fetch(`/api/admin/roles/${role.id}`, { method: "DELETE", credentials: "include" });
    if (selectedRole?.id === role.id) setSelectedRole(null);
    await load();
  };

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="مدیریت نقش‌ها" showModelStatus={false} />

      <div className="flex-1 p-6">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            {error}
          </div>
        )}
        <div className="flex gap-6">
          {/* Roles List */}
          <div className="w-80 shrink-0 space-y-4">
            {showCreate ? (
              <form onSubmit={handleCreateRole} className="flex gap-2">
                <input
                  autoFocus
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder="نام نقش جدید"
                  className="flex-1 bg-[#17211D] border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
                />
                <Button type="submit" size="sm" loading={creating}>
                  ثبت
                </Button>
              </form>
            ) : (
              <Button className="w-full gap-2" onClick={() => setShowCreate(true)}>
                <Plus size={18} />
                نقش جدید
              </Button>
            )}

            {loading && <p className="text-sm text-gray-500 text-center py-4">در حال بارگذاری...</p>}

            {roles.map((role) => (
              <Card
                key={role.id}
                className={cn(
                  "p-4 cursor-pointer transition-all",
                  selectedRole?.id === role.id
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : "hover:border-white/20"
                )}
                onClick={() => setSelectedRole(role)}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Shield
                        size={16}
                        className={cn(
                          role.name === "admin"
                            ? "text-emerald-400"
                            : role.name === "manager"
                            ? "text-blue-400"
                            : "text-gray-400"
                        )}
                      />
                      <h3 className="text-white font-medium">{role.name}</h3>
                      {role.isSystem && (
                        <Badge variant="secondary" className="text-xs">
                          سیستمی
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">{role.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3 text-xs text-gray-500">
                  <Users size={12} />
                  <span>{role.usersCount} کاربر</span>
                </div>
              </Card>
            ))}
          </div>

          {/* Permissions Editor */}
          <div className="flex-1">
            {selectedRole ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Shield size={20} className="text-emerald-400" />
                      مجوزهای نقش «{selectedRole.name}»
                    </CardTitle>
                    {!selectedRole.isSystem && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 text-red-400 hover:text-red-300"
                          onClick={() => void handleDeleteRole(selectedRole)}
                        >
                          <Trash2 size={14} />
                          حذف
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {selectedRole.permissions.includes("*") ? (
                    <div className="p-6 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-center">
                      <Shield size={32} className="mx-auto text-emerald-400 mb-2" />
                      <p className="text-emerald-300 font-medium">
                        این نقش دسترسی کامل به سیستم دارد
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {categories.map((category) => {
                        const categoryPermissions = allPermissions.filter(
                          (p) => categoryOf(p.code) === category
                        );
                        return (
                          <div key={category}>
                            <h4 className="text-sm font-medium text-gray-400 mb-3">
                              {category}
                            </h4>
                            <div className="grid grid-cols-2 gap-3">
                              {categoryPermissions.map((permission) => {
                                const hasPermission =
                                  selectedRole.permissions.includes(permission.code);
                                return (
                                  <button
                                    key={permission.code}
                                    disabled={selectedRole.isSystem}
                                    onClick={async () => {
                                      const next = hasPermission
                                        ? selectedRole.permissions.filter((c) => c !== permission.code)
                                        : [...selectedRole.permissions, permission.code];
                                      await fetch(`/api/admin/roles/${selectedRole.id}`, {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        credentials: "include",
                                        body: JSON.stringify({ permissionCodes: next }),
                                      });
                                      setSelectedRole({ ...selectedRole, permissions: next });
                                      await load();
                                    }}
                                    className={cn(
                                      "flex items-center justify-between p-3 rounded-xl border text-right disabled:cursor-not-allowed",
                                      hasPermission
                                        ? "bg-emerald-500/10 border-emerald-500/30"
                                        : "bg-white/5 border-white/10"
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        "text-sm",
                                        hasPermission
                                          ? "text-emerald-300"
                                          : "text-gray-500"
                                      )}
                                    >
                                      {permission.description ?? permission.code}
                                    </span>
                                    {hasPermission ? (
                                      <Check size={16} className="text-emerald-400" />
                                    ) : (
                                      <X size={16} className="text-gray-600" />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="flex items-center justify-center h-96 text-gray-500">
                یک نقش را برای مشاهده مجوزها انتخاب کنید
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
