"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Loader2 } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const [setupStatus, setSetupStatus] = useState<{ completed: boolean } | null>(null);

  useEffect(() => {
    async function checkSetup() {
      try {
        const res = await fetch("/api/setup/status");
        const data = await res.json();
        setSetupStatus(data);
      } catch {
        setSetupStatus({ completed: false });
      }
    }
    checkSetup();
  }, []);

  useEffect(() => {
    if (isLoading || setupStatus === null) return;

    if (!setupStatus.completed) {
      router.push("/setup");
    } else if (isAuthenticated) {
      router.push("/chat");
    } else {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, setupStatus, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B0F0E]">
      <div className="text-center">
        <Loader2 className="h-12 w-12 animate-spin text-emerald-500 mx-auto mb-4" />
        <p className="text-emerald-400">در حال بارگذاری...</p>
      </div>
    </div>
  );
}
