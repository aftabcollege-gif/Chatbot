"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { timeAgo } from "@/lib/persian-date";
import { formatFileSize } from "@/lib/utils";
import { IngestionPanel } from "@/components/admin/ingestion-panel";

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
  uptimeSeconds: number;
  database: { ok: boolean; latencyMs: number; vectorSearch: boolean };
  models: { llm: boolean; embedding: boolean };
  ingestion: {
    workerStarted: boolean;
    running: number;
    concurrency: number;
    queue: { pending: number; processing: number; completed: number; failed: number } | null;
  };
  authCache?: { size: number; hits: number; misses: number; ttlMs: number };
  maintenance?: { lastRunAt: string | null; intervalMinutes: number };
  memory?: { rssMb: number; heapUsedMb: number };
}

interface AiStatus {
  llm: { available: boolean; name: string; isLocal: boolean };
  embedding: { available: boolean; name: string; isLocal: boolean; dimensions: number };
}

export default function AdminPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  useEffect(() => {
    if (user && !user.isAdmin) {
      router.push("/chat");
    }
  }, [user, router]);

  // Health: process status (public) + live AI provider status (admin-only),
  // fetched in parallel; refreshed on every tab change and every 30 s.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [healthRes, systemRes] = await Promise.all([fetch("/api/health"), fetch("/api/admin/system")]);
        const healthJson = healthRes.ok ? ((await healthRes.json()) as HealthStatus) : null;
        const systemJson = systemRes.ok ? ((await systemRes.json()) as { ai: AiStatus }) : null;
        if (cancelled) return;
        if (healthJson) setHealth(healthJson);
        if (systemJson) setAi(systemJson.ai);
        setCheckedAt(new Date().toISOString());
      } catch {
        /* transient — next refresh retries */
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "audit") return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/audit?limit=50");
        const logs = res.ok ? ((await res.json()) as AuditLog[]) : [];
        if (!cancelled) setAuditLogs(logs);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoadingAudit(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const openTab = (id: string) => {
    if (id === "audit") setLoadingAudit(true);
    setActiveTab(id);
  };

  if (!user?.isAdmin) return null;

  const TABS = [
    { id: "dashboard", label: "داشبورد" },
    { id: "ai", label: "وضعیت AI" },
    { id: "audit", label: "گزارش حسابرسی" },
    { id: "jobs", label: "پردازش و واردکردن" },
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
            onClick={() => openTab(tab.id)}
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
                  <div className={`w-2 h-2 rounded-full ${health?.database?.ok ? "bg-green-400" : "bg-red-400"}`} />
                  <span className="text-white font-medium">
                    {health ? (health.database?.ok ? "آماده" : "خطا") : "در حال بررسی..."}
                  </span>
                  {health?.database && (
                    <span className="text-slate-500 text-xs">
                      {health.database.latencyMs} ms · {health.database.vectorSearch ? "جستجوی برداری فعال" : "فقط جستجوی کلیدواژه"}
                    </span>
                  )}
                </div>
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
                <p className="text-slate-400 text-sm mb-1">مدل LLM</p>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${ai?.llm.available ? "bg-green-400" : "bg-yellow-400"}`} />
                  <span className="text-white font-medium text-sm">
                    {ai?.llm.available ? ai.llm.name : "نصب نشده (پاسخ استخراجی از منابع)"}
                  </span>
                </div>
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
                <p className="text-slate-400 text-sm mb-1">مدل Embedding</p>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${ai?.embedding.available ? "bg-green-400" : "bg-yellow-400"}`} />
                  <span className="text-white font-medium text-sm">
                    {ai?.embedding.available ? ai.embedding.name : "نصب نشده (جستجوی کلیدواژه)"}
                  </span>
                </div>
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
                <p className="text-slate-400 text-sm mb-1">صف پردازش اسناد</p>
                {health?.ingestion?.queue ? (
                  <div className="text-sm text-white">
                    <span className="text-amber-300">{health.ingestion.queue.pending} در انتظار</span>
                    {" · "}
                    <span className="text-blue-300">{health.ingestion.queue.processing} در حال پردازش</span>
                    {" · "}
                    <span className="text-emerald-300">{health.ingestion.queue.completed} تکمیل‌شده</span>
                    {health.ingestion.queue.failed > 0 && (
                      <>
                        {" · "}
                        <span className="text-red-300">{health.ingestion.queue.failed} ناموفق</span>
                      </>
                    )}
                    <p className="text-slate-500 text-xs mt-1">
                      کارگر پس‌زمینه: {health.ingestion.workerStarted ? `فعال (${health.ingestion.concurrency} همزمان)` : "غیرفعال"}
                    </p>
                  </div>
                ) : (
                  <span className="text-slate-500 text-sm">—</span>
                )}
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
                <p className="text-slate-400 text-sm mb-1">حافظه و زمان اجرا</p>
                <span className="text-white font-medium text-sm">
                  {health?.memory ? `${health.memory.rssMb} MB` : "—"}
                  {health ? ` · ${Math.floor(health.uptimeSeconds / 3600)} ساعت و ${Math.floor((health.uptimeSeconds % 3600) / 60)} دقیقه` : ""}
                </span>
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
                <p className="text-slate-400 text-sm mb-1">آخرین بررسی سلامت</p>
                <span className="text-white font-medium text-sm">
                  {checkedAt ? timeAgo(checkedAt) : "—"}
                </span>
                {health?.maintenance?.lastRunAt && (
                  <p className="text-slate-500 text-xs mt-1">
                    نگهداری دوره‌ای: {timeAgo(health.maintenance.lastRunAt)} (هر {health.maintenance.intervalMinutes} دقیقه)
                  </p>
                )}
              </div>
            </div>

            {/* Local model setup guide */}
            {ai && !ai.llm.available && (
              <div className="bg-blue-900/20 border border-blue-700 rounded-xl p-5">
                <h3 className="text-blue-300 font-medium mb-2">راهنمای فعال‌سازی مدل زبانی محلی (آفلاین)</h3>
                <ol className="text-blue-200 text-sm space-y-1 list-decimal list-inside">
                  <li>فایل مدل GGUF را در مسیر <code className="bg-slate-800 px-1 rounded">models/llm/model.gguf</code> قرار دهید (یا <code className="bg-slate-800 px-1 rounded">node scripts/install-model.mjs</code> را روی سیستمی با اینترنت اجرا کنید).</li>
                  <li>برای جستجوی معنایی، مدل Embedding را در <code className="bg-slate-800 px-1 rounded">models/embeddings/model.gguf</code> قرار دهید و <code className="bg-slate-800 px-1 rounded">LOCAL_EMBEDDING_ENABLED=true</code> کنید.</li>
                  <li>برنامه را دوباره اجرا کنید؛ مدل‌ها به‌صورت خودکار شناسایی می‌شوند (بدون هیچ API Key).</li>
                </ol>
                <p className="text-slate-400 text-xs mt-2">
                  ⚠️ بدون مدل زبانی، پاسخ‌ها مستقیماً از متن منابع استخراج می‌شوند و جستجو کلیدواژه‌ای است.
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
                  <span className="text-white text-sm">{ai?.llm.name ?? "نامشخص"}</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    ai?.llm.available
                      ? "bg-green-900/50 text-green-400"
                      : "bg-yellow-900/50 text-yellow-400"
                  }`}>
                    {ai?.llm.available ? "فعال" : "غیرفعال"}
                  </span>
                </div>
                <p className="text-slate-600 text-xs mt-1">
                  {ai?.llm.isLocal ? "✅ کاملاً محلی (بدون Cloud)" : "⚠️ Cloud"}
                </p>
              </div>
              <hr className="border-slate-700" />
              <div>
                <p className="text-slate-400 text-xs font-medium mb-2">مدل Embedding</p>
                <div className="flex items-center justify-between">
                  <span className="text-white text-sm">{ai?.embedding.name ?? "نامشخص"}</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    ai?.embedding.available
                      ? "bg-green-900/50 text-green-400"
                      : "bg-yellow-900/50 text-yellow-400"
                  }`}>
                    {ai?.embedding.available ? "فعال" : "Local Fallback"}
                  </span>
                </div>
                <p className="text-slate-600 text-xs mt-1">ابعاد: {ai?.embedding.dimensions ?? "—"}</p>
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

        {activeTab === "jobs" && <IngestionPanel />}
      </div>
    </div>
  );
}
