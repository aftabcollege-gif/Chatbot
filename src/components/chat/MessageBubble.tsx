"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Bot,
  User,
  ThumbsUp,
  ThumbsDown,
  Copy,
  RefreshCw,
  Check,
  FileText,
  ExternalLink,
} from "lucide-react";

import type { Source } from "@/types/chat";

export type { Source };

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  confidenceScore?: number;
  timestamp?: string;
  isStreaming?: boolean;
  onFeedback?: (type: "positive" | "negative") => void;
  onRegenerate?: () => void;
  onSourceClick?: (source: Source) => void;
  userName?: string;
}

export function MessageBubble({
  role,
  content,
  sources,
  confidenceScore,
  timestamp,
  isStreaming,
  onFeedback,
  onRegenerate,
  onSourceClick,
  userName,
}: MessageBubbleProps) {
  const [copied, setCopied] = React.useState(false);
  const [feedback, setFeedback] = React.useState<"positive" | "negative" | null>(null);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFeedback = (type: "positive" | "negative") => {
    setFeedback(type);
    onFeedback?.(type);
  };

  const isUser = role === "user";

  return (
    <div
      className={cn(
        "flex gap-4 px-6 py-4 animate-fade-in",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      <div className="shrink-0">
        {isUser ? (
          <Avatar name={userName} size="md" />
        ) : (
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
            <Bot size={20} className="text-white" />
          </div>
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          "flex-1 max-w-3xl",
          isUser && "flex flex-col items-end"
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-5 py-3",
            isUser
              ? "bg-emerald-500 text-white"
              : "bg-[#17211D] border border-white/10"
          )}
        >
          {/* Message Content */}
          <div
            className={cn(
              "prose prose-invert max-w-none",
              isUser && "prose-p:text-white"
            )}
          >
            <p className="whitespace-pre-wrap leading-relaxed">{content}</p>
            {isStreaming && (
              <span className="inline-block w-2 h-5 bg-emerald-400 animate-typing-cursor mr-1" />
            )}
          </div>

          {/* Sources */}
          {!isUser && sources && sources.length > 0 && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <p className="text-xs text-gray-400 mb-2">منابع:</p>
              <div className="flex flex-wrap gap-2">
                {sources.map((source, index) => (
                  <button
                    key={source.id}
                    onClick={() => onSourceClick?.(source)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 text-xs hover:bg-emerald-500/20 transition-colors"
                  >
                    <FileText size={12} />
                    <span>[{index + 1}] {source.title}</span>
                    {source.pageNumber && (
                      <span className="text-emerald-500/70">ص{source.pageNumber}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        {!isUser && !isStreaming && (
          <div className="flex items-center gap-2 mt-2 px-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleFeedback("positive")}
              className={cn(
                "h-8 px-2",
                feedback === "positive" && "text-emerald-400"
              )}
            >
              <ThumbsUp size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleFeedback("negative")}
              className={cn(
                "h-8 px-2",
                feedback === "negative" && "text-red-400"
              )}
            >
              <ThumbsDown size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-8 px-2"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRegenerate}
              className="h-8 px-2"
            >
              <RefreshCw size={14} />
            </Button>
            {confidenceScore !== undefined && (
              <Badge variant="secondary" className="text-xs">
                {Math.round(confidenceScore * 100)}% اطمینان
              </Badge>
            )}
          </div>
        )}

        {/* Timestamp */}
        {timestamp && (
          <p
            className={cn(
              "text-xs text-gray-500 mt-1 px-2",
              isUser && "text-left"
            )}
          >
            {timestamp}
          </p>
        )}
      </div>
    </div>
  );
}
