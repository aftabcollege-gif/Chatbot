"use client";

import React, { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import {
  Plus,
  Search,
  Filter,
  Trash2,
  Key,
  Shield,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { getRelativeTime } from "@/lib/persian-date";

interface User {
  id: string;
  name: string;
  email: string;
  username: string;
  role: string;
  department: string;
  isActive: boolean;
  lastLogin: string | null;
  createdAt?: string;
}

const roleConfig: Record<string, { label: string; variant: "default" | "success" | "warning" | "info" }> = {
  SUPER_ADMIN: { label: "مدیر ارشد سیستم", variant: "success" },
  ORG_ADMIN: { label: "مدیر سازمان", variant: "success" },
  DEPARTMENT_MANAGER: { label: "مدیر واحد", variant: "info" },
  KNOWLEDGE_MANAGER: { label: "مدیر دانش", variant: "info" },
  REVIEWER: { label: "بازبین", variant: "warning" },
  EMPLOYEE: { label: "کارمند", variant: "default" },
  VIEWER: { label: "بیننده", variant: "default" },
  admin: { label: "مدیر سیستم", variant: "success" },
  user: { label: "کاربر", variant: "default" },
};

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", username: "", password: "" });

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "خطا در دریافت کاربران");
      }
      const data = (await res.json()) as { items: User[] };
      setUsers(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در ارتباط با سرور");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "خطا در ایجاد کاربر");
      setShowCreate(false);
      setForm({ name: "", email: "", username: "", password: "" });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در ارتباط با سرور");
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (user: User) => {
    await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ isActive: !user.isActive }),
    });
    await loadUsers();
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`آیا از حذف کاربر «${user.name}» مطمئن هستید؟`)) return;
    await fetch(`/api/admin/users/${user.id}`, { method: "DELETE", credentials: "include" });
    await loadUsers();
  };

  const filteredUsers = users.filter(
    (user) =>
      user.name.includes(searchQuery) ||
      user.email.includes(searchQuery) ||
      user.username.includes(searchQuery)
  );

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="مدیریت کاربران" showModelStatus={false} />

      <div className="flex-1 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search
                size={18}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="جستجوی کاربر..."
                className="pl-4 pr-10 py-2 bg-[#17211D] border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 w-64"
              />
            </div>
            <Button variant="outline" className="gap-2">
              <Filter size={16} />
              فیلتر
            </Button>
          </div>
          <Button className="gap-2" onClick={() => setShowCreate((v) => !v)}>
            <Plus size={18} />
            کاربر جدید
          </Button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            {error}
          </div>
        )}

        {showCreate && (
          <Card className="p-4 mb-6">
            <form onSubmit={handleCreate} className="grid grid-cols-2 gap-3">
              <input
                required
                placeholder="نام و نام خانوادگی"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="bg-[#17211D] border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
              />
              <input
                required
                type="email"
                placeholder="ایمیل"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="bg-[#17211D] border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
              />
              <input
                required
                placeholder="نام کاربری"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="bg-[#17211D] border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
              />
              <input
                required
                type="password"
                minLength={8}
                placeholder="رمز عبور (حداقل ۸ کاراکتر)"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="bg-[#17211D] border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
              />
              <div className="col-span-2 flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                  انصراف
                </Button>
                <Button type="submit" loading={creating}>
                  ایجاد کاربر
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Users Table */}
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-right p-4 text-sm font-medium text-gray-400">
                    کاربر
                  </th>
                  <th className="text-right p-4 text-sm font-medium text-gray-400">
                    نقش
                  </th>
                  <th className="text-right p-4 text-sm font-medium text-gray-400">
                    واحد
                  </th>
                  <th className="text-right p-4 text-sm font-medium text-gray-400">
                    وضعیت
                  </th>
                  <th className="text-right p-4 text-sm font-medium text-gray-400">
                    آخرین ورود
                  </th>
                  <th className="text-right p-4 text-sm font-medium text-gray-400">
                    عملیات
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-gray-500">
                      در حال بارگذاری...
                    </td>
                  </tr>
                )}
                {!loading && filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-gray-500">
                      کاربری یافت نشد
                    </td>
                  </tr>
                )}
                {filteredUsers.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-white/5 hover:bg-white/5 transition-colors"
                  >
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={user.name} size="sm" />
                        <div>
                          <p className="text-white font-medium">{user.name}</p>
                          <p className="text-sm text-gray-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge variant={roleConfig[user.role]?.variant || "default"}>
                        {roleConfig[user.role]?.label || user.role}
                      </Badge>
                    </td>
                    <td className="p-4 text-gray-300">{user.department}</td>
                    <td className="p-4">
                      <button
                        onClick={() => void handleToggleActive(user)}
                        className="flex items-center gap-1"
                        title="تغییر وضعیت فعال/غیرفعال"
                      >
                        {user.isActive ? (
                          <span className="flex items-center gap-1 text-emerald-400 text-sm">
                            <CheckCircle size={14} />
                            فعال
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-400 text-sm">
                            <XCircle size={14} />
                            غیرفعال
                          </span>
                        )}
                      </button>
                    </td>
                    <td className="p-4 text-sm text-gray-400">
                      {user.lastLogin ? getRelativeTime(user.lastLogin) : "—"}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" title="بازنشانی رمز عبور">
                          <Key size={16} />
                        </Button>
                        <Button variant="ghost" size="icon" title="نقش‌ها">
                          <Shield size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-400"
                          onClick={() => void handleDelete(user)}
                          title="حذف کاربر"
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
