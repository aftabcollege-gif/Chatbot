"use client";

import { useState, useEffect } from "react";
import { timeAgo } from "@/lib/persian-date";

interface KnowledgeItem {
  id: string;
  title: string;
  subject: string | null;
  content: string;
  summary: string | null;
  status: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "پیش‌نویس", className: "status-draft" },
  UNDER_REVIEW: { label: "در حال بررسی", className: "status-review" },
  APPROVED: { label: "تأیید شده", className: "status-approved" },
  PUBLISHED: { label: "منتشر شده", className: "status-published" },
  ARCHIVED: { label: "آرشیو شده", className: "status-archived" },
};

export default function KnowledgePage() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", subject: "", content: "", tags: "" });

  useEffect(() => {
    loadItems();
  }, []);

  const loadItems = async () => {
    try {
      const res = await fetch("/api/knowledge");
      if (res.ok) {
        const data = await res.json() as KnowledgeItem[];
        setItems(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, tags }),
      });
      const data = await res.json() as KnowledgeItem & { error?: string };
      if (res.ok) {
        setItems((prev) => [data, ...prev]);
        setShowForm(false);
        setForm({ title: "", subject: "", content: "", tags: "" });
      } else {
        setError(data.error ?? "خطا");
      }
    } catch {
      setError("خطا در اتصال");
    } finally {
      setSubmitting(false);
    }
  };

  const active = activeId ? items.find((i) => i.id === activeId) : null;

  return (
    <div className="h-full flex overflow-hidden">
      {/* List */}
      <div className="w-72 flex-shrink-0 border-l border-slate-700 flex flex-col bg-slate-800">
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <h1 className="text-white font-semibold text-sm">پایگاه دانش</h1>
          <button
            onClick={() => setShowForm(!showForm)}
            className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1.5 rounded-lg transition-colors"
          >
            + افزودن
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
            <div className="text-center text-slate-500 text-sm py-6">بارگذاری...</div>
          ) : items.length === 0 ? (
            <div className="text-center text-slate-500 text-sm py-6">هنوز موردی ثبت نشده</div>
          ) : (
            items.map((item) => {
              const status = STATUS_LABELS[item.status] ?? { label: item.status, className: "status-draft" };
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveId(item.id === activeId ? null : item.id)}
                  className={`w-full text-right px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    activeId === item.id ? "bg-blue-700 text-white" : "text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  <div className="truncate font-medium text-xs">{item.title}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${status.className}`}>
                      {status.label}
                    </span>
                    <span className="text-slate-600 text-xs">{timeAgo(item.createdAt)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 overflow-y-auto p-6">
        {showForm ? (
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white text-lg font-semibold">افزودن مطلب دانشی</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1">عنوان *</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  required
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">موضوع</label>
                <input
                  value={form.subject}
                  onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">محتوا *</label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
                  required
                  rows={6}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm resize-none focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">برچسب‌ها (با کاما)</label>
                <input
                  value={form.tags}
                  onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2.5 rounded-lg text-sm font-medium"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium"
                >
                  {submitting ? "در حال ذخیره..." : "ذخیره"}
                </button>
              </div>
            </form>
          </div>
        ) : active ? (
          <div className="max-w-2xl mx-auto">
            <h2 className="text-white text-lg font-semibold mb-2">{active.title}</h2>
            {active.subject && <p className="text-slate-400 text-sm mb-4">موضوع: {active.subject}</p>}
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-white text-sm leading-relaxed whitespace-pre-wrap">{active.content}</p>
            </div>
            <p className="text-slate-600 text-xs mt-3">{timeAgo(active.createdAt)}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-5xl mb-4">📚</div>
            <h2 className="text-white text-lg font-semibold mb-2">پایگاه دانش سازمانی</h2>
            <p className="text-slate-400 text-sm max-w-sm mb-6">
              مطالب دانشی را اضافه کنید تا در RAG و چت هوشمند قابل جستجو شوند.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-lg text-sm font-medium"
            >
              + افزودن مطلب اول
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
