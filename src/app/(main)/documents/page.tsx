"use client";

import { useState, useEffect, useRef } from "react";
import { formatFileSize } from "@/lib/utils";
import { timeAgo } from "@/lib/persian-date";

interface Document {
  id: string;
  title: string;
  originalFilename: string;
  fileType: string;
  fileSizeBytes: number | null;
  status: string;
  processingProgress: number | null;
  processingError: string | null;
  chunkCount: number | null;
  createdAt: string;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  UPLOADED: { label: "بارگذاری‌شده", className: "status-queued" },
  QUEUED: { label: "در صف پردازش", className: "status-queued" },
  PROCESSING: { label: "در حال پردازش", className: "status-processing" },
  OCR: { label: "در حال OCR", className: "status-processing" },
  CHUNKING: { label: "تقسیم‌بندی", className: "status-processing" },
  EMBEDDING: { label: "Embedding", className: "status-processing" },
  INDEXING: { label: "ایندکس‌گذاری", className: "status-processing" },
  READY: { label: "آماده", className: "status-ready" },
  FAILED: { label: "خطا", className: "status-failed" },
  CANCELLED: { label: "لغو شده", className: "status-archived" },
  ARCHIVED: { label: "آرشیو شده", className: "status-archived" },
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadDocuments();
    // Poll for status updates
    const interval = setInterval(loadDocuments, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadDocuments = async () => {
    try {
      const res = await fetch("/api/documents");
      if (res.ok) {
        const data = await res.json() as Document[];
        setDocuments(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError("");
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", uploadTitle || file.name);

    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });

      const data = await res.json() as Document & { error?: string };

      if (res.ok) {
        setDocuments((prev) => [data, ...prev]);
        setUploadTitle("");
        if (fileInputRef.current) fileInputRef.current.value = "";
        // Trigger processing
        await triggerProcessing();
      } else {
        setUploadError(data.error ?? "خطا در بارگذاری فایل");
      }
    } catch {
      setUploadError("خطا در اتصال به سرور");
    } finally {
      setUploading(false);
    }
  };

  const triggerProcessing = async () => {
    // Trigger the job processor
    try {
      await fetch("/api/jobs/process", {
        method: "POST",
        headers: { "x-job-secret": "internal-job-secret" },
      });
    } catch {
      // Non-critical
    }
  };

  const getFileIcon = (fileType: string) => {
    const icons: Record<string, string> = {
      pdf: "📕",
      docx: "📘", doc: "📘",
      xlsx: "📗", xls: "📗", csv: "📗",
      pptx: "📙", ppt: "📙",
      txt: "📝", md: "📝",
      jpg: "🖼️", jpeg: "🖼️", png: "🖼️",
      zip: "📦",
    };
    return icons[fileType?.toLowerCase()] ?? "📄";
  };

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
                    در حال بارگذاری...
                  </div>
                ) : (
                  <>
                    <p className="text-slate-400 text-sm">برای انتخاب فایل کلیک کنید</p>
                    <p className="text-slate-600 text-xs mt-1">
                      PDF, DOCX, XLSX, PPTX, TXT, MD, CSV, JPG, PNG, ZIP — حداکثر 50MB
                    </p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.md,.csv,.json,.xml,.html,.jpg,.jpeg,.png,.tiff,.zip"
                onChange={handleFileUpload}
                disabled={uploading}
              />
            </label>
          </div>
          {uploadError && (
            <p className="text-red-400 text-sm bg-red-900/20 px-3 py-2 rounded-lg">
              {uploadError}
            </p>
          )}
        </div>
      </div>

      {/* Documents list */}
      <div className="flex-1">
        {loading ? (
          <div className="text-center text-slate-500 py-12">بارگذاری...</div>
        ) : documents.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">📄</p>
            <p className="text-slate-400">هنوز سندی بارگذاری نشده است</p>
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => {
              const status = STATUS_LABELS[doc.status] ?? { label: doc.status, className: "status-draft" };
              return (
                <div
                  key={doc.id}
                  className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex items-center gap-4"
                >
                  <div className="text-3xl flex-shrink-0">
                    {getFileIcon(doc.fileType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-white font-medium truncate text-sm">{doc.title}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${status.className}`}>
                        {status.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-slate-500 text-xs">
                      <span>{doc.originalFilename}</span>
                      {doc.fileSizeBytes && <span>{formatFileSize(doc.fileSizeBytes)}</span>}
                      {doc.chunkCount !== null && doc.chunkCount > 0 && (
                        <span>{doc.chunkCount} قطعه</span>
                      )}
                      <span>{timeAgo(doc.createdAt)}</span>
                    </div>
                    {/* Progress bar for processing */}
                    {["PROCESSING", "OCR", "CHUNKING", "EMBEDDING", "INDEXING"].includes(doc.status) && (
                      <div className="mt-2 h-1 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 transition-all duration-500 rounded-full"
                          style={{ width: `${doc.processingProgress ?? 0}%` }}
                        />
                      </div>
                    )}
                    {doc.status === "FAILED" && doc.processingError && (
                      <p className="text-red-400 text-xs mt-1">{doc.processingError}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
