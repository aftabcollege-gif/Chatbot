"use client";

import { useCallback, useEffect, useState } from "react";
import { timeAgo } from "@/lib/persian-date";

interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  oldestPendingAgeSeconds: number | null;
}

interface WorkerStatus {
  running: number;
  concurrency: number;
  started: boolean;
}

interface ImportProgress {
  scanned?: number;
  imported?: number;
  skippedDuplicate?: number;
  skippedUnsupported?: number;
  skippedTooLarge?: number;
  failed?: number;
  bytes?: number;
  elapsedMs?: number;
  error?: string;
}

interface ActiveImport {
  id: string;
  sourceDir: string;
  startedAt: string;
  finishedAt: string | null;
  /** false once the scan finished (entry lingers for a minute for display). */
  running: boolean;
  progress: ImportProgress | null;
}

interface ImportBatch {
  id: string;
  source_path: string;
  status: string;
  total_files: number;
  imported_files: number;
  skipped_files: number;
  failed_files: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

interface IngestionStatus {
  queue: QueueStats;
  worker: WorkerStatus;
  active: ActiveImport[];
  batches: ImportBatch[];
}

const BATCH_STATUS: Record<string, string> = {
  running: "در حال اجرا",
  completed: "تمام شد",
  failed: "ناموفق",
  cancelled: "لغو شد",
};

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)} ثانیه`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} دقیقه`;
  return `${(seconds / 3600).toFixed(1)} ساعت`;
}

/**
 * Admin panel for the ingestion pipeline:
 *   - live queue / worker status (polls every 3 s while anything is active)
 *   - server-side folder import (the same code path as `npm run import`)
 *   - history of import batches
 */
