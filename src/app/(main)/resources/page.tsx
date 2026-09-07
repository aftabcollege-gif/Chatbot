"use client";

import React, { useState, useEffect, useRef } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { FolderOpen, Upload, FileText, Trash2, Clock } from "lucide-react";
import { getRelativeTime } from "@/lib/persian-date";

interface Doc {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  fileSize: number | null;
  status: string | null;
  errorMessage: string | null;
  createdAt: string;
}

function extensionOf(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx + 1).toUpperCase() : "";
}

export default function ResourcesPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [refreshTick, setRefreshTick] = useState(0);
  const fetchDocs = () => setRefreshTick((t) => t + 1);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      let items: Doc[] = [];
      try {
        const res = await fetch("/api/documents?limit=100");
        if (res.ok) items = ((await res.json()) as { items?: Doc[] }).items ?? [];
      } catch (error) {
        console.error("Error:", error);
      }
      if (cancelled) return;
      setDocs(items);
      setLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

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
    if (!confirm("آیا مطمئنید؟")) return;
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    fetchDocs();
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const statusBadge = (status: string | null) => {
    switch (status) {
      case "completed": return <Badge variant="success">آماده</Badge>;
      case "processing": return <Badge variant="warning">در حال پردازش</Badge>;
      case "pending": return <Badge variant="secondary">در صف</Badge>;
      case "failed": return <Badge variant="error">خطا</Badge>;
      default: return <Badge variant="secondary">{status || "نامشخص"}</Badge>;
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="منابع" />

      <div className="flex-1 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">اسناد سازمانی</h2>
          <div>
            <input ref={fileRef} type="file" className="hidden" accept=".txt,.md,.csv,.json,.pdf,.docx" onChange={handleUpload} />
            <Button className="gap-2" onClick={() => fileRef.current?.click()} loading={uploading}>
              <Upload size={18} />
              بارگذاری فایل
            </Button>
          </div>
        </div>

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
            {docs.map((doc) => (
              <Card key={doc.id} className="p-4 flex items-center gap-4 hover:border-emerald-500/30 transition-all">
                <div className="p-2 rounded-lg bg-blue-500/20">
                  <FileText size={20} className="text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium truncate">{doc.title}</p>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                    <span>{extensionOf(doc.fileName)}</span>
                    <span>{formatSize(doc.fileSize)}</span>
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {getRelativeTime(doc.createdAt)}
                    </span>
                  </div>
                </div>
                {statusBadge(doc.status)}
                <Button variant="ghost" size="icon" className="text-gray-400 hover:text-red-400" onClick={() => handleDelete(doc.id)}>
                  <Trash2 size={16} />
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
