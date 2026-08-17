"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { MessageSquarePlus, Bot, FileText, Brain, Sparkles } from "lucide-react";

export default function ChatPage() {
  const router = useRouter();

  const handleNewChat = async () => {
    try {
      const res = await fetch("/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: null }),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/chat/${data.conversation.id}`);
      }
    } catch (error) {
      console.error("Error creating conversation:", error);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="گفتگو" />

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-2xl text-center">
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-3xl bg-gradient-to-br from-emerald-500 to-emerald-600 mb-8">
            <Bot size={48} className="text-white" />
          </div>

          <h1 className="text-3xl font-bold text-white mb-4">
            سامانه دانش سازمانی
          </h1>
          <p className="text-lg text-gray-400 mb-8">
            از من هر سؤالی درباره اسناد، دستورالعمل‌ها و تجربیات سازمانی بپرسید
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
            <div className="p-4 bg-[#17211D] rounded-xl border border-white/10">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center mx-auto mb-3">
                <FileText size={20} className="text-blue-400" />
              </div>
              <h3 className="text-white font-medium mb-1">اسناد سازمانی</h3>
              <p className="text-sm text-gray-500">پاسخ بر اساس اسناد معتبر</p>
            </div>
            <div className="p-4 bg-[#17211D] rounded-xl border border-white/10">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                <Brain size={20} className="text-emerald-400" />
              </div>
              <h3 className="text-white font-medium mb-1">تجربیات</h3>
              <p className="text-sm text-gray-500">دسترسی به دانش همکاران</p>
            </div>
            <div className="p-4 bg-[#17211D] rounded-xl border border-white/10">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center mx-auto mb-3">
                <Sparkles size={20} className="text-purple-400" />
              </div>
              <h3 className="text-white font-medium mb-1">منابع شفاف</h3>
              <p className="text-sm text-gray-500">مشاهده منبع هر پاسخ</p>
            </div>
          </div>

          <Button size="lg" onClick={handleNewChat} className="gap-2">
            <MessageSquarePlus size={20} />
            شروع گفتگوی جدید
          </Button>
        </div>
      </div>
    </div>
  );
}
