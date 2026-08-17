"use client";

import React, { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  Users,
  Plus,
  Search,
  Filter,
  MoreVertical,
  Edit3,
  Trash2,
  Key,
  Shield,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getRelativeTime } from "@/lib/persian-date";

interface User {
  id: string;
  name: string;
  email: string;
  username: string;
  role: string;
  department: string;
  isActive: boolean;
  lastLogin: string;
  createdAt: string;
}

const mockUsers: User[] = [
  {
    id: "1",
    name: "علی رضایی",
    email: "ali.rezaei@company.com",
    username: "ali.rezaei",
    role: "admin",
    department: "فناوری اطلاعات",
    isActive: true,
    lastLogin: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "2",
    name: "سارا احمدی",
    email: "sara.ahmadi@company.com",
    username: "sara.ahmadi",
    role: "user",
    department: "واحد تولید",
    isActive: true,
    lastLogin: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "3",
    name: "محمد کریمی",
    email: "m.karimi@company.com",
    username: "m.karimi",
    role: "manager",
    department: "واحد مالی",
    isActive: false,
    lastLogin: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

const roleConfig: Record<string, { label: string; variant: "default" | "success" | "warning" | "info" }> = {
  admin: { label: "مدیر سیستم", variant: "success" },
  manager: { label: "مدیر واحد", variant: "info" },
  user: { label: "کاربر", variant: "default" },
};

export default function UsersPage() {
  const [users] = useState<User[]>(mockUsers);
  const [searchQuery, setSearchQuery] = useState("");

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
          <Button className="gap-2">
            <Plus size={18} />
            کاربر جدید
          </Button>
        </div>

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
                    </td>
                    <td className="p-4 text-sm text-gray-400">
                      {getRelativeTime(user.lastLogin)}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon">
                          <Edit3 size={16} />
                        </Button>
                        <Button variant="ghost" size="icon">
                          <Key size={16} />
                        </Button>
                        <Button variant="ghost" size="icon">
                          <Shield size={16} />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-red-400">
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
