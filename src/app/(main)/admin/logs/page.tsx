"use client";

import React, { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Search,
  Eye,
  Upload,
  LogIn,
  LogOut,
  Trash2,
  Edit3,
  Shield,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatJalaaliDateTime } from "@/lib/persian-date";

interface AuditLog {
  id: string;
  eventCode: string;
  actorName: string | null;
  resourceType: string | null;
  resourceName: string | null;
  ipAddress: string | null;
  outcome: string | null;
  createdAt: string;
}

const eventConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  LOGIN: { icon: LogIn, color: "text-emerald-400", label: "ورود کرد" },
  FAILED_LOGIN: { icon: AlertTriangle, color: "text-red-400", label: "تلاش ورود ناموفق" },
  LOGOUT: { icon: LogOut, color: "text-gray-400", label: "خارج شد" },
  DOCUMENT_UPLOAD: { icon: Upload, color: "text-purple-400", label: "بارگذاری کرد" },
  DOCUMENT_VIEW: { icon: Eye, color: "text-blue-400", label: "مشاهده کرد" },
  DOCUMENT_DELETE: { icon: Trash2, color: "text-red-400", label: "حذف کرد" },
  USER_CREATE: { icon: Edit3, color: "text-yellow-400", label: "ایجاد کاربر" },
  USER_UPDATE: { icon: Edit3, color: "text-yellow-400", label: "ویرایش کاربر" },
  USER_DELETE: { icon: Trash2, color: "text-red-400", label: "حذف کاربر" },
  ROLE_CREATE: { icon: Shield, color: "text-orange-400", label: "ایجاد نقش" },
  ROLE_UPDATE: { icon: Shield, color: "text-orange-400", label: "ویرایش نقش" },
  ROLE_DELETE: { icon: Shield, color: "text-orange-400", label: "حذف نقش" },
  KNOWLEDGE_PUBLISH: { icon: FileText, color: "text-emerald-400", label: "انتشار دانش" },
  EXPERIENCE_PUBLISH: { icon: FileText, color: "text-emerald-400", label: "انتشار تجربه" },
  SETUP_COMPLETE: { icon: Shield, color: "text-emerald-400", label: "راه‌اندازی سیستم" },
};

export default function LogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/audit?limit=100", { credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "خطا در دریافت لاگ‌ها");
      }
      const data = (await res.json()) as AuditLog[];
      setLogs(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در ارتباط با سرور");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const filteredLogs = logs.filter(
    (log) =>
      (log.actorName ?? "").includes(searchQuery) ||
      (log.resourceName ?? "").includes(searchQuery) ||
      log.eventCode.includes(searchQuery.toUpperCase())
  );

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="لاگ فعالیت" showModelStatus={false} />

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
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="جستجو..."
                className="pl-4 pr-10 py-2 bg-[#17211D] border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 w-64"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Logs List */}
        <Card>
          <div className="divide-y divide-white/5">
            {loading && <div className="p-6 text-center text-gray-500">در حال بارگذاری...</div>}
            {!loading && filteredLogs.length === 0 && (
              <div className="p-6 text-center text-gray-500">رویدادی یافت نشد</div>
            )}
            {filteredLogs.map((log) => {
              const config = eventConfig[log.eventCode] || {
                icon: FileText,
                color: "text-gray-400",
                label: log.eventCode,
              };
              const Icon = config.icon;

              return (
                <div
                  key={log.id}
                  className="flex items-center gap-4 p-4 hover:bg-white/5 transition-colors"
                >
                  <div className={cn("p-2 rounded-lg bg-white/5", config.color)}>
                    <Icon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white">
                      کاربر «<span className="text-emerald-400">{log.actorName ?? "ناشناس"}</span>»
                      {log.resourceName && (
                        <>
                          {" "}
                          {config.label}{" "}
                          «<span className="text-blue-400">{log.resourceName}</span>»
                        </>
                      )}
                      {!log.resourceName && ` ${config.label}`}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span>{formatJalaaliDateTime(log.createdAt)}</span>
                      <span>•</span>
                      <span>IP: {log.ipAddress ?? "—"}</span>
                    </div>
                  </div>
                  {log.outcome === "FAILURE" && (
                    <Badge variant="warning">
                      <AlertTriangle size={12} className="ml-1" />
                      ناموفق
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
