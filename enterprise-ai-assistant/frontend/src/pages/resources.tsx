import { useEffect, useRef, useState } from "react";
import { Upload, FileText, FileSpreadsheet, Presentation, File as FileIcon, Download, Trash2, FolderPlus, Globe, Lock, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/shared/empty-state";
import { toast } from "@/components/ui/toast";
import { formatBytes, cn } from "@/lib/utils";
import { relativeTime, toPersianDigits } from "@/lib/persian";
import type { Document } from "@/types";

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "warning" | "success" | "destructive" }> = {
  UPLOADED: { label: "در صف", variant: "default" },
  EXTRACTING: { label: "استخراج", variant: "warning" },
  CHUNKING: { label: "تقطیع", variant: "warning" },
  EMBEDDING: { label: "ایمبدینگ", variant: "warning" },
  INDEXING: { label: "ایندکس", variant: "warning" },
  READY: { label: "آماده", variant: "success" },
  ERROR: { label: "خطا", variant: "destructive" },
};

function iconFor(type: string) {
  if (type === "pdf" || type === "docx" || type === "txt" || type === "md") return FileText;
  if (type === "xlsx" || type === "csv") return FileSpreadsheet;
  if (type === "pptx") return Presentation;
  return FileIcon;
}

function visIcon(v: string) {
  if (v === "public") return <Globe className="h-3.5 w-3.5 text-emerald-500" />;
  if (v === "department") return <Users className="h-3.5 w-3.5 text-primary" />;
  return <Lock className="h-3.5 w-3.5 text-muted-foreground" />;
}

export function ResourcesPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const res = await api.get("/resources/documents", { params: { search: search || undefined, limit: 100 } });
      setDocs(res.data.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));
      form.append("folder_id", "");
      await api.post("/resources/batch-upload", form);
      toast.success("بارگذاری شد — در حال پردازش...");
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "خطا در بارگذاری");
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("این سند حذف شود؟")) return;
    await api.delete(`/resources/documents/${id}`);
    setDocs((d) => d.filter((x) => x.id !== id));
  }

  async function publish(id: string) {
    await api.post(`/resources/documents/${id}/publish`);
    toast.success("سند منتشر شد.");
    load();
  }

  const ready = docs.filter((d) => d.status === "READY").length;

  return (
    <div className="h-full flex flex-col">
      <div className="h-14 border-b flex items-center justify-between px-6">
        <div>
          <h2 className="font-semibold">مدیریت منابع</h2>
          <p className="text-xs text-muted-foreground">{toPersianDigits(docs.length)} سند — {toPersianDigits(ready)} آماده جستجو</p>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="جستجوی سند..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={uploading}>
            <FolderPlus className="h-4 w-4" /> پوشه
          </Button>
          <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
            <Upload className="h-4 w-4" /> بارگذاری
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,.html,.xml"
            onChange={(e) => upload(e.target.files)}
          />
        </div>
      </div>

      <div
        className={cn(
          "flex-1 overflow-y-auto p-6 transition-colors",
          dragOver && "bg-primary/5",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          upload(e.dataTransfer.files);
        }}
      >
        {loading ? (
          <div className="text-center text-muted-foreground py-16">در حال بارگذاری...</div>
        ) : docs.length === 0 ? (
          <EmptyState
            icon={Upload}
            title="هنوز سندی بارگذاری نشده"
            description="فایل‌های PDF، Word، Excel، PowerPoint یا متنی را اینجا بکشید یا روی دکمه بارگذاری بزنید. تمام پردازش به‌صورت آفلاین انجام می‌شود."
            action={
              <Button onClick={() => inputRef.current?.click()}>
                <Upload className="h-4 w-4" /> بارگذاری فایل
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {docs.map((doc) => {
              const Icon = iconFor(doc.file_type);
              const st = STATUS_LABEL[doc.status] || STATUS_LABEL.UPLOADED;
              return (
                <Card key={doc.id} className="overflow-hidden group hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate" title={doc.title}>{doc.title}</div>
                        <div className="text-xs text-muted-foreground">{formatBytes(doc.file_size_bytes)} · {doc.file_type}</div>
                      </div>
                      {visIcon(doc.visibility)}
                    </div>

                    <div className="flex items-center justify-between mb-2">
                      <Badge variant={st.variant}>{st.label}</Badge>
                      <span className="text-xs text-muted-foreground">{relativeTime(doc.created_at)}</span>
                    </div>

                    {doc.status !== "READY" && doc.status !== "ERROR" && (
                      <Progress value={doc.processing_progress} className="h-1 mb-2" />
                    )}
                    {doc.status === "ERROR" && (
                      <p className="text-xs text-destructive mb-2 line-clamp-1">{doc.processing_error}</p>
                    )}

                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <a
                        href={`/api/resources/documents/${doc.id}/download`}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-accent flex-1 justify-center"
                      >
                        <Download className="h-3.5 w-3.5" /> دانلود
                      </a>
                      {doc.status === "READY" && doc.visibility !== "public" && (
                        <button
                          onClick={() => publish(doc.id)}
                          className="text-xs px-2 py-1 rounded hover:bg-accent text-primary"
                        >
                          انتشار
                        </button>
                      )}
                      <button
                        onClick={() => remove(doc.id)}
                        className="text-xs px-2 py-1 rounded hover:bg-destructive/10 text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
