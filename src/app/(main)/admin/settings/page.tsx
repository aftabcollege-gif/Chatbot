"use client";

import React, { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Save,
  Cpu,
  Shield,
  Brain,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";

interface SystemStatus {
  ai: {
    llm: { available: boolean; name: string; isLocal: boolean };
    embedding: { available: boolean; name: string; isLocal: boolean; dimensions: number };
  };
  rag: { topK: number; minScore: number };
  env: {
    ollamaBaseUrl: string;
    llmModel: string;
    embedModel: string;
    embeddingDimensions: number;
    sessionDurationHours: number;
    maxFileSizeMb: number;
    allowedFileExtensions: string;
    offlineMode: boolean;
  };
}

export default function SettingsPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [topK, setTopK] = useState(8);
  const [minScore, setMinScore] = useState(0.1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/system", { credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "خطا در دریافت وضعیت سیستم");
      }
      const data = (await res.json()) as SystemStatus;
      setStatus(data);
      setTopK(data.rag.topK);
      setMinScore(data.rag.minScore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در ارتباط با سرور");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/system", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ topK, minScore }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "خطا در ذخیره تنظیمات");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در ارتباط با سرور");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="تنظیمات سیستم" showModelStatus={false} />

      <div className="flex-1 p-6 space-y-6">
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl flex items-center gap-3">
          <AlertTriangle size={20} className="text-yellow-400 shrink-0" />
          <p className="text-yellow-300 text-sm font-medium">
            پیکربندی مدل‌های محلی (LLM/Embedding) از طریق متغیرهای محیطی سرور
            انجام می‌شود و نیازمند راه‌اندازی مجدد سرویس است — این یک محدودیت
            امنیتی عمدی است تا هیچ مدلی بدون تأیید Checksum/مجوز جایگزین نشود.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            {error}
          </div>
        )}

        {loading && <p className="text-gray-500">در حال بارگذاری وضعیت واقعی سیستم...</p>}

        {status && (
          <>
            {/* AI Status — REAL, live-queried */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu size={20} className="text-emerald-400" />
                  وضعیت هوش مصنوعی محلی (زنده)
                </CardTitle>
                <CardDescription>
                  این مقادیر مستقیماً از بررسی زنده‌ی Ollama محلی به‌دست می‌آیند — هیچ داده‌ی ساختگی نیست.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-xl border border-white/10 bg-white/5">
                  <div>
                    <p className="text-white font-medium">مدل زبانی (LLM)</p>
                    <code className="text-xs text-gray-500">{status.ai.llm.name}</code>
                  </div>
                  {status.ai.llm.available ? (
                    <Badge variant="success" className="gap-1">
                      <CheckCircle2 size={12} /> در دسترس
                    </Badge>
                  ) : (
                    <Badge variant="error" className="gap-1">
                      <XCircle size={12} /> در دسترس نیست
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between p-4 rounded-xl border border-white/10 bg-white/5">
                  <div>
                    <p className="text-white font-medium">مدل Embedding</p>
                    <code className="text-xs text-gray-500">
                      {status.ai.embedding.name} ({status.ai.embedding.dimensions} بعد)
                    </code>
                  </div>
                  {status.ai.embedding.available ? (
                    <Badge variant="success" className="gap-1">
                      <CheckCircle2 size={12} /> در دسترس (معنایی واقعی)
                    </Badge>
                  ) : (
                    <Badge variant="warning" className="gap-1">
                      حالت واژگانی محلی (Fallback)
                    </Badge>
                  )}
                </div>
                {!status.ai.llm.available && (
                  <p className="text-xs text-gray-500">
                    برای فعال‌سازی مدل زبانی محلی، Ollama را روی همین سرور
                    نصب و مدل «{status.env.llmModel}» را pull کنید (بدون
                    اتصال به هیچ سرویس ابری). تا آن زمان، چت در حالت
                    «فقط بازیابی» با استناد مستقیم به منابع کار می‌کند.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* RAG tuning — REAL, persisted to system_settings table */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain size={20} className="text-emerald-400" />
                  تنظیمات بازیابی (RAG)
                </CardTitle>
                <CardDescription>این مقادیر واقعاً در پایگاه‌داده ذخیره و توسط موتور RAG استفاده می‌شوند.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-white font-medium">تعداد نتایج بازیابی (Top K)</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={topK}
                    onChange={(e) => setTopK(parseInt(e.target.value) || 1)}
                    className="w-32 px-3 py-2 bg-[#17211D] border border-white/10 rounded-lg text-white focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-white font-medium">حداقل امتیاز مرتبط بودن</label>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={minScore}
                    onChange={(e) => setMinScore(parseFloat(e.target.value) || 0)}
                    className="w-32 px-3 py-2 bg-[#17211D] border border-white/10 rounded-lg text-white focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div className="pt-4 border-t border-white/10 flex justify-end">
                  <Button onClick={() => void handleSave()} loading={saving} className="gap-2">
                    <Save size={16} />
                    ذخیره تغییرات
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Read-only env config */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield size={20} className="text-emerald-400" />
                  پیکربندی سطح سرویس (فقط خواندنی)
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">حالت آفلاین</p>
                  <p className="text-white">{status.env.offlineMode ? "فعال (بدون هیچ فراخوانی ابری)" : "غیرفعال"}</p>
                </div>
                <div>
                  <p className="text-gray-500">مدت اعتبار نشست</p>
                  <p className="text-white">{status.env.sessionDurationHours} ساعت</p>
                </div>
                <div>
                  <p className="text-gray-500">حداکثر حجم فایل</p>
                  <p className="text-white">{status.env.maxFileSizeMb} مگابایت</p>
                </div>
                <div>
                  <p className="text-gray-500">فرمت‌های مجاز</p>
                  <p className="text-white">{status.env.allowedFileExtensions}</p>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
