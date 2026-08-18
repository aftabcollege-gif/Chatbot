"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { timeAgo } from "@/lib/persian-date";
import { formatFileSize } from "@/lib/utils";

interface AuditLog {
  id: string;
  eventCode: string;
  actorName: string | null;
  resourceType: string | null;
  resourceName: string | null;
  outcome: string | null;
  ipAddress: string | null;
  createdAt: string;
}

interface HealthStatus {
  ok: boolean;
  database: string;
  ai: {
    llm: { available: boolean; name: string; isLocal: boolean };
    embedding: { available: boolean; name: string; isLocal: boolean; dimensions: number };
  } | null;
  timestamp: string;
}

export default function AdminPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  useEffect(() => {
    if (user && !user.isAdmin) {
      router.push("/chat");
    }
  }, [user, router]);

  useEffect(() => {
    loadHealth();
    if (activeTab === "audit") loadAuditLogs();
  }, [activeTab]);

  const loadHealth = async () => {
    try {
      const res = await fetch("/api/health");
      if (res.ok) setHealth(await res.json() as HealthStatus);
    } catch { /* ignore */ }
  };

  const loadAuditLogs = async () => {
    setLoadingAudit(true);
    try {
      const res = await fetch("/api/audit?limit=50");
      if (res.ok) setAuditLogs(await res.json() as AuditLog[]);
    } catch { /* ignore */ }
    finally { setLoadingAudit(false); }
  };

  const triggerProcess = async () => {
    try {
      const res = await fetch("/api/jobs/process", {
        method: "POST",
        headers: { "x-job-secret": "internal-job-secret" },
      });
      const data = await res.json() as { processed: boolean };
      alert(data.processed ? "یک کار پردازش شد" : "صف پردازش خالی است");
    } catch {
      alert("خطا در اجرای کار");
    }
  };

  if (!user?.isAdmin) return null;

  const TABS = [
    { id: "dashboard", label: "داشبورد" },
    { id: "ai", label: "وضعیت AI" },
    { id: "audit", label: "گزارش حسابرسی" },
    { id: "jobs", label: "کارهای پردازش" },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-700 bg-slate-800 px-6 py-4 flex-shrink-0">
        <h1 className="text-white font-bold text-lg">پنل مدیریت</h1>
        <p className="text-slate-400 text-sm">⚙️ دسترسی مدیر ارشد — همه عملیات لاگ می‌شود</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700 bg-slate-800 px-6 flex-shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "dashboard" && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
                <p className="text-slate-400 text-sm mb-1">وضعیت پایگاه داده</p>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${health?.database === "READY" ? "bg-green-400" : "bg-red-400"}`} />
                  <span className="text-white font-medium">{health?.database ?? "در حال بررسی..."}</span>
                </div>
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
                <p className="text-slate-400 text-sm mb-1">مدل LLM</p>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${health?.ai?.llm.available ? "bg-green-400" : "bg-yellow-400"}`} />
                  <span className="text-white font-medium text-sm">
                    {health?.ai?.llm.available ? health.ai.llm.name : "آفلاین (Fallback فعال)"}
                  </span>
                </div>
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
                <p className="text-slate-400 text-sm mb-1">مدل Embedding</p>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${health?.ai?.embedding.available ? "bg-green-400" : "bg-yellow-400"}`} />
                  <span className="text-white font-medium text-sm">
                    {health?.ai?.embedding.available ? health.ai.embedding.name : "Local Fallback (Hashing)"}
                  </span>
                </div>
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
                <p className="text-slate-400 text-sm mb-1">آخرین بررسی سلامت</p>
                <span className="text-white font-medium text-sm">
                  {health?.timestamp ? timeAgo(health.timestamp) : "—"}
                </span>
              </div>
            </div>

            {/* Ollama setup guide */}
            {health && !health.ai?.llm.available && (
              <div className="bg-blue-900/20 border border-blue-700 rounded-xl p-5">
                <h3 className="text-blue-300 font-medium mb-2">راهنمای فعال‌سازی Ollama (LLM محلی)</h3>
                <ol className="text-blue-200 text-sm space-y-1 list-decimal list-inside">
                  <li>نصب Ollama: <code className="bg-slate-800 px-1 rounded">https://ollama.com</code></li>
                  <li>دانلود مدل: <code className="bg-slate-800 px-1 rounded">ollama pull qwen2.5:7b</code></li>
                  <li>دانلود Embedding: <code className="bg-slate-800 px-1 rounded">ollama pull nomic-embed-text</code></li>
                  <li>Ollama به‌صورت خودکار شناسایی می‌شود (هیچ API Key نیاز نیست)</li>
                </ol>
                <p className="text-slate-400 text-xs mt-2">
                  ⚠️ بدون Ollama، سیستم از جستجوی کلمه‌کلیدی محلی استفاده می‌کند (بدون LLM).
                  هیچ داده‌ای به Cloud ارسال نمی‌شود.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === "ai" && (
          <div className="max-w-2xl mx-auto space-y-4">
            <h2 className="text-white font-semibold">وضعیت سیستم AI</h2>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
              <div>
                <p className="text-slate-400 text-xs font-medium mb-2">مدل LLM</p>
                <div className="flex items-center justify-between">
                  <span className="text-white text-sm">{health?.ai?.llm.name ?? "نامشخص"}</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    health?.ai?.llm.available
                      ? "bg-green-900/50 text-green-400"
                      : "bg-yellow-900/50 text-yellow-400"
                  }`}>
                    {health?.ai?.llm.available ? "آنلاین" : "غیرفعال"}
                  </span>
                </div>
                <p className="text-slate-600 text-xs mt-1">
                  {health?.ai?.llm.isLocal ? "✅ کاملاً محلی (بدون Cloud)" : "⚠️ Cloud"}
                </p>
              </div>
              <hr className="border-slate-700" />
              <div>
                <p className="text-slate-400 text-xs font-medium mb-2">مدل Embedding</p>
                <div className="flex items-center justify-between">
                  <span className="text-white text-sm">{health?.ai?.embedding.name ?? "نامشخص"}</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    health?.ai?.embedding.available
                      ? "bg-green-900/50 text-green-400"
                      : "bg-yellow-900/50 text-yellow-400"
                  }`}>
                    {health?.ai?.embedding.available ? "آنلاین" : "Local Fallback"}
                  </span>
                </div>
                <p className="text-slate-600 text-xs mt-1">ابعاد: {health?.ai?.embedding.dimensions ?? "—"}</p>
              </div>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
              <p className="text-white font-medium mb-2 text-sm">تضمین امنیتی</p>
              <ul className="text-slate-400 text-xs space-y-1">
                <li>✅ هیچ API Cloud LLM پیکربندی نشده</li>
                <li>✅ Fallback به Cloud ممنوع است (Directive §15)</li>
                <li>✅ تمام پردازش‌ها بر روی سرور محلی انجام می‌شوند</li>
                <li>✅ داده‌های سازمانی هرگز از شبکه خارج نمی‌شوند</li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === "audit" && (
          <div className="max-w-4xl mx-auto">
            <h2 className="text-white font-semibold mb-4">گزارش حسابرسی (آخرین ۵۰ رویداد)</h2>
            {loadingAudit ? (
              <div className="text-slate-500 text-center py-8">بارگذاری...</div>
            ) : auditLogs.length === 0 ? (
              <div className="text-slate-500 text-center py-8">هنوز رویدادی ثبت نشده</div>
            ) : (
              <div className="space-y-2">
                {auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 flex items-center gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${
                          log.outcome === "FAILURE"
                            ? "bg-red-900/50 text-red-400"
                            : "bg-green-900/50 text-green-400"
                        }`}>
                          {log.eventCode}
                        </span>
                        {log.actorName && (
                          <span className="text-slate-400 text-xs truncate">{log.actorName}</span>
                        )}
                      </div>
                      {log.resourceName && (
                        <p className="text-slate-500 text-xs mt-0.5 truncate">{log.resourceName}</p>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-slate-600 text-xs">
                      {timeAgo(log.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "jobs" && (
          <div className="max-w-2xl mx-auto space-y-4">
            <h2 className="text-white font-semibold">مدیریت کارهای پردازش</h2>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
              <div>
                <h3 className="text-white text-sm font-medium mb-2">پردازش دستی</h3>
                <p className="text-slate-400 text-sm mb-3">
                  اسناد بارگذاری‌شده برای پردازش در صف هستند.
                  برای پردازش فوری دکمه زیر را کلیک کنید.
                </p>
                <button
                  onClick={triggerProcess}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors"
                >
                  ▶ پردازش کار بعدی
                </button>
              </div>
              <hr className="border-slate-700" />
              <div>
                <p className="text-slate-400 text-xs">
                  ⚠️ در محیط Production، از یک Cron Job هر ۳۰ ثانیه برای پردازش خودکار استفاده کنید.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
