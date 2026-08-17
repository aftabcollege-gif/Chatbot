"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Bot, User } from "lucide-react";
import type { Message } from "@/types/chat";

interface MessageBubbleProps {
  message: Message;
  userName?: string;
}

export function MessageBubble({ message, userName }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex gap-3 max-w-4xl mx-auto",
        isUser ? "flex-row-reverse" : ""
      )}
    >
      <div className="shrink-0">
        {isUser ? (
          <Avatar name={userName} size="sm" />
        ) : (
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
            <Bot size={18} className="text-white" />
          </div>
        )}
      </div>

      <div
        className={cn(
          "flex-1 rounded-2xl px-4 py-3",
          isUser
            ? "bg-emerald-500/10 border border-emerald-500/20"
            : "bg-[#17211D] border border-white/10"
        )}
      >
        <div className="text-white whitespace-pre-wrap leading-relaxed text-sm">
          {message.content}
        </div>

        {message.confidenceScore !== undefined && message.confidenceScore > 0 && (
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
            <span>اطمینان: {Math.round(message.confidenceScore * 100)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
