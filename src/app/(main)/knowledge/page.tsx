"use client";

import React, { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  Brain,
  Plus,
  Search,
  Filter,
  Clock,
  User,
  Tag,
  CheckCircle,
  AlertCircle,
  Archive,
  Eye,
  Edit3,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getRelativeTime } from "@/lib/persian-date";

interface KnowledgeItem {
  id: string;
  title: string;
  subject: string;
  department: string;
  owner: string;
  summary: string;
  status: "DRAFT" | "PENDING" | "APPROVED" | "PUBLISHED" | "ARCHIVED";
  result: "success" | "partial" | "failure";
  tags: string[];
  updatedAt: string;
}

const mockKnowledge: KnowledgeItem[] = [
  {
    id: "1",
    title: "علت خرابی مکرر پمپ شماره 4",
    subject: "تعمیرات",
    department: "واحد تولید",
    owner: "علی رضایی",
    summary: "با تغییر فیلتر هر 30 روز به جای 60 روز، مشکل خرابی پمپ برطرف شد",
    status: "PUBLISHED",
    result: "success",
    tags: ["پمپ", "نگهداری", "تجهیزات"],
    updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "2",
    title: "بهینه‌سازی فرآیند بسته‌بندی",
    subject: "بهبود فرآیند",
    department: "واحد بسته‌بندی",
    owner: "مریم احمدی",
    summary: "با تغییر چیدمان خط بسته‌بندی، 15% افزایش سرعت حاصل شد",
    status: "APPROVED",
    result: "success",
    tags: ["بسته‌بندی", "بهینه‌سازی"],
    updatedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "3",
    title: "مشکل کیفیت محصول در دمای بالا",
    subject: "کیفیت",
    department: "واحد کیفیت",
    owner: "حسن کریمی",
    summary: "در دمای بالای 35 درجه، کیفیت محصول افت می‌کند",
    status: "PENDING",
    result: "partial",
    tags: ["کیفیت", "دما"],
    updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

const statusConfig = {
  DRAFT: { label: "پیش‌نویس", variant: "secondary" as const },
  PENDING: { label: "در انتظار تأیید", variant: "warning" as const },
  APPROVED: { label: "تأیید شده", variant: "info" as const },
  PUBLISHED: { label: "منتشر شده", variant: "success" as const },
  ARCHIVED: { label: "آرشیو", variant: "secondary" as const },
};

const resultConfig = {
  success: { label: "موفق", color: "text-emerald-400" },
  partial: { label: "جزئی", color: "text-yellow-400" },
  failure: { label: "ناموفق", color: "text-red-400" },
};

const tabs = [
  { id: "all", label: "همه" },
  { id: "PENDING", label: "در انتظار تأیید" },
  { id: "APPROVED", label: "تأیید شده" },
  { id: "PUBLISHED", label: "منتشر شده" },
  { id: "ARCHIVED", label: "آرشیو" },
];

export default function KnowledgePage() {
  const [activeTab, setActiveTab] = useState("all");
  const [showForm, setShowForm] = useState(false);

  const filteredKnowledge =
    activeTab === "all"
      ? mockKnowledge
      : mockKnowledge.filter((k) => k.status === activeTab);

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="دانش سازمانی" />

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
                placeholder="جستجو در تجربیات..."
                className="pl-4 pr-10 py-2 bg-[#17211D] border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 w-64"
              />
            </div>
            <Button variant="outline" className="gap-2">
              <Filter size={16} />
              فیلتر
            </Button>
          </div>
          <Button className="gap-2" onClick={() => setShowForm(true)}>
            <Plus size={18} />
            ثبت تجربه جدید
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-white/10 pb-3">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm transition-colors",
                activeTab === tab.id
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Knowledge List */}
        {filteredKnowledge.length === 0 ? (
          <EmptyState
            icon={<Brain size={40} />}
            title="تجربه‌ای یافت نشد"
            description="تجربیات و دانش سازمانی خود را ثبت کنید تا همکاران بتوانند از آن استفاده کنند"
            action={{
              label: "ثبت تجربه جدید",
              onClick: () => setShowForm(true),
            }}
          />
        ) : (
          <div className="space-y-4">
            {filteredKnowledge.map((item) => (
              <KnowledgeCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KnowledgeCard({ item }: { item: KnowledgeItem }) {
  const status = statusConfig[item.status];
  const result = resultConfig[item.result];

  return (
    <Card className="p-5 hover:border-emerald-500/30 transition-all group">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/20">
            <Brain size={20} className="text-emerald-400" />
          </div>
          <div>
            <h3 className="text-white font-medium">{item.title}</h3>
            <div className="flex items-center gap-3 text-sm text-gray-500 mt-1">
              <span className="flex items-center gap-1">
                <Building2 size={12} />
                {item.department}
              </span>
              <span className="flex items-center gap-1">
                <Tag size={12} />
                {item.subject}
              </span>
              <span className="flex items-center gap-1">
                <User size={12} />
                {item.owner}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={status.variant}>{status.label}</Badge>
          <span className={cn("text-sm", result.color)}>{result.label}</span>
        </div>
      </div>

      <p className="text-gray-400 text-sm mb-4">{item.summary}</p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          {item.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 bg-white/5 rounded-md text-xs text-gray-400"
            >
              {tag}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 flex items-center gap-1">
            <Clock size={12} />
            {getRelativeTime(item.updatedAt)}
          </span>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            <Button variant="ghost" size="sm" className="gap-1">
              <Eye size={14} />
              مشاهده
            </Button>
            <Button variant="ghost" size="sm" className="gap-1">
              <Edit3 size={14} />
              ویرایش
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
