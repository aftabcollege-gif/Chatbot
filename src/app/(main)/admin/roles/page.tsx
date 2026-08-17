"use client";

import React, { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  Plus,
  Edit3,
  Trash2,
  Users,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Role {
  id: string;
  name: string;
  description: string;
  usersCount: number;
  isSystem: boolean;
  permissions: string[];
}

interface Permission {
  code: string;
  label: string;
  category: string;
}

const mockRoles: Role[] = [
  {
    id: "1",
    name: "admin",
    description: "مدیر سیستم - دسترسی کامل",
    usersCount: 2,
    isSystem: true,
    permissions: ["*"],
  },
  {
    id: "2",
    name: "manager",
    description: "مدیر واحد - مدیریت منابع واحد",
    usersCount: 8,
    isSystem: true,
    permissions: ["chat.create", "chat.read", "documents.upload", "documents.read", "knowledge.create"],
  },
  {
    id: "3",
    name: "user",
    description: "کاربر عادی - دسترسی پایه",
    usersCount: 114,
    isSystem: true,
    permissions: ["chat.create", "chat.read", "documents.read", "knowledge.read"],
  },
];

const allPermissions: Permission[] = [
  { code: "chat.create", label: "ایجاد گفتگو", category: "گفتگو" },
  { code: "chat.read", label: "مشاهده گفتگو", category: "گفتگو" },
  { code: "documents.upload", label: "بارگذاری فایل", category: "منابع" },
  { code: "documents.read", label: "مشاهده فایل", category: "منابع" },
  { code: "documents.delete", label: "حذف فایل", category: "منابع" },
  { code: "knowledge.create", label: "ثبت تجربه", category: "دانش" },
  { code: "knowledge.read", label: "مشاهده تجربه", category: "دانش" },
  { code: "knowledge.approve", label: "تأیید تجربه", category: "دانش" },
  { code: "admin.users", label: "مدیریت کاربران", category: "مدیریت" },
  { code: "admin.roles", label: "مدیریت نقش‌ها", category: "مدیریت" },
  { code: "admin.settings", label: "تنظیمات", category: "مدیریت" },
  { code: "admin.logs", label: "مشاهده لاگ", category: "مدیریت" },
];

const categories = [...new Set(allPermissions.map((p) => p.category))];

export default function RolesPage() {
  const [roles] = useState<Role[]>(mockRoles);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="مدیریت نقش‌ها" showModelStatus={false} />

      <div className="flex-1 p-6">
        <div className="flex gap-6">
          {/* Roles List */}
          <div className="w-80 shrink-0 space-y-4">
            <Button className="w-full gap-2">
              <Plus size={18} />
              نقش جدید
            </Button>

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
                        <Button variant="outline" size="sm" className="gap-1">
                          <Edit3 size={14} />
                          ویرایش
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 text-red-400 hover:text-red-300"
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
                          (p) => p.category === category
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
                                  <div
                                    key={permission.code}
                                    className={cn(
                                      "flex items-center justify-between p-3 rounded-xl border",
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
                                      {permission.label}
                                    </span>
                                    {hasPermission ? (
                                      <Check size={16} className="text-emerald-400" />
                                    ) : (
                                      <X size={16} className="text-gray-600" />
                                    )}
                                  </div>
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
