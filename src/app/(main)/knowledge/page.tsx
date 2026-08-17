"use client";

import React, { useState, useEffect } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { Brain, Plus, Search, Clock, User, Tag, Building2, Send, CheckCircle2, Globe2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getRelativeTime } from "@/lib/persian-date";
import { useAuth } from "@/lib/auth-context";

interface KnowledgeItemData {
  id: string;
  title: string;
  subject: string | null;
  problemDescription: string;
  actionTaken: string;
  result: string | null;
  lessonLearned: string;
  status: string;
  visibility: string | null;
  createdAt: string;
}

const statusConfig: Record<string, { label: string; variant: "secondary" | "warning" | "info" | "success" }> = {
  DRAFT: { label: "پیش‌نویس", variant: "secondary" },
  PENDING: { label: "در انتظار تأیید", variant: "warning" },
  APPROVED: { label: "تأیید شده", variant: "info" },
  PUBLISHED: { label: "منتشر شده", variant: "success" },
};

const tabs = [
  { id: "all", label: "همه" },
  { id: "DRAFT", label: "پیش‌نویس" },
  { id: "APPROVED", label: "تأیید شده" },
  { id: "PUBLISHED", label: "منتشر شده" },
];

export default function KnowledgePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || !!user?.permissions?.includes("*");
  const [activeTab, setActiveTab] = useState("all");
  const [items, setItems] = useState<KnowledgeItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetchItems();
  }, []);

  const fetchItems = async () => {
    try {
      const res = await fetch("/api/knowledge");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = items
    .filter((k) => activeTab === "all" || k.status === activeTab)
    .filter((k) => !searchQuery || k.title.includes(searchQuery) || k.problemDescription.includes(searchQuery));

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="دانش سازمانی" />

      <div className="flex-1 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="جستجو در تجربیات..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-4 pr-10 py-2 bg-[#17211D] border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 w-64"
              />
            </div>
          </div>
          <Button className="gap-2" onClick={() => setShowForm(!showForm)}>
            <Plus size={18} />
            ثبت تجربه جدید
          </Button>
        </div>

        {showForm && <KnowledgeForm onSubmit={() => { setShowForm(false); fetchItems(); }} onCancel={() => setShowForm(false)} />}

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

        {loading ? (
          <div className="text-center py-12 text-gray-400">در حال بارگذاری...</div>
        ) : filteredItems.length === 0 ? (
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
            {filteredItems.map((item) => (
              <KnowledgeCard key={item.id} item={item} isAdmin={isAdmin} onChanged={fetchItems} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KnowledgeCard({
  item,
  isAdmin,
  onChanged,
}: {
  item: KnowledgeItemData;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const status = statusConfig[item.status] || statusConfig.DRAFT;
  const [updating, setUpdating] = useState(false);

  const updateStatus = async (nextStatus: string) => {
    setUpdating(true);
    try {
      const res = await fetch(`/api/knowledge/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) onChanged();
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Card className="p-5 hover:border-emerald-500/30 transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/20">
            <Brain size={20} className="text-emerald-400" />
          </div>
          <div>
            <h3 className="text-white font-medium">{item.title}</h3>
            <div className="flex items-center gap-3 text-sm text-gray-500 mt-1">
              {item.subject && (
                <span className="flex items-center gap-1">
                  <Tag size={12} />
                  {item.subject}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock size={12} />
                {getRelativeTime(item.createdAt)}
              </span>
            </div>
          </div>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
      <p className="text-sm text-gray-400 line-clamp-2">{item.problemDescription}</p>
      {item.lessonLearned && (
        <div className="mt-3 p-3 bg-emerald-500/5 rounded-lg border border-emerald-500/10">
          <p className="text-xs text-emerald-400 mb-1">درس‌آموخته:</p>
          <p className="text-sm text-gray-300 line-clamp-2">{item.lessonLearned}</p>
        </div>
      )}

      <div className="flex items-center gap-2 mt-4">
        {item.status === "DRAFT" && (
          <Button size="sm" variant="outline" className="gap-1" disabled={updating} onClick={() => updateStatus("PENDING")}>
            <Send size={14} />
            ارسال برای تأیید
          </Button>
        )}
        {isAdmin && item.status === "PENDING" && (
          <Button size="sm" variant="outline" className="gap-1" disabled={updating} onClick={() => updateStatus("APPROVED")}>
            <CheckCircle2 size={14} />
            تأیید (قابل استفاده در چت)
          </Button>
        )}
        {isAdmin && item.status === "APPROVED" && (
          <Button size="sm" variant="outline" className="gap-1" disabled={updating} onClick={() => updateStatus("PUBLISHED")}>
            <Globe2 size={14} />
            انتشار عمومی
          </Button>
        )}
      </div>
    </Card>
  );
}

function KnowledgeForm({ onSubmit, onCancel }: { onSubmit: () => void; onCancel: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "",
    subject: "",
    problemDescription: "",
    actionTaken: "",
    result: "",
    lessonLearned: "",
    suggestion: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        onSubmit();
      } else {
        const data = await res.json();
        setError(data.error || "خطا");
      }
    } catch {
      setError("خطا در ارتباط با سرور");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6 mb-6">
      <h3 className="text-lg font-semibold text-white mb-4">ثبت تجربه جدید</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm text-gray-400 mb-1 block">عنوان *</label>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full p-3 bg-[#17211D] border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500/50" required />
        </div>
        <div>
          <label className="text-sm text-gray-400 mb-1 block">موضوع</label>
          <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="w-full p-3 bg-[#17211D] border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500/50" />
        </div>
        <div>
          <label className="text-sm text-gray-400 mb-1 block">شرح مسئله *</label>
          <textarea value={form.problemDescription} onChange={(e) => setForm({ ...form, problemDescription: e.target.value })} className="w-full p-3 bg-[#17211D] border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500/50 min-h-[80px]" required />
        </div>
        <div>
          <label className="text-sm text-gray-400 mb-1 block">اقدام انجام‌شده *</label>
          <textarea value={form.actionTaken} onChange={(e) => setForm({ ...form, actionTaken: e.target.value })} className="w-full p-3 bg-[#17211D] border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500/50 min-h-[80px]" required />
        </div>
        <div>
          <label className="text-sm text-gray-400 mb-1 block">نتیجه</label>
          <input value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} className="w-full p-3 bg-[#17211D] border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500/50" />
        </div>
        <div>
          <label className="text-sm text-gray-400 mb-1 block">درس‌آموخته *</label>
          <textarea value={form.lessonLearned} onChange={(e) => setForm({ ...form, lessonLearned: e.target.value })} className="w-full p-3 bg-[#17211D] border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500/50 min-h-[80px]" required />
        </div>
        <div>
          <label className="text-sm text-gray-400 mb-1 block">پیشنهاد</label>
          <textarea value={form.suggestion} onChange={(e) => setForm({ ...form, suggestion: e.target.value })} className="w-full p-3 bg-[#17211D] border border-white/10 rounded-xl text-white focus:outline-none focus:border-emerald-500/50" />
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="flex gap-3">
          <Button type="submit" loading={loading}>ثبت تجربه</Button>
          <Button type="button" variant="outline" onClick={onCancel}>انصراف</Button>
        </div>
      </form>
    </Card>
  );
}
