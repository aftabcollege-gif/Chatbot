"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { formatFileSize } from "@/lib/utils";
import { timeAgo } from "@/lib/persian-date";

interface Document {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  fileSize: number | null;
  status: string;
  ocrUsed: boolean | null;
  pageCount: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DocumentPage {
  items: Document[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

const PAGE_SIZE = 50;

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending: { label: "در صف پردازش", className: "bg-slate-700 text-slate-300" },
  processing: { label: "در حال پردازش", className: "bg-blue-900/50 text-blue-300" },
  completed: { label: "آماده", className: "bg-emerald-900/50 text-emerald-300" },
  failed: { label: "خطا", className: "bg-red-900/50 text-red-300" },
};

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "همه" },
  { value: "completed", label: "آماده" },
  { value: "pending", label: "در صف" },
  { value: "processing", label: "در حال پردازش" },
  { value: "failed", label: "خطا" },
];

function extensionOf(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : "";
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilterState] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Filter changes always start from the first page.
  const setStatusFilter = (value: string) => {
    setStatusFilterState(value);
    setOffset(0);
  };
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounce the search box so we do not hit the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // Pure fetcher (no state updates) so the effect below owns all setState
  // calls and can ignore responses that arrive after it was cleaned up.
  const fetchDocumentPage = useCallback(async (): Promise<DocumentPage | null> => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (statusFilter) params.set("status", statusFilter);
    if (debouncedQuery) params.set("q", debouncedQuery);
    try {
      const res = await fetch(`/api/documents?${params.toString()}`);
      if (!res.ok) return null;
      return (await res.json()) as DocumentPage;
    } catch {
      return null; // transient error — the next poll retries
    }
  }, [offset, statusFilter, debouncedQuery]);

  // Manual refresh trigger (after uploads).
  const [refreshTick, setRefreshTick] = useState(0);

  // Load + poll. Polls quickly while something on this page is still being
  // processed, slowly otherwise (keeps idle load negligible even with many
  // open browser tabs).
  const hasActive = documents.some((d) => d.status === "pending" || d.status === "processing");
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const data = await fetchDocumentPage();
      if (cancelled) return;
      if (data) {
        setDocuments(data.items);
        setTotal(data.total);
      }
      setLoading(false);
    };
    void run();
    const interval = setInterval(() => void run(), hasActive ? 4000 : 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fetchDocumentPage, hasActive, refreshTick]);

  // Upload one file; returns an error message or null on success.
  const uploadOne = async (file: File, title: string): Promise<string | null> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: formData });
      const data = (await res.json()) as Document & { error?: string };
      if (!res.ok) return `${file.name}: ${data.error ?? "خطا در بارگذاری فایل"}`;
      return null;
    } catch {
      return `${file.name}: خطا در اتصال به سرور`;
    }
  };

  // Multi-file upload with a small client-side concurrency (the server-side
  // ingestion worker picks jobs up automatically — no manual trigger needed).
  const UPLOAD_CONCURRENCY = 3;
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setUploadError("");
    setUploading(true);
    setUploadProgress({ done: 0, total: files.length, failed: 0 });

    const errors: string[] = [];
    let next = 0;
    const runSlot = async () => {
      while (next < files.length) {
        const file = files[next++];
        // A custom title only makes sense for a single file.
        const title = files.length === 1 && uploadTitle ? uploadTitle : file.name;
        const err = await uploadOne(file, title);
        if (err) errors.push(err);
        setUploadProgress((p) => (p ? { ...p, done: p.done + 1, failed: errors.length } : p));
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, runSlot));

    if (errors.length > 0) {
      const shown = errors.slice(0, 5).join(" — ");
      setUploadError(errors.length > 5 ? `${shown} … و ${errors.length - 5} خطای دیگر` : shown);
    }
    setUploadTitle("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    setUploading(false);
    setTimeout(() => setUploadProgress(null), 4000);
    // Show the new uploads at the top of the first page.
    setOffset(0);
    setRefreshTick((t) => t + 1);
  };

  const getFileIcon = (fileType: string) => {
    const icons: Record<string, string> = {
      pdf: "📕",
      docx: "📘", doc: "📘", odt: "📘", rtf: "📘",
      xlsx: "📗", xls: "📗", csv: "📗",
      pptx: "📙", ppt: "📙",
      txt: "📝", md: "📝",
      jpg: "🖼️", jpeg: "🖼️", png: "🖼️", tiff: "🖼️",
      zip: "📦",
    };
    return icons[fileType] ?? "📄";
  };

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="h-full flex flex-col p-6 overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">مدیریت اسناد</h1>
          <p className="text-slate-400 text-sm mt-1">
            بارگذاری اسناد سازمانی برای جستجو و RAG
          </p>
        </div>
      </div>

      {/* Upload section */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-5 mb-6">
        <h2 className="text-white font-medium mb-4">بارگذاری سند جدید</h2>
        <div className="space-y-3">
          <input
            type="text"
            value={uploadTitle}
            onChange={(e) => setUploadTitle(e.target.value)}
            placeholder="عنوان سند (اختیاری — پیش‌فرض: نام فایل)"
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500"
          />
          <div className="flex items-center gap-3">
            <label className="flex-1 cursor-pointer">
              <div className="border-2 border-dashed border-slate-600 hover:border-blue-500 rounded-lg px-4 py-6 text-center transition-colors">
                {uploading ? (
                  <div className="flex items-center justify-center gap-2 text-slate-400 text-sm">
                    <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    {uploadProgress && uploadProgress.total > 1
                      ? `در حال بارگذاری ${uploadProgress.done} از ${uploadProgress.total} فایل…`
                      : "در حال بارگذاری..."}
                  </div>
                ) : (
                  <>
                    <p className="text-slate-400 text-sm">برای انتخاب یک یا چند فایل کلیک کنید</p>
                    <p className="text-slate-600 text-xs mt-1">
                      PDF, DOCX, XLSX, PPTX, TXT, MD, CSV, JPG, PNG, ZIP — حداکثر 50MB برای هر فایل
                    </p>
                    <p className="text-slate-600 text-xs mt-1">
                      برای پوشه‌های بزرگ (هزاران فایل) از «واردکردن پوشه» در پنل مدیریت یا دستور <code dir="ltr">npm run import</code> استفاده کنید.
                    </p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.md,.csv,.json,.xml,.html,.jpg,.jpeg,.png,.tiff,.zip"
                onChange={handleFileUpload}
                disabled={uploading}
              />
            </label>
          </div>
          {uploadProgress && !uploading && uploadProgress.total > 1 && (
            <p className="text-emerald-400 text-sm bg-emerald-900/20 px-3 py-2 rounded-lg">
              {uploadProgress.total - uploadProgress.failed} فایل در صف پردازش قرار گرفت
              {uploadProgress.failed > 0 ? ` — ${uploadProgress.failed} فایل ناموفق` : ""}.
            </p>
          )}
          {uploadError && (
            <p className="text-red-400 text-sm bg-red-900/20 px-3 py-2 rounded-lg">
              {uploadError}
            </p>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="جستجو در عنوان یا نام فایل…"
          className="flex-1 min-w-56 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500"
        />
        <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                statusFilter === f.value ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-slate-500 text-xs">
          {total.toLocaleString("fa-IR")} سند
        </span>
      </div>

      {/* Documents list */}
      <div className="flex-1">
        {loading && documents.length === 0 ? (
          <div className="text-center text-slate-500 py-12">بارگذاری...</div>
        ) : documents.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">📄</p>
            <p className="text-slate-400">
              {debouncedQuery || statusFilter ? "سندی با این مشخصات یافت نشد" : "هنوز سندی بارگذاری نشده است"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => {
              const status = STATUS_LABELS[doc.status] ?? { label: doc.status, className: "bg-slate-700 text-slate-300" };
              const ext = extensionOf(doc.fileName);
              return (
                <div
                  key={doc.id}
                  className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex items-center gap-4"
                >
                  <div className="text-3xl flex-shrink-0">{getFileIcon(ext)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-white font-medium truncate text-sm">{doc.title}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${status.className}`}>
                        {status.label}
                      </span>
                      {doc.ocrUsed && (
                        <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0 bg-amber-900/40 text-amber-300">OCR</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-slate-500 text-xs">
                      <span className="truncate" dir="ltr">{doc.fileName}</span>
                      {doc.fileSize ? <span>{formatFileSize(doc.fileSize)}</span> : null}
                      {doc.pageCount ? <span>{doc.pageCount} صفحه</span> : null}
                      <span>{timeAgo(doc.createdAt)}</span>
                    </div>
                    {doc.status === "processing" && (
                      <div className="mt-2 h-1 bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full w-1/2 bg-blue-500 rounded-full animate-pulse" />
                      </div>
                    )}
                    {doc.status === "failed" && doc.errorMessage && (
                      <p className="text-red-400 text-xs mt-1">{doc.errorMessage}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-700 text-sm">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40 hover:border-blue-500"
          >
            قبلی
          </button>
          <span className="text-slate-500 text-xs">
            {pageStart.toLocaleString("fa-IR")}–{pageEnd.toLocaleString("fa-IR")} از {total.toLocaleString("fa-IR")}
          </span>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40 hover:border-blue-500"
          >
            بعدی
          </button>
        </div>
      )}
    </div>
  );
}
