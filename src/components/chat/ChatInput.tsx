"use client";

import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Send, Square } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string, scope: string) => void;
  onStop?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export function ChatInput({
  onSend,
  onStop,
  isLoading,
  disabled,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        200
      )}px`;
    }
  }, [message]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!message.trim() || disabled) return;
    onSend(message.trim(), "all");
    setMessage("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-white/10 bg-[#0B0F0E]/80 backdrop-blur-lg p-4">
      <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
        <div className="relative flex items-end gap-3 bg-[#17211D] rounded-2xl border border-white/10 p-3">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="سؤال خود را بنویسید..."
            className="flex-1 bg-transparent resize-none outline-none text-white placeholder-gray-500 text-base min-h-[24px] max-h-[200px] py-2"
            rows={1}
            disabled={disabled || isLoading}
          />

          {isLoading ? (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              onClick={onStop}
              className="shrink-0"
            >
              <Square size={18} fill="currentColor" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!message.trim() || disabled}
              className="shrink-0"
            >
              <Send size={18} />
            </Button>
          )}
        </div>

        <p className="text-center text-xs text-gray-600 mt-2">
          پاسخ‌ها بر اساس اسناد و تجربیات سازمانی ارائه می‌شوند
        </p>
      </form>
    </div>
  );
}
