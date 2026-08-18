"use client";

import React, { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import {
  User,
  Mail,
  Building2,
  Shield,
  Lock,
  Save,
  Camera,
  Moon,
  Sun,
  Languages,
  Calendar,
  MessageSquare,
  FileText,
  CheckCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function ProfilePage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState("profile");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [language, setLanguage] = useState<"fa" | "en">("fa");
  const [calendar, setCalendar] = useState<"jalali" | "gregorian">("jalali");
  const [isLoading, setIsLoading] = useState(false);
  const [passwords, setPasswords] = useState({
    current: "",
    new: "",
    confirm: "",
  });

  const handleSaveSettings = () => {
    addToast({
      type: "success",
      title: "تنظیمات ذخیره شد",
      description: "تغییرات با موفقیت اعمال شد",
    });
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      addToast({
        type: "error",
        title: "خطا",
        description: "رمز عبور جدید و تکرار آن مطابقت ندارند",
      });
      return;
    }
    setIsLoading(true);
    // Simulate API call
    await new Promise((r) => setTimeout(r, 1000));
    setIsLoading(false);
    addToast({
      type: "success",
      title: "رمز عبور تغییر کرد",
    });
    setPasswords({ current: "", new: "", confirm: "" });
  };

  const tabs = [
    { id: "profile", label: "پروفایل" },
    { id: "settings", label: "تنظیمات" },
    { id: "security", label: "امنیت" },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="پروفایل کاربری" />

      <div className="flex-1 p-6 max-w-4xl mx-auto w-full">
        {/* Profile Header */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex items-center gap-6">
              <div className="relative">
                <Avatar name={user?.name} size="xl" />
                <button className="absolute bottom-0 right-0 p-2 bg-emerald-500 rounded-full text-white hover:bg-emerald-600 transition-colors">
                  <Camera size={14} />
                </button>
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-white">{user?.name}</h2>
                <p className="text-gray-400 flex items-center gap-2 mt-1">
                  <Mail size={14} />
                  {user?.email}
                </p>
                <div className="flex items-center gap-3 mt-3">
                  <Badge variant="success" className="gap-1">
                    <Shield size={12} />
                    {user?.isAdmin ? "مدیر سیستم" : (user?.roles?.[0] ?? "کاربر")}
                  </Badge>
                  <span className="text-sm text-gray-500">
                    آخرین ورود: همین الان
                  </span>
                </div>
              </div>
              <div className="text-left">
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div className="p-4 bg-white/5 rounded-xl">
                    <MessageSquare size={20} className="mx-auto text-emerald-400 mb-1" />
                    <p className="text-xl font-bold text-white">43</p>
                    <p className="text-xs text-gray-500">گفتگو</p>
                  </div>
                  <div className="p-4 bg-white/5 rounded-xl">
                    <FileText size={20} className="mx-auto text-blue-400 mb-1" />
                    <p className="text-xl font-bold text-white">12</p>
                    <p className="text-xs text-gray-500">فایل</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-4 py-2 rounded-xl text-sm transition-colors",
                activeTab === tab.id
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Profile Tab */}
        {activeTab === "profile" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User size={20} className="text-emerald-400" />
                اطلاعات کاربری
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="نام کامل"
                  defaultValue={user?.name}
                  icon={<User size={18} />}
                />
                <Input
                  label="ایمیل"
                  defaultValue={user?.email}
                  icon={<Mail size={18} />}
                  disabled
                />
                <Input
                  label="نام کاربری"
                  defaultValue={user?.username}
                  icon={<User size={18} />}
                  disabled
                />
                <Input
                  label="واحد سازمانی"
                  defaultValue="فناوری اطلاعات"
                  icon={<Building2 size={18} />}
                  disabled
                />
              </div>
              <div className="pt-4 border-t border-white/10 flex justify-end">
                <Button onClick={handleSaveSettings} className="gap-2">
                  <Save size={16} />
                  ذخیره تغییرات
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Settings Tab */}
        {activeTab === "settings" && (
          <Card>
            <CardHeader>
              <CardTitle>تنظیمات نمایش</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {theme === "dark" ? (
                    <Moon size={20} className="text-emerald-400" />
                  ) : (
                    <Sun size={20} className="text-yellow-400" />
                  )}
                  <div>
                    <p className="text-white font-medium">تم</p>
                    <p className="text-sm text-gray-500">انتخاب تم روشن یا تاریک</p>
                  </div>
                </div>
                <div className="flex gap-2 bg-white/5 rounded-xl p-1">
                  <button
                    onClick={() => setTheme("dark")}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm transition-colors",
                      theme === "dark"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "text-gray-400"
                    )}
                  >
                    تاریک
                  </button>
                  <button
                    onClick={() => setTheme("light")}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm transition-colors",
                      theme === "light"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "text-gray-400"
                    )}
                  >
                    روشن
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Languages size={20} className="text-emerald-400" />
                  <div>
                    <p className="text-white font-medium">زبان</p>
                    <p className="text-sm text-gray-500">زبان رابط کاربری</p>
                  </div>
                </div>
                <div className="flex gap-2 bg-white/5 rounded-xl p-1">
                  <button
                    onClick={() => setLanguage("fa")}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm transition-colors",
                      language === "fa"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "text-gray-400"
                    )}
                  >
                    فارسی
                  </button>
                  <button
                    onClick={() => setLanguage("en")}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm transition-colors",
                      language === "en"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "text-gray-400"
                    )}
                  >
                    English
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Calendar size={20} className="text-emerald-400" />
                  <div>
                    <p className="text-white font-medium">تقویم</p>
                    <p className="text-sm text-gray-500">نوع تقویم نمایشی</p>
                  </div>
                </div>
                <div className="flex gap-2 bg-white/5 rounded-xl p-1">
                  <button
                    onClick={() => setCalendar("jalali")}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm transition-colors",
                      calendar === "jalali"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "text-gray-400"
                    )}
                  >
                    شمسی
                  </button>
                  <button
                    onClick={() => setCalendar("gregorian")}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm transition-colors",
                      calendar === "gregorian"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "text-gray-400"
                    )}
                  >
                    میلادی
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-white/10 flex justify-end">
                <Button onClick={handleSaveSettings} className="gap-2">
                  <Save size={16} />
                  ذخیره تنظیمات
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Security Tab */}
        {activeTab === "security" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock size={20} className="text-emerald-400" />
                تغییر رمز عبور
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
                <Input
                  type="password"
                  label="رمز عبور فعلی"
                  value={passwords.current}
                  onChange={(e) =>
                    setPasswords({ ...passwords, current: e.target.value })
                  }
                  icon={<Lock size={18} />}
                  required
                />
                <Input
                  type="password"
                  label="رمز عبور جدید"
                  value={passwords.new}
                  onChange={(e) =>
                    setPasswords({ ...passwords, new: e.target.value })
                  }
                  icon={<Lock size={18} />}
                  required
                />
                <Input
                  type="password"
                  label="تکرار رمز عبور جدید"
                  value={passwords.confirm}
                  onChange={(e) =>
                    setPasswords({ ...passwords, confirm: e.target.value })
                  }
                  icon={<Lock size={18} />}
                  success={
                    passwords.confirm.length > 0 &&
                    passwords.new === passwords.confirm
                  }
                  required
                />
                <Button type="submit" loading={isLoading} className="gap-2">
                  <CheckCircle size={16} />
                  تغییر رمز عبور
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
