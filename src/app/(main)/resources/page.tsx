"use client";

import React, { useState, useCallback } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  FolderOpen,
  Upload,
  FolderPlus,
  Search,
  Grid,
  List,
  FileText,
  FileSpreadsheet,
  FileImage,
  File,
  MoreVertical,
  Download,
  Eye,
  Trash2,
  Globe,
  Lock,
  Users,
  X,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/lib/utils";
import { getRelativeTime } from "@/lib/persian-date";

interface Document {
  id: string;
  title: string;
  originalFilename: string;
  fileType: string;
  fileSizeBytes: number;
  status: "UPLOADED" | "PROCESSING" | "READY" | "FAILED";
  processingProgress: number;
  visibility: "private" | "department" | "public";
  createdAt: string;
}

const mockDocuments: Document[] = [
  {
    id: "1",
    title: "دستورالعمل نگهداری تجهیزات",
    originalFilename: "maintenance-sop.pdf",
    fileType: "pdf",
    fileSizeBytes: 2456789,
    status: "READY",
    processingProgress: 100,
    visibility: "public",
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "2",
    title: "گزارش ماهانه تولید",
    originalFilename: "monthly-report.xlsx",
    fileType: "xlsx",
    fileSizeBytes: 1234567,
    status: "PROCESSING",
    processingProgress: 65,
    visibility: "department",
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "3",
    title: "آموزش ایمنی کارگاه",
    originalFilename: "safety-training.pptx",
    fileType: "pptx",
    fileSizeBytes: 5678901,
    status: "READY",
    processingProgress: 100,
    visibility: "private",
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

const fileIcons: Record<string, React.ReactNode> = {
  pdf: <FileText size={24} className="text-red-400" />,
  docx: <FileText size={24} className="text-blue-400" />,
  xlsx: <FileSpreadsheet size={24} className="text-green-400" />,
  pptx: <FileImage size={24} className="text-orange-400" />,
  default: <File size={24} className="text-gray-400" />,
};

const visibilityIcons = {
  public: <Globe size={14} className="text-emerald-400" />,
  department: <Users size={14} className="text-blue-400" />,
  private: <Lock size={14} className="text-yellow-400" />,
};

export default function ResourcesPage() {
  const [documents, setDocuments] = useState<Document[]>(mockDocuments);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showUpload, setShowUpload] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<{ name: string; progress: number }[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  }, []);

  const handleFiles = (files: File[]) => {
    const newUploads = files.map((f) => ({
      name: f.name,
      progress: 0,
    }));
    setUploadingFiles((prev) => [...prev, ...newUploads]);

    // Simulate upload progress
    files.forEach((file, index) => {
      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress >= 100) {
          progress = 100;
          clearInterval(interval);
          setTimeout(() => {
            setUploadingFiles((prev) => prev.filter((u) => u.name !== file.name));
            // Add to documents
            setDocuments((prev) => [
              {
                id: `new-${Date.now()}-${index}`,
                title: file.name,
                originalFilename: file.name,
                fileType: file.name.split(".").pop() || "unknown",
                fileSizeBytes: file.size,
                status: "PROCESSING",
                processingProgress: 0,
                visibility: "private",
                createdAt: new Date().toISOString(),
              },
              ...prev,
            ]);
          }, 500);
        }
        setUploadingFiles((prev) =>
          prev.map((u) =>
            u.name === file.name ? { ...u, progress: Math.min(100, progress) } : u
          )
        );
      }, 200);
    });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="منابع" />

      <div className="flex-1 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search
                size={18}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="جستجو در فایل‌ها..."
                className="pl-4 pr-10 py-2 bg-[#17211D] border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 w-64"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-[#17211D] rounded-lg p-1">
              <button
                onClick={() => setViewMode("grid")}
                className={cn(
                  "p-2 rounded-md transition-colors",
                  viewMode === "grid"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "text-gray-400 hover:text-white"
                )}
              >
                <Grid size={18} />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "p-2 rounded-md transition-colors",
                  viewMode === "list"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "text-gray-400 hover:text-white"
                )}
              >
                <List size={18} />
              </button>
            </div>
            <Button variant="outline" className="gap-2">
              <FolderPlus size={18} />
              پوشه جدید
            </Button>
            <Button className="gap-2" onClick={() => setShowUpload(true)}>
              <Upload size={18} />
              بارگذاری
            </Button>
          </div>
        </div>

        {/* Upload Drop Zone */}
        {(showUpload || isDragging) && (
          <div
            className={cn(
              "mb-6 p-8 border-2 border-dashed rounded-2xl transition-all text-center",
              isDragging
                ? "border-emerald-500 bg-emerald-500/10"
                : "border-white/20 bg-[#17211D]"
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <Upload
              size={40}
              className={cn(
                "mx-auto mb-4",
                isDragging ? "text-emerald-400" : "text-gray-400"
              )}
            />
            <p className="text-white font-medium mb-1">
              فایل‌ها را اینجا رها کنید
            </p>
            <p className="text-gray-500 text-sm mb-4">یا کلیک کنید</p>
            <p className="text-xs text-gray-600">
              PDF, DOCX, XLSX, PPTX, TXT, MD • حداکثر 100MB
            </p>
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                handleFiles(files);
              }}
            />
            {!isDragging && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowUpload(false)}
                className="mt-4"
              >
                <X size={16} className="ml-1" />
                بستن
              </Button>
            )}
          </div>
        )}

        {/* Uploading Files */}
        {uploadingFiles.length > 0 && (
          <div className="mb-6 space-y-2">
            {uploadingFiles.map((file) => (
              <div
                key={file.name}
                className="flex items-center gap-4 p-4 bg-[#17211D] rounded-xl"
              >
                <Loader2 size={20} className="text-emerald-400 animate-spin" />
                <div className="flex-1">
                  <p className="text-sm text-white mb-1">{file.name}</p>
                  <Progress value={file.progress} />
                </div>
                <span className="text-sm text-emerald-400">
                  {Math.round(file.progress)}%
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Documents Grid */}
        {documents.length === 0 ? (
          <EmptyState
            icon={<FolderOpen size={40} />}
            title="هنوز فایلی ندارید"
            description="فایل‌های خود را بارگذاری کنید تا در گفتگوها به عنوان منبع استفاده شوند"
            action={{
              label: "بارگذاری فایل",
              onClick: () => setShowUpload(true),
            }}
          />
        ) : (
          <div
            className={cn(
              viewMode === "grid"
                ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                : "space-y-2"
            )}
          >
            {documents.map((doc) => (
              <DocumentCard
                key={doc.id}
                document={doc}
                viewMode={viewMode}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DocumentCard({
  document,
  viewMode,
}: {
  document: Document;
  viewMode: "grid" | "list";
}) {
  const icon = fileIcons[document.fileType] || fileIcons.default;
  const visibilityIcon = visibilityIcons[document.visibility];

  if (viewMode === "list") {
    return (
      <div className="flex items-center gap-4 p-4 bg-[#17211D] rounded-xl border border-white/5 hover:border-emerald-500/30 transition-all group">
        <div className="shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <h4 className="text-white font-medium truncate">{document.title}</h4>
          <p className="text-xs text-gray-500">
            {formatFileSize(document.fileSizeBytes)} •{" "}
            {getRelativeTime(document.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {visibilityIcon}
          {document.status === "PROCESSING" ? (
            <Badge variant="warning">در حال پردازش</Badge>
          ) : document.status === "READY" ? (
            <Badge variant="success">آماده</Badge>
          ) : (
            <Badge variant="error">خطا</Badge>
          )}
        </div>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
          <Button variant="ghost" size="icon">
            <Eye size={16} />
          </Button>
          <Button variant="ghost" size="icon">
            <Download size={16} />
          </Button>
          <Button variant="ghost" size="icon" className="text-red-400">
            <Trash2 size={16} />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Card className="p-4 hover:border-emerald-500/30 transition-all group cursor-pointer">
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 bg-white/5 rounded-lg">{icon}</div>
        <div className="flex items-center gap-1">
          {visibilityIcon}
          <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-white/10 rounded">
            <MoreVertical size={16} className="text-gray-400" />
          </button>
        </div>
      </div>

      <h4 className="text-white font-medium mb-1 truncate">{document.title}</h4>
      <p className="text-xs text-gray-500 mb-3">
        {formatFileSize(document.fileSizeBytes)} •{" "}
        {getRelativeTime(document.createdAt)}
      </p>

      {document.status === "PROCESSING" ? (
        <div>
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
            <span>در حال پردازش</span>
            <span>{document.processingProgress}%</span>
          </div>
          <Progress value={document.processingProgress} />
        </div>
      ) : (
        <Badge
          variant={document.status === "READY" ? "success" : "error"}
        >
          {document.status === "READY" ? (
            <>
              <CheckCircle size={12} className="ml-1" />
              آماده
            </>
          ) : (
            "خطا"
          )}
        </Badge>
      )}
    </Card>
  );
}
