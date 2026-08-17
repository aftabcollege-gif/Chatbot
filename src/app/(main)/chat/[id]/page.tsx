"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { SourcesPanel } from "@/components/chat/SourcesPanel";
import { useAuth } from "@/lib/auth-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PanelLeft, Loader2 } from "lucide-react";

import type { Message, Source } from "@/types/chat";

export default function ConversationPage() {
  const params = useParams();
  const conversationId = params.id as string;
  const { user } = useAuth();

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [currentSources, setCurrentSources] = useState<Source[]>([]);
  const [currentConfidence, setCurrentConfidence] = useState<number | undefined>();
  const [showSources, setShowSources] = useState(false);
  const [conversationTitle, setConversationTitle] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    fetchConversation();
  }, [conversationId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  const fetchConversation = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
        setConversationTitle(data.conversation?.title || "گفتگوی جدید");
      }
    } catch (error) {
      console.error("Error fetching conversation:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async (content: string, scope: string) => {
    // Add user message optimistically
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);
    setStreamingContent("");
    setCurrentSources([]);
    setCurrentConfidence(undefined);

    // Create abort controller
    abortControllerRef.current = new AbortController();

    try {
      const res = await fetch(
        `/api/chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, scope }),
          signal: abortControllerRef.current.signal,
        }
      );

      if (!res.ok) throw new Error("Failed to send message");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));

            switch (data.type) {
              case "token":
                setStreamingContent((prev) => prev + data.content);
                break;
              case "sources":
                setCurrentSources(data.sources);
                setShowSources(true);
                break;
              case "confidence":
                setCurrentConfidence(data.score);
                break;
              case "done":
                // Add the complete assistant message
                const assistantMessage: Message = {
                  id: data.messageId,
                  role: "assistant",
                  content: streamingContent + (data.content || ""),
                  confidenceScore: currentConfidence,
                  sources: currentSources,
                  createdAt: new Date().toISOString(),
                };
                setMessages((prev) => [...prev, assistantMessage]);
                setStreamingContent("");
                break;
              case "error":
                console.error("Stream error:", data.message);
                break;
            }
          } catch (e) {
            console.error("Parse error:", e);
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        console.log("Stream aborted");
      } else {
        console.error("Error sending message:", error);
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    if (streamingContent) {
      const assistantMessage: Message = {
        id: `stopped-${Date.now()}`,
        role: "assistant",
        content: streamingContent + " [متوقف شد]",
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setStreamingContent("");
    }
  };

  const handleSourceClick = (source: Source) => {
    // In production, this would open a document viewer or navigate to the source
    console.log("Source clicked:", source);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <TopBar title="گفتگو" />
        <div className="flex-1 p-6 space-y-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="w-10 h-10 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title={conversationTitle}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowSources(!showSources)}
          className="text-gray-400"
        >
          <PanelLeft size={20} />
        </Button>
      </TopBar>

      <div className="flex-1 flex overflow-hidden">
        {/* Messages Area */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto">
            {messages.length === 0 && !isStreaming ? (
              <div className="flex items-center justify-center h-full text-gray-500">
                <p>پیامی وجود ندارد. گفتگو را شروع کنید.</p>
              </div>
            ) : (
              <div className="py-4">
                {messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    role={message.role}
                    content={message.content}
                    sources={message.sources}
                    confidenceScore={message.confidenceScore}
                    userName={user?.name}
                    onSourceClick={handleSourceClick}
                  />
                ))}
                {isStreaming && streamingContent && (
                  <MessageBubble
                    role="assistant"
                    content={streamingContent}
                    isStreaming={true}
                  />
                )}
                {isStreaming && !streamingContent && (
                  <div className="flex gap-4 px-6 py-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                      <Loader2 size={20} className="text-white animate-spin" />
                    </div>
                    <div className="flex items-center">
                      <span className="text-gray-400">در حال فکر کردن...</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            isLoading={isStreaming}
          />
        </div>

        {/* Sources Panel */}
        <SourcesPanel
          sources={currentSources}
          confidenceScore={currentConfidence}
          isOpen={showSources}
          onClose={() => setShowSources(false)}
          onSourceClick={handleSourceClick}
        />
      </div>
    </div>
  );
}
