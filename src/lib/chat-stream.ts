/**
 * Client helper for POST /api/chat/conversations/:id/messages in streaming
 * (NDJSON) mode. Falls back transparently to the JSON response shape when the
 * server answers with application/json (older server, proxies that buffer).
 */
import type { RagSourceType } from "@/db/schema";

export interface ChatSource {
  id: string;
  sourceId: string;
  documentId?: string;
  experienceId?: string;
  sourceType: RagSourceType;
  title: string;
  sourceTitle: string;
  pageNumber: number | null;
  section: string | null;
  heading: string | null;
  relevanceScore: number;
  excerpt?: string;
}

export interface ChatMessageRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  confidenceScore: number | null;
  ragTrace?: Record<string, unknown> | null;
  createdAt: string;
}

export interface ChatDone {
  userMessage: ChatMessageRecord;
  assistantMessage: ChatMessageRecord;
  sources: ChatSource[];
  confidence: number;
  usedLLM?: boolean;
  ragTrace?: Record<string, unknown>;
}

export interface StreamHandlers {
  onUserMessage?: (message: ChatMessageRecord) => void;
  onSources?: (sources: ChatSource[]) => void;
  onToken?: (text: string, accumulated: string) => void;
}

type StreamEvent =
  | { type: "user"; message: ChatMessageRecord }
  | { type: "sources"; sources: ChatSource[] }
  | { type: "token"; text: string }
  | { type: "done"; assistantMessage: ChatMessageRecord; sources: ChatSource[]; confidence: number; usedLLM?: boolean; ragTrace?: Record<string, unknown> }
  | { type: "error"; error: string };

export class ChatRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function sendChatMessage(
  conversationId: string,
  content: string,
  handlers: StreamHandlers = {},
  signal?: AbortSignal,
): Promise<ChatDone> {
  const res = await fetch(`/api/chat/conversations/${conversationId}/messages?stream=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson, application/json" },
    body: JSON.stringify({ content }),
    signal,
  });

  if (!res.ok) {
    let message = "پاسخ دریافت نشد";
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ChatRequestError(message, res.status);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-ndjson") || !res.body) {
    const data = (await res.json()) as ChatDone;
    handlers.onUserMessage?.(data.userMessage);
    handlers.onSources?.(data.sources ?? []);
    return data;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let userMessage: ChatMessageRecord | null = null;
  let done: ChatDone | null = null;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let event: StreamEvent;
    try {
      event = JSON.parse(line) as StreamEvent;
    } catch {
      return;
    }
    switch (event.type) {
      case "user":
        userMessage = event.message;
        handlers.onUserMessage?.(event.message);
        break;
      case "sources":
        handlers.onSources?.(event.sources);
        break;
      case "token":
        accumulated += event.text;
        handlers.onToken?.(event.text, accumulated);
        break;
      case "done":
        done = {
          userMessage: userMessage ?? {
            id: `local-${Date.now()}`,
            role: "user",
            content,
            confidenceScore: null,
            createdAt: new Date().toISOString(),
          },
          assistantMessage: event.assistantMessage,
          sources: event.sources ?? [],
          confidence: event.confidence,
          usedLLM: event.usedLLM,
          ragTrace: event.ragTrace,
        };
        break;
      case "error":
        throw new ChatRequestError(event.error, 500);
    }
  };

  for (;;) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      handleLine(line);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) handleLine(buffer);

  if (!done) throw new ChatRequestError("ارتباط پیش از دریافت پاسخ کامل قطع شد.", 502);
  return done;
}
