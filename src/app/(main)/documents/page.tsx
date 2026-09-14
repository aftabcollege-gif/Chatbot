"use client";

import React, { useState, useEffect, useRef } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { FolderOpen, Upload, FileText, Trash2, Clock, RefreshCw } from "lucide-react";
import { getRelativeTime } from "@/lib/persian-date";

interface Doc {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  pageCount: number | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

const PROCESSING_STATUSES = new Set([
  "pending",
  "processing",
  "ocr",
  "chunking",
  "embedding",
  "indexing",
]);

export default function ResourcesPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexProgress, setReindexProgress] = useState<number | null>(null);
  const [reindexMessage, setReindexMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchDocs = async () => {
    try {
      const res = await fetch("/api/documents");
      if (res.ok) {
        const data = await res.json();
        // API returns a plain array of documents.
        setDocs(Array.isArray(data) ? data : (data.items ?? []));
      }
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocs();
    // Poll while the list loads or any document is still being processed.
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchDocs();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/documents", { method: "POST", body: form });
      if (res.ok) {
        fetchDocs();
      } else {
        const data = await res.json();
        alert(data.error || "خطا در بارگذاری فایل");
      }
    } catch {
      alert("خطا در ارتباط با سرور");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("آیا از حذف این سند مطمئن هستید؟")) return;
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    fetchDocs();
  };

  /**
   * Rebuild the search index: re-normalizes the Persian full-text index and
   * re-embeds every chunk (semantic vectors) with the local model. This is
   * the repair path for sources indexed by older versions.
   */
  const handleReindex = async () => {
    if (reindexing) return;
    if (
      !confirm(
        "کل شاخص جست‌وجو دوباره ساخته شود؟ برای مجموعه‌های بزرگ ممکن است چند دقیقه طول بکشد.",
      )
    )
      return;
    setReindexing(true);
    setReindexMessage(null);
    setReindexProgress(0);
    try {
      const res = await fetch("/api/documents/reindex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReindexMessage(data.error ?? "خطا در شروع بازسازی شاخص");
        setReindexing(false);
        setReindexProgress(null);
        return;
      }
      await pollJob(data.jobId, 0);
    } catch {
      setReindexMessage("خطا در ارتباط با سرور");
      setReindexing(false);
    }
  };

  const pollJob = async (jobId: string, attempts: number) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) throw new Error("job status unavailable");
      const job = await res.json();
      if (typeof job.progress === "number") setReindexProgress(job.progress);
      if (job.status === "COMPLETED") {
        const r = job.result ?? {};
        setReindexMessage(
          r.chunks != null
            ? `شاخص با موفقیت بازسازی شد: ${r.chunks} قطعه (${r.reembedded ?? 0} قطعه بردار معنایی تازه) از ${r.sources ?? 0} منبع`
            : "شاخص با موفقیت بازسازی شد",
        );
        fetchDocs();
      } else if (job.status === "FAILED") {
        setReindexMessage(job.error ?? "بازسازی شاخص با خطا مواجه شد");
      } else if (attempts > 1200) {
        setReindexMessage("بازسازی شاخص در حال انجام است؛ برای دیدن نتیجه این صفحه را دوباره بارگیری کنید.");
        return;
      } else {
        setTimeout(() => pollJob(jobId, attempts + 1), 3000);
        return;
      }
    } catch {
      setReindexMessage("بررسی وضعیت بازسازی ممکن نشد.");
    } finally {
      setReindexing(false);
      setReindexProgress(null);
    }
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const statusBadge = (doc: Doc) => {
    switch (doc.status?.toLowerCase()) {
      case "completed":
        return <Badge variant="success">آماده</Badge>;
      case "failed":
        return <Badge variant="error">خطا</Badge>;
      default:
        if (PROCESSING_STATUSES.has(doc.status?.toLowerCase() ?? "")) {
          return <Badge variant="warning">در حال پردازش</Badge>;
        }
        return <Badge variant="secondary">{doc.status || "نامشخص"}</Badge>;
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="اسناد" />

      <div className="flex-1 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">اسناد سازمانی</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="gap-2"
              onClick={handleReindex}
              loading={reindexing}
              disabled={reindexing}
              title="ایندکس فارسی و بردارهای معنایی همه اسناد را از نو می‌سازد"
            >
              <RefreshCw size={16} className={reindexing ? "animate-spin" : ""} />
              {reindexing ? "در حال بازسازی شاخص..." : "بازسازی شاخص جست‌وجو"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".txt,.md,.csv,.json,.pdf,.docx,.xlsx,.pptx,.jpg,.png"
              onChange={handleUpload}
              disabled={uploading}
            />
            <Button className="gap-2" onClick={() => fileRef.current?.click()} loading={uploading} disabled={uploading}>
              <Upload size={18} />
              بارگذاری فایل
            </Button>
          </div>
        </div>

        {reindexing && reindexProgress !== null && (
          <Card className="p-4 mb-4">
            <div className="flex items-center justify-between text-sm text-gray-300 mb-2">
              <span>بازسازی شاخص جست‌وجو در حال انجام است...</span>
              <span>{reindexProgress}%</span>
            </div>
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-500 rounded-full"
                style={{ width: `${reindexProgress}%` }}
              />
            </div>
          </Card>
        )}
        {!reindexing && reindexMessage && (
          <Card className="p-3 mb-4 text-sm text-gray-300">{reindexMessage}</Card>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-400">در حال بارگذاری...</div>
        ) : docs.length === 0 ? (
          <EmptyState
            icon={<FolderOpen size={40} />}
            title="هنوز سندی بارگذاری نشده"
            description="اسناد سازمانی را بارگذاری کنید تا دستیار هوشمند بتواند از آنها استفاده کند"
            action={{ label: "بارگذاری فایل", onClick: () => fileRef.current?.click() }}
          />
        ) : (
          <div className="space-y-3">
            {docs.map((doc) => {
              const processing = PROCESSING_STATUSES.has(doc.status?.toLowerCase() ?? "");
              return (
                <Card key={doc.id} className="p-4 flex items-center gap-4 hover:border-emerald-500/30 transition-all">
                  <div className="p-2 rounded-lg bg-blue-500/20">
                    <FileText size={20} className="text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{doc.title}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                      <span>{doc.fileName}</span>
                      <span>{formatSize(doc.fileSize)}</span>
                      {doc.pageCount != null && doc.pageCount > 0 && (
                        <span>{doc.pageCount} صفحه</span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {getRelativeTime(doc.createdAt)}
                      </span>
                    </div>
                    {doc.status?.toLowerCase() === "failed" && doc.errorMessage && (
                      <p className="text-red-400 text-xs mt-1">{doc.errorMessage}</p>
                    )}
                  </div>
                  {statusBadge(doc)}
                  <Button variant="ghost" size="icon" className="text-gray-400 hover:text-red-400" onClick={() => handleDelete(doc.id)}>
                    <Trash2 size={16} />
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
