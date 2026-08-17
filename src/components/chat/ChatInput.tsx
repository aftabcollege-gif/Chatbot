"use client";

import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Send,
  Paperclip,
  Square,
  ChevronDown,
  Globe,
  Building2,
  Folder,
  Lock,
  X,
} from "lucide-react";

interface ChatInputProps {
  onSend: (message: string, scope: string) => void;
  onStop?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
}

const scopes = [
  { id: "all", label: "همه منابع", icon: Globe },
  { id: "department", label: "واحد من", icon: Building2 },
  { id: "folder", label: "پوشه خاص", icon: Folder },
  { id: "private", label: "منابع خصوصی", icon: Lock },
];

export function ChatInput({
  onSend,
  onStop,
  isLoading,
  disabled,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [scope, setScope] = useState("all");
  const [showScopes, setShowScopes] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedScope = scopes.find((s) => s.id === scope) || scopes[0];
  const ScopeIcon = selectedScope.icon;

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
    onSend(message.trim(), scope);
    setMessage("");
    setFiles([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...selectedFiles]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="border-t border-white/10 bg-[#0B0F0E]/80 backdrop-blur-lg p-4">
      <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
        {/* File Previews */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {files.map((file, index) => (
              <div
                key={index}
                className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-sm"
              >
                <Paperclip size={14} className="text-emerald-400" />
                <span className="text-emerald-300 max-w-[150px] truncate">
                  {file.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  className="text-gray-400 hover:text-white"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input Area */}
        <div className="relative flex items-end gap-3 bg-[#17211D] rounded-2xl border border-white/10 p-3">
          {/* File Upload */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 p-2 text-gray-400 hover:text-emerald-400 transition-colors"
          >
            <Paperclip size={20} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Textarea */}
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

          {/* Send / Stop Button */}
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

        {/* Scope Selector */}
        <div className="flex items-center gap-3 mt-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowScopes(!showScopes)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-300 hover:bg-white/10 transition-colors"
            >
              <ScopeIcon size={14} />
              <span>{selectedScope.label}</span>
              <ChevronDown
                size={14}
                className={cn(
                  "transition-transform",
                  showScopes && "rotate-180"
                )}
              />
            </button>

            {showScopes && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowScopes(false)}
                />
                <div className="absolute bottom-full mb-2 right-0 w-48 bg-[#17211D] border border-white/10 rounded-xl shadow-xl z-20 overflow-hidden animate-scale-in">
                  {scopes.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setScope(s.id);
                        setShowScopes(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors",
                        scope === s.id
                          ? "bg-emerald-500/10 text-emerald-300"
                          : "text-gray-300 hover:bg-white/5"
                      )}
                    >
                      <s.icon size={16} />
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <span className="text-xs text-gray-500">
            Enter برای ارسال • Shift+Enter برای خط جدید
          </span>
        </div>
      </form>
    </div>
  );
}
