"use client";

import React, { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Search,
  Filter,
  Download,
  User,
  Eye,
  Upload,
  LogIn,
  LogOut,
  Trash2,
  Edit3,
  Shield,
  AlertTriangle,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatJalaaliDateTime } from "@/lib/persian-date";

interface AuditLog {
  id: string;
  eventCode: string;
  actorName: string;
  resourceType: string;
  resourceName: string;
  ipAddress: string;
  createdAt: string;
}

const eventConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  "auth.login": { icon: LogIn, color: "text-emerald-400", label: "ورود" },
  "auth.logout": { icon: LogOut, color: "text-gray-400", label: "خروج" },
  "auth.login_failed": { icon: AlertTriangle, color: "text-red-400", label: "ورود ناموفق" },
  "document.view": { icon: Eye, color: "text-blue-400", label: "مشاهده" },
  "document.upload": { icon: Upload, color: "text-purple-400", label: "بارگذاری" },
  "document.delete": { icon: Trash2, color: "text-red-400", label: "حذف" },
  "user.update": { icon: Edit3, color: "text-yellow-400", label: "ویرایش کاربر" },
  "permission.change": { icon: Shield, color: "text-orange-400", label: "تغییر مجوز" },
};

const mockLogs: AuditLog[] = [
  {
    id: "1",
    eventCode: "document.view",
    actorName: "علی رضایی",
    resourceType: "document",
    resourceName: "SOP.pdf",
    ipAddress: "192.168.1.10",
    createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  },
  {
    id: "2",
    eventCode: "permission.change",
    actorName: "مدیر سیستم",
    resourceType: "folder",
    resourceName: "پوشه مالی",
    ipAddress: "192.168.1.1",
    createdAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
  },
  {
    id: "3",
    eventCode: "auth.login",
    actorName: "سارا احمدی",
    resourceType: "",
    resourceName: "",
    ipAddress: "192.168.1.25",
    createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  },
  {
    id: "4",
    eventCode: "auth.login_failed",
    actorName: "unknown",
    resourceType: "",
    resourceName: "",
    ipAddress: "192.168.1.99",
    createdAt: new Date(Date.now() - 22 * 60 * 1000).toISOString(),
  },
  {
    id: "5",
    eventCode: "document.upload",
    actorName: "محمد کریمی",
    resourceType: "document",
    resourceName: "Report-Q4.xlsx",
    ipAddress: "192.168.1.15",
    createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
  },
];

export default function LogsPage() {
  const [logs] = useState<AuditLog[]>(mockLogs);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredLogs = logs.filter(
    (log) =>
      log.actorName.includes(searchQuery) ||
      log.resourceName.includes(searchQuery)
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
            <Button variant="outline" className="gap-2">
              <Filter size={16} />
              نوع رویداد
            </Button>
            <Button variant="outline" className="gap-2">
              <User size={16} />
              کاربر
            </Button>
            <Button variant="outline" className="gap-2">
              <Calendar size={16} />
              تاریخ
            </Button>
          </div>
          <Button variant="outline" className="gap-2">
            <Download size={16} />
            دانلود CSV
          </Button>
        </div>

        {/* Logs List */}
        <Card>
          <div className="divide-y divide-white/5">
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
                      کاربر «<span className="text-emerald-400">{log.actorName}</span>»
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
                      <span>IP: {log.ipAddress}</span>
                    </div>
                  </div>
                  {log.eventCode === "auth.login_failed" && (
                    <Badge variant="warning">
                      <AlertTriangle size={12} className="ml-1" />
                      هشدار
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
