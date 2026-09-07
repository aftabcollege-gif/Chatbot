"use client";

import React, { useState, useEffect, useRef, use } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { useAuth } from "@/lib/auth-context";
import { Loader2, Bot } from "lucide-react";
import type { Message, Source } from "@/types/chat";
import { sendChatMessage, ChatRequestError, type ChatSource } from "@/lib/chat-stream";

function toUiSources(sources: ChatSource[]): Source[] {
  return sources.map((s, index) => ({
    id: s.id,
    type: s.sourceType,
    title: s.title,
    pageNumber: s.pageNumber ?? undefined,
    section: s.section ?? undefined,
    heading: s.heading ?? undefined,
    relevanceScore: s.relevanceScore,
    snippet: s.excerpt,
    citationIndex: index + 1,
  }));
}

export default function ChatConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [title, setTitle] = useState("گفتگوی جدید");
  const [initialLoading, setInitialLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadConversation() {
      try {
        const res = await fetch(`/api/chat/conversations/${id}`);
        if (res.ok) {
          const data = await res.json();
          setTitle(data.conversation?.title || "گفتگوی جدید");
          setMessages(
            (data.messages || []).map((m: { id: string; role: string; content: string; confidenceScore?: number; createdAt?: string; sources?: Message["sources"] }) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              confidenceScore: m.confidenceScore,
              createdAt: m.createdAt,
              sources: m.sources,
            }))
          );
        }
      } catch (error) {
        console.error("Error loading conversation:", error);
      } finally {
        setInitialLoading(false);
      }
    }
    loadConversation();
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (content: string, _scope: string) => {
    void _scope;
    const tempId = `temp-${Date.now()}`;
    const tempAssistantId = `temp-assistant-${Date.now()}`;
    const userMsg: Message = {
      id: tempId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    setStreaming(false);

    try {
      let streamedSources: Source[] = [];
      const data = await sendChatMessage(id, content, {
        onSources: (sources) => {
          streamedSources = toUiSources(sources);
        },
        onToken: (_text, accumulated) => {
          setStreaming(true);
          setMessages((prev) => {
            const partial: Message = {
              id: tempAssistantId,
              role: "assistant",
              content: accumulated,
              sources: streamedSources,
              createdAt: new Date().toISOString(),
            };
            return prev.some((m) => m.id === tempAssistantId)
              ? prev.map((m) => (m.id === tempAssistantId ? partial : m))
              : [...prev, partial];
          });
        },
      });

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempId && m.id !== tempAssistantId),
        {
          id: data.userMessage.id,
          role: "user" as const,
          content: data.userMessage.content,
          createdAt: data.userMessage.createdAt,
        },
        {
          id: data.assistantMessage.id,
          role: "assistant" as const,
          content: data.assistantMessage.content,
          confidenceScore: data.assistantMessage.confidenceScore ?? undefined,
          createdAt: data.assistantMessage.createdAt,
          sources: toUiSources(data.sources ?? []),
        },
      ]);

      // Update title if it was auto-set
      if (title === "گفتگوی جدید") {
        setTitle(content.substring(0, 50) + (content.length > 50 ? "..." : ""));
      }
    } catch (error) {
      console.error("Error sending message:", error);
      const message =
        error instanceof ChatRequestError ? `خطا: ${error.message}` : "خطا در اتصال به سرور. لطفاً دوباره تلاش کنید.";
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempAssistantId),
        { id: `err-${Date.now()}`, role: "assistant", content: message, createdAt: new Date().toISOString() },
      ]);
    } finally {
      setIsLoading(false);
      setStreaming(false);
    }
  };

  if (initialLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title={title} />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center mb-4">
              <Bot size={32} className="text-white" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">سلام! چطور می‌تونم کمکتون کنم؟</h2>
            <p className="text-gray-400">سؤال خود را درباره اسناد و تجربیات سازمانی بپرسید</p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} userName={user?.name} />
        ))}

        {isLoading && !streaming && (
          <div className="flex gap-3 max-w-4xl mx-auto">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shrink-0">
              <Bot size={18} className="text-white" />
            </div>
            <div className="bg-[#17211D] border border-white/10 rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                <span className="text-sm text-gray-400">در حال پردازش...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <ChatInput
        onSend={handleSend}
        isLoading={isLoading}
        onStop={() => setIsLoading(false)}
      />
    </div>
  );
}
