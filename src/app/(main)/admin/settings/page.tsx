"use client";

import React, { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Settings,
  Save,
  Cpu,
  Database,
  Shield,
  Globe,
  Clock,
  FileText,
  Brain,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingGroup {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  settings: Setting[];
}

interface Setting {
  key: string;
  label: string;
  value: string | number | boolean;
  type: "text" | "number" | "toggle" | "select";
  options?: { value: string; label: string }[];
  description?: string;
}

const settingGroups: SettingGroup[] = [
  {
    id: "llm",
    title: "مدل زبانی (LLM)",
    description: "تنظیمات مدل زبانی محلی",
    icon: Cpu,
    settings: [
      {
        key: "LLM_MODEL_NAME",
        label: "نام مدل",
        value: "qwen2.5-14b-instruct-q4_k_m",
        type: "text",
      },
      {
        key: "LLM_CONTEXT_SIZE",
        label: "اندازه Context",
        value: 8192,
        type: "number",
      },
      {
        key: "LLM_TEMPERATURE",
        label: "Temperature",
        value: 0.1,
        type: "number",
      },
      {
        key: "LLM_MAX_TOKENS",
        label: "حداکثر توکن خروجی",
        value: 2048,
        type: "number",
      },
    ],
  },
  {
    id: "rag",
    title: "RAG",
    description: "تنظیمات بازیابی و تولید",
    icon: Brain,
    settings: [
      {
        key: "CONTEXT_MAX_TOKENS",
        label: "حداکثر توکن Context",
        value: 4096,
        type: "number",
      },
      {
        key: "RETRIEVAL_TOP_K",
        label: "تعداد نتایج اولیه",
        value: 20,
        type: "number",
      },
      {
        key: "RERANKER_TOP_K",
        label: "تعداد نتایج بعد از Rerank",
        value: 5,
        type: "number",
      },
      {
        key: "CHUNK_SIZE",
        label: "اندازه Chunk",
        value: 512,
        type: "number",
      },
    ],
  },
  {
    id: "security",
    title: "امنیت",
    description: "تنظیمات امنیتی سیستم",
    icon: Shield,
    settings: [
      {
        key: "OFFLINE_MODE",
        label: "حالت آفلاین",
        value: true,
        type: "toggle",
        description: "قطع کامل دسترسی به اینترنت",
      },
      {
        key: "JWT_EXPIRY_MINUTES",
        label: "مدت اعتبار توکن (دقیقه)",
        value: 60,
        type: "number",
      },
      {
        key: "MAX_FILE_SIZE_MB",
        label: "حداکثر حجم فایل (MB)",
        value: 100,
        type: "number",
      },
    ],
  },
];

export default function SettingsPage() {
  const [activeGroup, setActiveGroup] = useState("llm");
  const [settings, setSettings] = useState<Record<string, string | number | boolean>>(() => {
    const initial: Record<string, string | number | boolean> = {};
    settingGroups.forEach((group) => {
      group.settings.forEach((setting) => {
        initial[setting.key] = setting.value;
      });
    });
    return initial;
  });
  const [hasChanges, setHasChanges] = useState(false);

  const handleSettingChange = (key: string, value: string | number | boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    // Save settings to backend
    console.log("Saving settings:", settings);
    setHasChanges(false);
  };

  const currentGroup = settingGroups.find((g) => g.id === activeGroup);

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="تنظیمات سیستم" showModelStatus={false} />

      <div className="flex-1 p-6">
        {/* Warning Banner */}
        <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl flex items-center gap-3">
          <AlertTriangle size={20} className="text-yellow-400 shrink-0" />
          <div>
            <p className="text-yellow-300 text-sm font-medium">
              تغییر تنظیمات ممکن است نیاز به راه‌اندازی مجدد سرویس‌ها داشته باشد
            </p>
          </div>
        </div>

        <div className="flex gap-6">
          {/* Sidebar */}
          <div className="w-64 shrink-0">
            <nav className="space-y-1">
              {settingGroups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => setActiveGroup(group.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-right",
                    activeGroup === group.id
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "text-gray-400 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <group.icon size={20} />
                  <span>{group.title}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1">
            {currentGroup && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <currentGroup.icon size={20} className="text-emerald-400" />
                    {currentGroup.title}
                  </CardTitle>
                  <CardDescription>{currentGroup.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {currentGroup.settings.map((setting) => (
                    <div key={setting.key} className="flex items-center justify-between">
                      <div>
                        <label className="text-white font-medium">
                          {setting.label}
                        </label>
                        {setting.description && (
                          <p className="text-sm text-gray-500">{setting.description}</p>
                        )}
                        <code className="text-xs text-gray-600 bg-white/5 px-1 rounded">
                          {setting.key}
                        </code>
                      </div>
                      <div className="w-48">
                        {setting.type === "toggle" ? (
                          <button
                            onClick={() =>
                              handleSettingChange(setting.key, !settings[setting.key])
                            }
                            className={cn(
                              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                              settings[setting.key]
                                ? "bg-emerald-500"
                                : "bg-gray-600"
                            )}
                          >
                            <span
                              className={cn(
                                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                                settings[setting.key] ? "translate-x-1" : "translate-x-6"
                              )}
                            />
                          </button>
                        ) : setting.type === "number" ? (
                          <input
                            type="number"
                            value={settings[setting.key] as number}
                            onChange={(e) =>
                              handleSettingChange(setting.key, parseFloat(e.target.value))
                            }
                            className="w-full px-3 py-2 bg-[#17211D] border border-white/10 rounded-lg text-white focus:outline-none focus:border-emerald-500/50"
                          />
                        ) : (
                          <input
                            type="text"
                            value={settings[setting.key] as string}
                            onChange={(e) =>
                              handleSettingChange(setting.key, e.target.value)
                            }
                            className="w-full px-3 py-2 bg-[#17211D] border border-white/10 rounded-lg text-white focus:outline-none focus:border-emerald-500/50"
                          />
                        )}
                      </div>
                    </div>
                  ))}

                  {hasChanges && (
                    <div className="pt-6 border-t border-white/10 flex justify-end">
                      <Button onClick={handleSave} className="gap-2">
                        <Save size={16} />
                        ذخیره تغییرات
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