export function IngestionPanel() {
  const [status, setStatus] = useState<IngestionStatus | null>(null);
  const [error, setError] = useState("");
  const [sourceDir, setSourceDir] = useState("");
  const [mode, setMode] = useState<"copy" | "link">("copy");
  const [dryRun, setDryRun] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/documents/import");
      if (!res.ok) {
        setError("خواندن وضعیت صف ممکن نشد");
        return;
      }
      setStatus((await res.json()) as IngestionStatus);
      setError("");
    } catch {
      setError("خطا در اتصال به سرور");
    }
  }, []);

  const scanRunning = !!status && status.active.some((a) => a.running);
  const busy =
    !!status &&
    (scanRunning || status.queue.pending > 0 || status.queue.processing > 0 || status.worker.running > 0);

  useEffect(() => {
    // Initial fetch runs asynchronously (next tick) and then keeps polling —
    // faster while something is happening, slowly otherwise.
    const initial = setTimeout(() => void load(), 0);
    const interval = setInterval(() => void load(), busy ? 3000 : 15000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [busy, load]);

  const startImport = async () => {
    if (!sourceDir.trim()) return;
    setSubmitting(true);
    setMessage("");
    try {
      const res = await fetch("/api/documents/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceDir: sourceDir.trim(), mode, dryRun }),
      });
      const data = (await res.json()) as { error?: string; importId?: string };
      if (!res.ok) {
        setMessage(data.error ?? "شروع واردکردن ممکن نشد");
      } else {
        setMessage(dryRun ? "پیمایش آزمایشی شروع شد (بدون ذخیره)." : "واردکردن پوشه شروع شد؛ اسناد به صف پردازش اضافه می‌شوند.");
        setTimeout(() => void load(), 800);
      }
    } catch {
      setMessage("خطا در اتصال به سرور");
    } finally {
      setSubmitting(false);
    }
  };

  const cancelImport = async () => {
    await fetch("/api/documents/import", { method: "DELETE" }).catch(() => undefined);
    setTimeout(() => void load(), 500);
  };

  const q = status?.queue;
  const w = status?.worker;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <h2 className="text-white font-semibold">پردازش و واردکردن اسناد</h2>

      {error && <p className="text-red-400 text-sm bg-red-900/20 px-3 py-2 rounded-lg">{error}</p>}

      {/* Queue / worker status */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white text-sm font-medium">وضعیت صف پردازش</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full ${w?.started ? "bg-emerald-900/40 text-emerald-300" : "bg-amber-900/40 text-amber-300"}`}>
            {w?.started ? `کارگر فعال — ${w.running}/${w.concurrency} در حال کار` : "کارگر پس‌زمینه غیرفعال"}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <Stat label="در صف" value={q?.pending ?? "—"} tone="text-amber-300" />
          <Stat label="در حال پردازش" value={q?.processing ?? "—"} tone="text-blue-300" />
          <Stat label="تمام‌شده" value={q?.completed ?? "—"} tone="text-emerald-300" />
          <Stat label="ناموفق" value={q?.failed ?? "—"} tone="text-red-300" />
        </div>
        <p className="text-slate-500 text-xs mt-3">
          قدیمی‌ترین کار در صف: {formatDuration(q?.oldestPendingAgeSeconds ?? null)}
          {" · "}
          تعداد کارگرهای هم‌زمان با <code dir="ltr">INGEST_CONCURRENCY</code> تنظیم می‌شود.
        </p>
      </div>

      {/* Folder import */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
        <h3 className="text-white text-sm font-medium">واردکردن پوشه از روی سرور</h3>
        <p className="text-slate-400 text-xs leading-6">
          مسیر یک پوشه روی همان دستگاهی که برنامه در آن اجرا می‌شود را وارد کنید. همهٔ فایل‌های پشتیبانی‌شده
          (به‌صورت بازگشتی) ثبت و در صف پردازش قرار می‌گیرند؛ فایل‌های تکراری (بر اساس SHA-256) نادیده گرفته می‌شوند.
          برای صدها هزار فایل، دستور <code dir="ltr">npm run import -- &lt;folder&gt; --process</code> در حالی که برنامه
          متوقف است سریع‌تر است.
        </p>
        <input
          dir="ltr"
          type="text"
          value={sourceDir}
          onChange={(e) => setSourceDir(e.target.value)}
          placeholder="/data/archive  یا  D:\archive"
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500 text-left"
        />
        <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={mode === "copy"} onChange={() => setMode("copy")} />
            کپی فایل‌ها به مخزن برنامه (امن‌تر)
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={mode === "link"} onChange={() => setMode("link")} />
            ارجاع در محل (بدون کپی؛ پوشه باید ثابت بماند)
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            فقط شمارش (آزمایشی)
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={startImport}
            disabled={submitting || !sourceDir.trim() || scanRunning}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
          >
            {submitting ? "در حال شروع…" : "▶ شروع واردکردن"}
          </button>
          {scanRunning && (
            <button
              onClick={cancelImport}
              className="bg-slate-700 hover:bg-slate-600 text-white text-sm px-4 py-2 rounded-lg transition-colors"
            >
              ⏹ توقف پیمایش
            </button>
          )}
          {message && <span className="text-slate-300 text-xs">{message}</span>}
        </div>

        {status?.active.map((a) => (
          <div key={a.id} className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 text-xs text-slate-300 space-y-1">
            <div className="flex items-center justify-between">
              <span dir="ltr" className="font-mono text-slate-400 truncate">{a.sourceDir}</span>
              <span>
                {a.running ? "در حال پیمایش" : "پیمایش پایان یافت"} · {timeAgo(a.startedAt)}
              </span>
            </div>
            {a.progress?.error ? (
              <p className="text-red-400">{a.progress.error}</p>
            ) : (
              <p>
                پیمایش‌شده {a.progress?.scanned ?? 0} · واردشده {a.progress?.imported ?? 0} · تکراری{" "}
                {a.progress?.skippedDuplicate ?? 0} · پشتیبانی‌نشده {a.progress?.skippedUnsupported ?? 0} · حجیم{" "}
                {a.progress?.skippedTooLarge ?? 0} · خطا {a.progress?.failed ?? 0}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Batch history */}
      {status && status.batches.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
          <h3 className="text-white text-sm font-medium mb-3">سابقهٔ واردکردن</h3>
          <div className="space-y-2">
            {status.batches.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-xs bg-slate-900/50 rounded-lg px-3 py-2">
                <span dir="ltr" className="font-mono text-slate-400 truncate max-w-[50%]">{b.source_path}</span>
                <span className="text-slate-300">
                  {BATCH_STATUS[b.status] ?? b.status} · {b.imported_files}/{b.total_files} واردشده
                  {b.skipped_files ? ` · ${b.skipped_files} ردشده` : ""}
                  {b.failed_files ? ` · ${b.failed_files} خطا` : ""}
                </span>
                <span className="text-slate-500">{timeAgo(b.started_at)}</span>
                {b.error && <span className="text-red-400 w-full">{b.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className="bg-slate-900/50 rounded-lg py-3">
      <div className={`text-xl font-bold ${tone}`}>{value}</div>
      <div className="text-slate-500 text-xs mt-1">{label}</div>
    </div>
  );
}
