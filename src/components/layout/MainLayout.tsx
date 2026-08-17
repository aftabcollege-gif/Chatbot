"use client";

import React, { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  isPinned: boolean;
}

export function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchConversations();
    }
  }, [isAuthenticated]);

  const fetchConversations = async () => {
    try {
      const res = await fetch("/api/chat/conversations");
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch (error) {
      console.error("Error fetching conversations:", error);
    }
  };

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
        fetchConversations();
      }
    } catch (error) {
      console.error("Error creating conversation:", error);
    }
  };

  // Extract conversation ID from path
  const conversationId = pathname.startsWith("/chat/")
    ? pathname.split("/")[2]
    : undefined;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B0F0E]">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#0B0F0E]">
      <Sidebar
        conversations={conversations}
        currentConversationId={conversationId}
        onNewChat={handleNewChat}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
      />
      
      <main
        className={cn(
          "transition-all duration-300",
          collapsed ? "mr-16" : "mr-64"
        )}
      >
        {children}
      </main>
    </div>
  );
}
