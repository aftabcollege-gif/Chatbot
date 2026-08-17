"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Bot, User, Mail, Lock, Building2, CheckCircle, Sparkles } from "lucide-react";

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    username: "",
    password: "",
    confirmPassword: "",
    organizationName: "",
  });

  const [passwordStrength, setPasswordStrength] = useState(0);

  useEffect(() => {
    // Check setup status
    async function checkStatus() {
      const res = await fetch("/api/setup/status");
      const data = await res.json();
      if (data.completed) {
        router.push("/login");
      }
    }
    checkStatus();
  }, [router]);

  useEffect(() => {
    // Calculate password strength
    const password = formData.password;
    let strength = 0;
    if (password.length >= 8) strength += 25;
    if (password.length >= 12) strength += 15;
    if (/[A-Z]/.test(password)) strength += 20;
    if (/[a-z]/.test(password)) strength += 10;
    if (/[0-9]/.test(password)) strength += 15;
    if (/[^A-Za-z0-9]/.test(password)) strength += 15;
    setPasswordStrength(Math.min(100, strength));
  }, [formData.password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (step === 1) {
      if (!formData.name || !formData.email) {
        setError("لطفاً تمام فیلدها را پر کنید");
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      if (!formData.username || !formData.password) {
        setError("لطفاً تمام فیلدها را پر کنید");
        return;
      }
      if (formData.password.length < 8) {
        setError("رمز عبور باید حداقل ۸ کاراکتر باشد");
        return;
      }
      if (formData.password !== formData.confirmPassword) {
        setError("رمز عبور و تکرار آن مطابقت ندارند");
        return;
      }
      setStep(3);
      return;
    }

    // Final step - submit
    setIsLoading(true);
    try {
      const res = await fetch("/api/setup/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          username: formData.username,
          password: formData.password,
          organizationName: formData.organizationName || "سازمان پیش‌فرض",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "خطا در راه‌اندازی");
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        router.push("/login");
      }, 2000);
    } catch (err) {
      setError("خطا در ارتباط با سرور");
    } finally {
      setIsLoading(false);
    }
  };

  const getStrengthColor = () => {
    if (passwordStrength < 30) return "bg-red-500";
    if (passwordStrength < 60) return "bg-yellow-500";
    return "bg-emerald-500";
  };

  const getStrengthText = () => {
    if (passwordStrength < 30) return "ضعیف";
    if (passwordStrength < 60) return "متوسط";
    if (passwordStrength < 80) return "قوی";
    return "بسیار قوی";
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#0B0F0E]">
        <div className="text-center animate-scale-in">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500/20 mb-6">
            <CheckCircle className="h-10 w-10 text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">راه‌اندازی کامل شد!</h2>
          <p className="text-emerald-400">در حال انتقال به صفحه ورود...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#0B0F0E]">
      <div className="absolute inset-0 opacity-30">
        <div
          className="absolute w-[600px] h-[600px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(16,185,129,0.15) 0%, transparent 70%)",
            top: "-200px",
            right: "-200px",
          }}
        />
      </div>

      <Card className="w-full max-w-lg relative animate-fade-in">
        <CardHeader className="text-center pb-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 mx-auto mb-4">
            <Bot size={32} className="text-white" />
          </div>
          <CardTitle className="text-2xl">راه‌اندازی اولیه</CardTitle>
          <CardDescription className="flex items-center justify-center gap-1">
            <Sparkles size={14} />
            سامانه دانش سازمانی
          </CardDescription>
        </CardHeader>

        <CardContent>
          {/* Progress */}
          <div className="mb-8">
            <div className="flex justify-between text-sm text-gray-400 mb-2">
              <span>مرحله {step} از ۳</span>
              <span>{Math.round((step / 3) * 100)}%</span>
            </div>
            <Progress value={(step / 3) * 100} />
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {step === 1 && (
              <div className="space-y-5 animate-slide-up">
                <h3 className="text-lg font-medium text-white mb-4">اطلاعات مدیر سیستم</h3>
                <Input
                  label="نام کامل"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  icon={<User size={20} />}
                  autoFocus
                  required
                />
                <Input
                  type="email"
                  label="ایمیل"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  icon={<Mail size={20} />}
                  required
                />
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5 animate-slide-up">
                <h3 className="text-lg font-medium text-white mb-4">اطلاعات ورود</h3>
                <Input
                  label="نام کاربری"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  icon={<User size={20} />}
                  autoFocus
                  required
                />
                <div>
                  <Input
                    type="password"
                    label="رمز عبور (حداقل ۸ کاراکتر)"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    icon={<Lock size={20} />}
                    required
                  />
                  {formData.password && (
                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${getStrengthColor()}`}
                          style={{ width: `${passwordStrength}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-400">{getStrengthText()}</span>
                    </div>
                  )}
                </div>
                <Input
                  type="password"
                  label="تکرار رمز عبور"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  icon={<Lock size={20} />}
                  success={formData.confirmPassword.length > 0 && formData.password === formData.confirmPassword}
                  required
                />
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5 animate-slide-up">
                <h3 className="text-lg font-medium text-white mb-4">اطلاعات سازمان</h3>
                <Input
                  label="نام سازمان (اختیاری)"
                  value={formData.organizationName}
                  onChange={(e) => setFormData({ ...formData, organizationName: e.target.value })}
                  icon={<Building2 size={20} />}
                  autoFocus
                />
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                  <h4 className="font-medium text-emerald-300 mb-2">خلاصه تنظیمات:</h4>
                  <ul className="text-sm text-gray-300 space-y-1">
                    <li>👤 مدیر: {formData.name}</li>
                    <li>📧 ایمیل: {formData.email}</li>
                    <li>🔑 نام کاربری: {formData.username}</li>
                    <li>🏢 سازمان: {formData.organizationName || "سازمان پیش‌فرض"}</li>
                  </ul>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm animate-shake">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              {step > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(step - 1)}
                  className="flex-1"
                >
                  مرحله قبل
                </Button>
              )}
              <Button
                type="submit"
                className="flex-1"
                loading={isLoading}
              >
                {step < 3 ? "مرحله بعد" : "اتمام راه‌اندازی"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
