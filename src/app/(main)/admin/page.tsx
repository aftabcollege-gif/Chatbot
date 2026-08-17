"use client";

import React from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Users,
  FileText,
  MessageSquare,
  Brain,
  Activity,
  Database,
  Cpu,
  HardDrive,
  TrendingUp,
  ArrowUpRight,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { formatJalaaliDate } from "@/lib/persian-date";

const stats = [
  {
    title: "کاربران",
    value: "124",
    change: "+3 امروز",
    icon: Users,
    color: "text-blue-400 bg-blue-500/20",
  },
  {
    title: "اسناد",
    value: "8,432",
    change: "+12 امروز",
    icon: FileText,
    color: "text-purple-400 bg-purple-500/20",
  },
  {
    title: "گفتگوها",
    value: "1,203",
    change: "+89 امروز",
    icon: MessageSquare,
    color: "text-emerald-400 bg-emerald-500/20",
  },
  {
    title: "تجربیات",
    value: "234",
    change: "+5 امروز",
    icon: Brain,
    color: "text-orange-400 bg-orange-500/20",
  },
];

const systemHealth = [
  { name: "Database", status: "healthy", latency: "45ms", usage: "2.1GB" },
  { name: "LLM", status: "healthy", latency: "2.3s", usage: "8GB VRAM" },
  { name: "Embedding", status: "healthy", latency: "125ms", usage: "2GB RAM" },
  { name: "Storage", status: "healthy", latency: "-", usage: "12GB / 100GB" },
  { name: "Vector DB", status: "healthy", latency: "5ms", usage: "2.4M chunks" },
  { name: "OCR", status: "loading", latency: "-", usage: "-" },
];

const topResources = [
  { name: "SOP-Maintenance.pdf", views: 234, queries: 89 },
  { name: "HR-Policy.docx", views: 189, queries: 56 },
  { name: "Safety-Guide.pptx", views: 156, queries: 45 },
  { name: "تجربه تعمیر پمپ", views: 123, queries: 67 },
];

export default function AdminDashboardPage() {
  const today = formatJalaaliDate(new Date());

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="داشبورد مدیریتی" showModelStatus={false} />

      <div className="flex-1 p-6">
        {/* Date */}
        <p className="text-sm text-gray-400 mb-6">امروز {today}</p>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {stats.map((stat) => (
            <Card key={stat.title} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-400 mb-1">{stat.title}</p>
                  <p className="text-3xl font-bold text-white">{stat.value}</p>
                  <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                    <TrendingUp size={12} />
                    {stat.change}
                  </p>
                </div>
                <div className={`p-3 rounded-xl ${stat.color}`}>
                  <stat.icon size={24} />
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* System Health */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity size={20} className="text-emerald-400" />
                وضعیت سیستم
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {systemHealth.map((service) => (
                  <div
                    key={service.name}
                    className="flex items-center justify-between py-3 border-b border-white/5 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      {service.status === "healthy" ? (
                        <CheckCircle size={18} className="text-emerald-400" />
                      ) : service.status === "loading" ? (
                        <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <AlertCircle size={18} className="text-red-400" />
                      )}
                      <span className="text-white">{service.name}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      {service.latency !== "-" && (
                        <span className="text-gray-400">{service.latency}</span>
                      )}
                      <span className="text-gray-500">{service.usage}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top Resources */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText size={20} className="text-emerald-400" />
                منابع پرکاربرد
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {topResources.map((resource, index) => (
                  <div
                    key={resource.name}
                    className="flex items-center justify-between py-3 border-b border-white/5 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs flex items-center justify-center">
                        {index + 1}
                      </span>
                      <span className="text-white truncate max-w-[200px]">
                        {resource.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-gray-400">{resource.views} بازدید</span>
                      <Badge variant="default">{resource.queries} پرسش</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* RAG Performance */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu size={20} className="text-emerald-400" />
                عملکرد RAG
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div>
                  <p className="text-sm text-gray-400 mb-2">نرخ پاسخ‌دهی</p>
                  <div className="flex items-end gap-2">
                    <span className="text-3xl font-bold text-white">94%</span>
                    <span className="text-emerald-400 text-sm pb-1">+2%</span>
                  </div>
                  <Progress value={94} className="mt-2" />
                </div>
                <div>
                  <p className="text-sm text-gray-400 mb-2">میانگین امتیاز منابع</p>
                  <div className="flex items-end gap-2">
                    <span className="text-3xl font-bold text-white">0.82</span>
                    <span className="text-emerald-400 text-sm pb-1">+0.05</span>
                  </div>
                  <Progress value={82} className="mt-2" />
                </div>
                <div>
                  <p className="text-sm text-gray-400 mb-2">بازخورد مثبت</p>
                  <div className="flex items-end gap-2">
                    <span className="text-3xl font-bold text-white">87%</span>
                    <span className="text-emerald-400 text-sm pb-1">+3%</span>
                  </div>
                  <Progress value={87} className="mt-2" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
