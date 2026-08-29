import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Send, Pin, Trash2, MessageSquare, Sparkles, FileText, BookOpen, Hash } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import type { Conversation, Message, MessageSource } from "@/types";
import { relativeTime, toPersianDigits } from "@/lib/persian";
import { useAuth } from "@/store/auth";

const SUGGESTIONS = [
  { icon: FileText, title: "اسناد", text: "سیاست مرخصی سالانه چند روز است؟" },
  { icon: BookOpen, title: "دانش", text: "تجربیات ثبت‌شده درباره رفع خطا را خلاصه کن." },
  { icon: Hash, title: "فرایندها", text: "مراحل درخواست مرخصی چیست؟" },
];

export function ChatPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await api.get("/chat/conversations", { params: { limit: 50 } });
      setConversations(res.data.items);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const loadMessages = useCallback(
    async (convId: string) => {
      try {
        const res = await api.get(`/chat/conversations/${convId}`);
        setMessages(res.data.messages);
      } catch {
        setMessages([]);
      }
    },
    [],
  );

  useEffect(() => {
    if (id) loadMessages(id);
    else setMessages([]);
  }, [id, loadMessages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function newConversation() {
    const res = await api.post("/chat/conversations", { title: null });
    setConversations((c) => [res.data, ...c]);
    navigate(`/chat/${res.data.id}`);
  }

  async function deleteConversation(convId: string, e: React.MouseEvent) {
    e.stopPropagation();
    await api.delete(`/chat/conversations/${convId}`);
    setConversations((c) => c.filter((x) => x.id !== convId));
    if (id === convId) navigate("/chat");
  }

  async function pinConversation(convId: string, pinned: number, e: React.MouseEvent) {
    e.stopPropagation();
    await api.patch(`/chat/conversations/${convId}`, { is_pinned: !pinned });
    loadConversations();
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");

    let convId = id;
    if (!convId) {
      const res = await api.post("/chat/conversations", { title: text.slice(0, 40) });
      convId = res.data.id;
      navigate(`/chat/${convId}`, { replace: true });
      setConversations((c) => [res.data, ...c]);
    }

    const userMsg: Message = { role: "user", content: text };
    const assistantMsg: Message = { role: "assistant", content: "", streaming: true, sources: [] };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const token = localStorage.getItem("eai_access_token");
      const resp = await fetch(`/api/chat/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: text, scope: "all" }),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) throw new Error("stream failed");
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());
            if (ev.type === "token") {
              setMessages((m) => {
                const copy = [...m];
                const last = copy[copy.length - 1];
                if (last && last.role === "assistant") {
                  copy[copy.length - 1] = { ...last, content: last.content + ev.content };
                }
                return copy;
              });
            } else if (ev.type === "sources") {
              setMessages((m) => {
                const copy = [...m];
                const last = copy[copy.length - 1];
                if (last && last.role === "assistant") {
                  copy[copy.length - 1] = { ...last, sources: ev.sources };
                }
                return copy;
              });
            } else if (ev.type === "confidence") {
              setMessages((m) => {
                const copy = [...m];
                const last = copy[copy.length - 1];
                if (last && last.role === "assistant") {
                  copy[copy.length - 1] = { ...last, confidence_score: ev.score };
                }
                return copy;
              });
            } else if (ev.type === "error") {
              setMessages((m) => {
                const copy = [...m];
                const last = copy[copy.length - 1];
                if (last) copy[copy.length - 1] = { ...last, error: true, content: ev.message };
                return copy;
              });
            } else if (ev.type === "done") {
              setMessages((m) => {
                const copy = [...m];
                const last = copy[copy.length - 1];
                if (last) copy[copy.length - 1] = { ...last, streaming: false, id: ev.message_id };
                return copy;
              });
            }
          } catch {
            /* ignore parse */
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last) copy[copy.length - 1] = { ...last, streaming: false, error: true, content: "خطا در دریافت پاسخ." };
          return copy;
        });
      }
    } finally {
      setSending(false);
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last) copy[copy.length - 1] = { ...last, streaming: false };
        return copy;
      });
      loadConversations();
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className="w-64 shrink-0 border-l flex flex-col bg-card/50">
        <div className="p-3">
          <Button onClick={newConversation} className="w-full">
            <Plus className="h-4 w-4" /> گفتگوی جدید
          </Button>
        </div>
        <ScrollArea className="flex-1 px-2">
          {conversations.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">هنوز گفتگویی نیست</p>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => navigate(`/chat/${c.id}`)}
              className={cn(
                "group flex items-center gap-2 rounded-lg px-3 py-2 mb-1 cursor-pointer text-sm transition-colors",
                id === c.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
              )}
            >
              <MessageSquare className="h-4 w-4 shrink-0 opacity-60" />
              <span className="flex-1 truncate">{c.title}</span>
              <button onClick={(e) => pinConversation(c.id, c.is_pinned, e)} className="opacity-0 group-hover:opacity-100">
                <Pin className={cn("h-3.5 w-3.5", c.is_pinned && "text-primary opacity-100")} />
              </button>
              <button onClick={(e) => deleteConversation(c.id, e)} className="opacity-0 group-hover:opacity-100 text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </ScrollArea>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        <div className="h-14 border-b flex items-center justify-between px-6">
          <h2 className="font-semibold">{id ? "گفتگو" : "گفتگوی جدید"}</h2>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            آفلاین و امن
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-8">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-4">
                <Sparkles className="h-8 w-8" />
              </div>
              <h2 className="text-2xl font-bold mb-2">سلام {user?.name?.split(" ")[0]} 👋</h2>
              <p className="text-muted-foreground mb-8">هر سؤالی از منابع سازمانی خود بپرسید</p>
              <div className="grid grid-cols-3 gap-3 max-w-2xl w-full">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.title}
                    onClick={() => setInput(s.text)}
                    className="rounded-xl border p-4 text-start hover:bg-accent transition-colors"
                  >
                    <s.icon className="h-5 w-5 text-primary mb-2" />
                    <div className="text-sm font-medium mb-1">{s.title}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2">{s.text}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
              {messages.map((m, i) => (
                <MessageBubble key={i} message={m} />
              ))}
            </div>
          )}
        </div>

        <div className="border-t p-4">
          <div className="max-w-3xl mx-auto relative">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="سؤال خود را بنویسید... (Enter برای ارسال)"
              rows={1}
              className="pe-12 min-h-[52px] max-h-48 resize-none"
              disabled={sending}
            />
            <Button
              size="icon"
              className="absolute end-2 bottom-2"
              onClick={send}
              disabled={!input.trim() || sending}
            >
              {sending ? <Spinner /> : <Send className="h-4 w-4 rotate-180" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">
            پاسخ‌ها از منابع داخلی تولید می‌شوند. ممکن است خطا وجود داشته باشد — منابع را بررسی کنید.
          </p>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3 animate-fade-in", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "h-8 w-8 rounded-lg shrink-0 flex items-center justify-center text-sm font-semibold",
          isUser ? "bg-primary text-primary-foreground" : "bg-card border",
        )}
      >
        {isUser ? "ش" : <Sparkles className="h-4 w-4 text-primary" />}
      </div>
      <div className={cn("flex-1 min-w-0", isUser && "text-end")}>
        <div
          className={cn(
            "inline-block rounded-2xl px-4 py-3 max-w-full text-sm leading-7 whitespace-pre-wrap",
            isUser ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-card border rounded-tl-sm",
            message.error && "border-destructive text-destructive",
          )}
        >
          {message.content || (message.streaming ? <span className="typing-cursor" /> : "")}
        </div>
        {!isUser && message.sources && message.sources.length > 0 && (
          <SourcesPanel sources={message.sources} />
        )}
        {!isUser && message.confidence_score !== undefined && message.confidence_score > 0 && (
          <div className="mt-2 text-xs text-muted-foreground">
            اطمینان: {toPersianDigits(Math.round(message.confidence_score * 100))}٪
          </div>
        )}
      </div>
    </div>
  );
}

function SourcesPanel({ sources }: { sources: MessageSource[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-primary hover:underline flex items-center gap-1"
      >
        <FileText className="h-3.5 w-3.5" />
        {toPersianDigits(sources.length)} منبع
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {sources.map((s) => (
            <div key={s.citation_index} className="rounded-lg border bg-card/50 p-3 text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium flex items-center gap-1">
                  <span className="h-4 w-4 rounded bg-primary/10 text-primary inline-flex items-center justify-center text-[10px]">
                    {toPersianDigits(s.citation_index)}
                  </span>
                  {s.title}
                </span>
                {s.page_number && <span className="text-muted-foreground">ص {toPersianDigits(s.page_number)}</span>}
              </div>
              <p className="text-muted-foreground line-clamp-2">{s.snippet}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
