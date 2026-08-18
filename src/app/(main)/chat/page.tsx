"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { timeAgo } from "@/lib/persian-date";

interface Conversation {
  id: string;
  title: string | null;
  isPinned: boolean | null;
  createdAt: string;
  updatedAt: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  confidenceScore: number | null;
  ragTrace?: Record<string, unknown>;
  createdAt: string;
}

interface Source {
  id: string;
  sourceType: "document" | "knowledge" | "experience";
  title: string;
  excerpt?: string;
  relevanceScore?: number;
}

interface MessageResponse {
  userMessage: Message;
  assistantMessage: Message;
  sources: Source[];
  confidence: number;
  ragTrace?: Record<string, unknown>;
}

export default function ChatPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = async () => {
    setLoadingConversations(true);
    try {
      const res = await fetch("/api/chat/conversations");
      if (res.ok) {
        const data = await res.json() as Conversation[];
        setConversations(data);
        if (data.length > 0 && !activeConversationId) {
          setActiveConversationId(data[0].id);
          await loadMessages(data[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load conversations", err);
    } finally {
      setLoadingConversations(false);
    }
  };

  const loadMessages = async (conversationId: string) => {
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/messages`);
      if (res.ok) {
        const data = await res.json() as Message[];
        setMessages(data);
      }
    } catch (err) {
      console.error("Failed to load messages", err);
    }
  };

  const newConversation = async () => {
    try {
      const res = await fetch("/api/chat/conversations", { method: "POST" });
      if (res.ok) {
        const conv = await res.json() as Conversation;
        setConversations((prev) => [conv, ...prev]);
        setActiveConversationId(conv.id);
        setMessages([]);
        setSources([]);
      }
    } catch (err) {
      console.error("Failed to create conversation", err);
    }
  };

  const selectConversation = async (conversationId: string) => {
    setActiveConversationId(conversationId);
    setMessages([]);
    setSources([]);
    await loadMessages(conversationId);
  };

  const sendMessage = async () => {
    if (!input.trim() || loading || !activeConversationId) return;

    const question = input.trim();
    setInput("");
    setLoading(true);

    // Optimistically add user message
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: question,
      confidenceScore: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setSources([]);

    try {
      const res = await fetch(
        `/api/chat/conversations/${activeConversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: question }),
        }
      );

      if (res.ok) {
        const data = await res.json() as MessageResponse;
        // Replace temp message with real messages
        setMessages((prev) =>
          [...prev.filter((m) => m.id !== tempUserMsg.id), data.userMessage, data.assistantMessage]
        );
        setSources(data.sources ?? []);

        // Update conversation title in list
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeConversationId
              ? { ...c, title: question.slice(0, 60), updatedAt: new Date().toISOString() }
              : c
          )
        );
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
        const errorData = await res.json() as { error?: string };
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: `خطا: ${errorData.error ?? "پاسخ دریافت نشد"}`,
            confidenceScore: null,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: "خطا در اتصال به سرور. لطفاً دوباره تلاش کنید.",
          confidenceScore: null,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const sourceTypeBadge = (type: string) => {
    switch (type) {
      case "document": return { label: "سند", className: "source-document" };
      case "knowledge": return { label: "دانش", className: "source-knowledge" };
      case "experience": return { label: "تجربه کارکنان", className: "source-experience" };
      default: return { label: type, className: "bg-slate-700 text-slate-300" };
    }
  };

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className="w-64 flex-shrink-0 bg-slate-800 border-l border-slate-700 flex flex-col">
        <div className="p-3 border-b border-slate-700">
          <button
            onClick={newConversation}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <span>+</span> گفتگوی جدید
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loadingConversations ? (
            <div className="p-4 text-center text-slate-500 text-sm">بارگذاری...</div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-slate-500 text-sm">
              هنوز گفتگویی ندارید
            </div>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => selectConversation(conv.id)}
                className={`w-full text-right px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeConversationId === conv.id
                    ? "bg-blue-700 text-white"
                    : "text-slate-400 hover:bg-slate-700 hover:text-white"
                }`}
              >
                <div className="truncate font-medium">
                  {conv.title ?? "گفتگوی بدون عنوان"}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {timeAgo(conv.updatedAt)}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activeConversationId ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="text-6xl mb-4">🧠</div>
            <h2 className="text-xl font-semibold text-white mb-2">
              به سامانه هوش سازمانی خوش آمدید
            </h2>
            <p className="text-slate-400 text-sm max-w-md mb-6">
              از اسناد، دانش‌نامه و تجربیات ثبت‌شده سازمان خود سؤال بپرسید.
              تمام پردازش‌ها به‌صورت کاملاً آفلاین انجام می‌شود.
            </p>
            <button
              onClick={newConversation}
              className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
            >
              شروع گفتگو
            </button>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.length === 0 && !loading && (
                <div className="text-center text-slate-500 mt-8">
                  <p className="text-sm">سؤال خود را مطرح کنید...</p>
                </div>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-start" : "justify-start"}`}
                >
                  <div
                    className={`max-w-3xl w-full ${
                      msg.role === "user"
                        ? "message-user px-4 py-3 ml-12"
                        : "message-assistant px-4 py-3 mr-12"
                    }`}
                  >
                    {msg.role === "assistant" && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-blue-400 font-medium">🧠 دستیار هوشمند</span>
                        {msg.confidenceScore !== null && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                            (msg.confidenceScore ?? 0) > 0.5
                              ? "bg-green-900/50 text-green-400"
                              : "bg-yellow-900/50 text-yellow-400"
                          }`}>
                            اطمینان: {Math.round((msg.confidenceScore ?? 0) * 100)}٪
                          </span>
                        )}
                      </div>
                    )}
                    <p className="text-white text-sm leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </p>
                    <p className="text-slate-600 text-xs mt-2">{timeAgo(msg.createdAt)}</p>
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="message-assistant px-4 py-3 max-w-3xl">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-blue-400 font-medium">🧠 دستیار هوشمند</span>
                    </div>
                    <div className="flex gap-1.5">
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Sources panel */}
            {sources.length > 0 && (
              <div className="border-t border-slate-700 bg-slate-800/50 p-4">
                <p className="text-slate-400 text-xs font-medium mb-2">منابع استناد شده:</p>
                <div className="flex flex-wrap gap-2">
                  {sources.slice(0, 6).map((source, idx) => {
                    const badge = sourceTypeBadge(source.sourceType);
                    return (
                      <div
                        key={source.id}
                        className="flex items-center gap-1.5 text-xs bg-slate-700 rounded-lg px-2.5 py-1.5"
                        title={source.excerpt ?? ""}
                      >
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${badge.className}`}>
                          {badge.label}
                        </span>
                        <span className="text-slate-300 max-w-32 truncate">[{idx + 1}] {source.title}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Input area */}
            <div className="border-t border-slate-700 p-4">
              <div className="flex gap-3 items-end">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="سؤال خود را بنویسید... (Enter برای ارسال، Shift+Enter برای خط جدید)"
                  rows={2}
                  disabled={loading}
                  className="flex-1 bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                  style={{ direction: "rtl" }}
                />
                <button
                  onClick={sendMessage}
                  disabled={loading || !input.trim()}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl px-4 py-3 transition-colors flex-shrink-0"
                >
                  📤
                </button>
              </div>
              <p className="text-slate-600 text-xs mt-2 text-center">
                پاسخ‌ها بر اساس منابع سازمانی مجاز شما تولید می‌شوند
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
