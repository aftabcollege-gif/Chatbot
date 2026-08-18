"use client";

import { useState, useEffect } from "react";
import { timeAgo } from "@/lib/persian-date";

interface Experience {
  id: string;
  title: string;
  problemDescription: string;
  lessonsLearned: string;
  importance: string;
  status: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "پیش‌نویس", className: "status-draft" },
  SUBMITTED: { label: "ارسال‌شده", className: "status-submitted" },
  UNDER_REVIEW: { label: "در حال بررسی", className: "status-review" },
  CHANGES_REQUESTED: { label: "نیاز به تغییر", className: "status-failed" },
  APPROVED: { label: "تأیید شده", className: "status-approved" },
  PUBLISHED: { label: "منتشر شده", className: "status-published" },
  ARCHIVED: { label: "آرشیو شده", className: "status-archived" },
};

const IMPORTANCE_LABELS: Record<string, string> = {
  LOW: "پایین",
  MEDIUM: "متوسط",
  HIGH: "بالا",
  CRITICAL: "بحرانی",
};

interface NewExperienceForm {
  title: string;
  problemDescription: string;
  rootCause: string;
  actionsTaken: string;
  results: string;
  lessonsLearned: string;
  suggestion: string;
  importance: string;
  tags: string;
}

export default function ExperiencesPage() {
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [form, setForm] = useState<NewExperienceForm>({
    title: "",
    problemDescription: "",
    rootCause: "",
    actionsTaken: "",
    results: "",
    lessonsLearned: "",
    suggestion: "",
    importance: "MEDIUM",
    tags: "",
  });

  useEffect(() => {
    loadExperiences();
  }, []);

  const loadExperiences = async () => {
    try {
      const res = await fetch("/api/experiences");
      if (res.ok) {
        const data = await res.json() as Experience[];
        setExperiences(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const tags = form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      const res = await fetch("/api/experiences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, tags }),
      });
      const data = await res.json() as Experience & { error?: string };
      if (res.ok) {
        setExperiences((prev) => [data, ...prev]);
        setShowForm(false);
        setForm({
          title: "",
          problemDescription: "",
          rootCause: "",
          actionsTaken: "",
          results: "",
          lessonsLearned: "",
          suggestion: "",
          importance: "MEDIUM",
          tags: "",
        });
      } else {
        setError(data.error ?? "خطا در ثبت تجربه");
      }
    } catch {
      setError("خطا در اتصال به سرور");
    } finally {
      setSubmitting(false);
    }
  };

  const performAction = async (id: string, action: string, notes?: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/experiences/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, notes }),
      });
      if (res.ok) {
        await loadExperiences();
      }
    } catch {
      // ignore
    } finally {
      setActionLoading(false);
    }
  };

  const active = activeId ? experiences.find((e) => e.id === activeId) : null;

  return (
    <div className="h-full flex overflow-hidden">
      {/* List */}
      <div className="w-72 flex-shrink-0 border-l border-slate-700 flex flex-col bg-slate-800">
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          <h1 className="text-white font-semibold text-sm">تجربیات سازمانی</h1>
          <button
            onClick={() => setShowForm(!showForm)}
            className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1.5 rounded-lg transition-colors"
          >
            + ثبت تجربه
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
            <div className="text-center text-slate-500 text-sm py-6">بارگذاری...</div>
          ) : experiences.length === 0 ? (
            <div className="text-center text-slate-500 text-sm py-6 px-4">
              هنوز تجربه‌ای ثبت نشده است
            </div>
          ) : (
            experiences.map((exp) => {
              const status = STATUS_LABELS[exp.status] ?? { label: exp.status, className: "status-draft" };
              return (
                <button
                  key={exp.id}
                  onClick={() => setActiveId(exp.id === activeId ? null : exp.id)}
                  className={`w-full text-right px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    activeId === exp.id
                      ? "bg-blue-700 text-white"
                      : "text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  <div className="truncate font-medium text-xs">{exp.title}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${status.className}`}>
                      {status.label}
                    </span>
                    <span className="text-slate-600 text-xs">{timeAgo(exp.createdAt)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6">
        {showForm ? (
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white text-lg font-semibold">ثبت تجربه جدید</h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1">
                  عنوان تجربه <span className="text-red-400">*</span>
                </label>
                <input
                  name="title"
                  value={form.title}
                  onChange={handleChange}
                  required
                  placeholder="عنوان کوتاه و توصیفی"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">
                  شرح مسئله / رویداد <span className="text-red-400">*</span>
                </label>
                <textarea
                  name="problemDescription"
                  value={form.problemDescription}
                  onChange={handleChange}
                  required
                  rows={3}
                  placeholder="شرح کامل مسئله یا رویدادی که اتفاق افتاد"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">
                  علت ریشه‌ای
                </label>
                <textarea
                  name="rootCause"
                  value={form.rootCause}
                  onChange={handleChange}
                  rows={2}
                  placeholder="چه عاملی باعث بروز مسئله شد؟"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">
                  اقدامات انجام‌شده <span className="text-red-400">*</span>
                </label>
                <textarea
                  name="actionsTaken"
                  value={form.actionsTaken}
                  onChange={handleChange}
                  required
                  rows={3}
                  placeholder="چه اقداماتی برای حل مسئله انجام شد؟"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">
                  نتایج
                </label>
                <textarea
                  name="results"
                  value={form.results}
                  onChange={handleChange}
                  rows={2}
                  placeholder="نتیجه اقدامات انجام‌شده چه بود؟"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">
                  درس‌آموخته <span className="text-red-400">*</span>
                </label>
                <textarea
                  name="lessonsLearned"
                  value={form.lessonsLearned}
                  onChange={handleChange}
                  required
                  rows={3}
                  placeholder="از این تجربه چه درسی می‌توان آموخت؟"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">پیشنهاد</label>
                <textarea
                  name="suggestion"
                  value={form.suggestion}
                  onChange={handleChange}
                  rows={2}
                  placeholder="پیشنهادهای بهبود برای آینده"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm text-slate-300 mb-1">اهمیت</label>
                  <select
                    name="importance"
                    value={form.importance}
                    onChange={handleChange}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="LOW">پایین</option>
                    <option value="MEDIUM">متوسط</option>
                    <option value="HIGH">بالا</option>
                    <option value="CRITICAL">بحرانی</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-sm text-slate-300 mb-1">
                    برچسب‌ها (با کاما جدا کنید)
                  </label>
                  <input
                    name="tags"
                    value={form.tags}
                    onChange={handleChange}
                    placeholder="مثال: برق، ترانسفورماتور، خرابی"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-900/20 px-3 py-2 rounded-lg">{error}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  {submitting ? "در حال ذخیره..." : "ذخیره تجربه"}
                </button>
              </div>
            </form>
          </div>
        ) : active ? (
          <div className="max-w-2xl mx-auto">
            {/* Experience detail */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white text-lg font-semibold">{active.title}</h2>
              <div className="flex items-center gap-2">
                {(() => {
                  const status = STATUS_LABELS[active.status];
                  return status ? (
                    <span className={`text-xs px-2.5 py-1 rounded-full ${status.className}`}>
                      {status.label}
                    </span>
                  ) : null;
                })()}
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                <h3 className="text-slate-400 text-xs font-medium mb-2">شرح مسئله</h3>
                <p className="text-white text-sm leading-relaxed">{active.problemDescription}</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                <h3 className="text-slate-400 text-xs font-medium mb-2">درس‌آموخته</h3>
                <p className="text-white text-sm leading-relaxed">{active.lessonsLearned}</p>
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>اهمیت: {IMPORTANCE_LABELS[active.importance] ?? active.importance}</span>
                <span>•</span>
                <span>ثبت: {timeAgo(active.createdAt)}</span>
              </div>

              {/* Workflow actions */}
              {active.status === "DRAFT" && (
                <div className="bg-blue-900/20 border border-blue-700 rounded-xl p-4">
                  <p className="text-blue-300 text-sm mb-3">
                    برای ارسال جهت بررسی، دکمه زیر را کلیک کنید.
                  </p>
                  <button
                    onClick={() => performAction(active.id, "submit")}
                    disabled={actionLoading}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
                  >
                    ارسال برای بررسی
                  </button>
                </div>
              )}

              {active.status === "SUBMITTED" && (
                <div className="bg-yellow-900/20 border border-yellow-700 rounded-xl p-4">
                  <p className="text-yellow-300 text-sm mb-3">این تجربه آماده بررسی است.</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => performAction(active.id, "approve")}
                      disabled={actionLoading}
                      className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
                    >
                      تأیید
                    </button>
                    <button
                      onClick={() => performAction(active.id, "reject", "نیاز به تکمیل اطلاعات")}
                      disabled={actionLoading}
                      className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
                    >
                      برگشت برای اصلاح
                    </button>
                  </div>
                </div>
              )}

              {active.status === "APPROVED" && (
                <div className="bg-green-900/20 border border-green-700 rounded-xl p-4">
                  <p className="text-green-300 text-sm mb-3">
                    این تجربه تأیید شده است. برای انتشار و ورود به پایگاه دانش RAG کلیک کنید.
                  </p>
                  <button
                    onClick={() => performAction(active.id, "publish")}
                    disabled={actionLoading}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
                  >
                    🚀 انتشار در پایگاه دانش
                  </button>
                </div>
              )}

              {active.status === "PUBLISHED" && (
                <div className="bg-emerald-900/20 border border-emerald-700 rounded-xl p-4">
                  <p className="text-emerald-300 text-sm">
                    ✅ این تجربه منتشر شده و در RAG سازمان ایندکس شده است.
                    کاربران می‌توانند از طریق چت از آن جستجو کنند.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-5xl mb-4">💡</div>
            <h2 className="text-white text-lg font-semibold mb-2">تجربیات سازمانی</h2>
            <p className="text-slate-400 text-sm max-w-sm mb-6">
              تجربیات کارکنان را ثبت کنید. پس از تأیید، به‌صورت خودکار وارد پایگاه دانش
              می‌شوند و از طریق چت هوشمند قابل جستجو می‌شوند.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              + ثبت اولین تجربه
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
