"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const [setupDone, setSetupDone] = useState<boolean | null>(null);

  useEffect(() => {
    async function checkSetup() {
      try {
        const res = await fetch("/api/setup/status");
        const data = await res.json() as { completed: boolean };
        setSetupDone(data.completed);
      } catch {
        setSetupDone(false);
      }
    }
    void checkSetup();
  }, []);

  useEffect(() => {
    if (isLoading || setupDone === null) return;

    if (!setupDone) {
      router.push("/setup");
    } else if (isAuthenticated) {
      router.push("/chat");
    } else {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, setupDone, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-sm">در حال بارگذاری...</p>
      </div>
    </div>
  );
}
