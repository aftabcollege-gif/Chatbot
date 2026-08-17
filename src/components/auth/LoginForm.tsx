"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { Bot, Sparkles, User, Lock } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const { login, isLoading: authLoading, isAuthenticated } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (isAuthenticated && !authLoading) {
      router.push("/chat");
    }
  }, [isAuthenticated, authLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await login(username, password);
      router.push("/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در ورود به سیستم");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    } finally {
      setIsLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-8 w-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
      {/* Animated Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0B0F0E] via-[#111715] to-[#0B0F0E]">
        <div className="absolute inset-0 opacity-30">
          <div
            className="absolute w-[600px] h-[600px] rounded-full animate-gradient"
            style={{
              background: "radial-gradient(circle, rgba(16,185,129,0.15) 0%, transparent 70%)",
              top: "-200px",
              right: "-200px",
            }}
          />
          <div
            className="absolute w-[500px] h-[500px] rounded-full animate-gradient"
            style={{
              background: "radial-gradient(circle, rgba(5,150,105,0.1) 0%, transparent 70%)",
              bottom: "-150px",
              left: "-150px",
              animationDelay: "2s",
            }}
          />
        </div>
      </div>

      {/* Login Card */}
      <div
        className={`relative w-full max-w-md animate-scale-in ${
          shake ? "animate-shake" : ""
        }`}
      >
        <div className="glass-strong rounded-3xl p-8 shadow-2xl">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 animate-pulse-glow mb-4">
              <Bot size={40} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              سامانه دانش سازمانی
            </h1>
            <p className="text-emerald-400/70 flex items-center justify-center gap-1">
              <Sparkles size={16} />
              دستیار هوشمند محلی
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <Input
              type="text"
              label="نام کاربری یا ایمیل"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              icon={<User size={20} />}
              error={error && !password ? " " : undefined}
              autoFocus
              required
            />
            <Input
              type="password"
              label="رمز عبور"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              icon={<Lock size={20} />}
              error={error || undefined}
              required
            />

            <Button
              type="submit"
              className="w-full h-14 text-lg font-semibold rounded-xl"
              loading={isLoading}
            >
              {isLoading ? "در حال ورود..." : "ورود به سامانه"}
            </Button>
          </form>

          {/* Footer */}
          <div className="mt-8 text-center">
            <p className="text-sm text-gray-500">
              نسخه ۱.۰.۰ • Enterprise AI Platform
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
