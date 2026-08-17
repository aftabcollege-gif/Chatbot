"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { FileText, Brain, ExternalLink } from "lucide-react";
import type { Source } from "@/types/chat";

interface SourcesPanelProps {
  sources: Source[];
  className?: string;
}

export function SourcesPanel({ sources, className }: SourcesPanelProps) {
  if (!sources.length) return null;

  return (
    <div className={cn("space-y-2", className)}>
      <h4 className="text-sm font-medium text-gray-400 mb-3">منابع استفاده شده:</h4>
      <div className="space-y-2">
        {sources.map((source, i) => (
          <div
            key={source.id || i}
            className="flex items-start gap-3 p-3 rounded-xl bg-[#17211D] border border-white/10 hover:border-emerald-500/30 transition-colors"
          >
            <div className="shrink-0 mt-0.5">
              {source.type === "document" ? (
                <FileText size={16} className="text-blue-400" />
              ) : (
                <Brain size={16} className="text-emerald-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                [منبع {i + 1}] {source.title}
              </p>
              {source.snippet && (
                <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                  {source.snippet}
                </p>
              )}
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                {source.pageNumber && <span>صفحه {source.pageNumber}</span>}
                {source.section && <span>{source.section}</span>}
                <span>
                  {Math.round(source.relevanceScore * 100)}% تطابق
                </span>
              </div>
            </div>
            <ExternalLink size={14} className="text-gray-500 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
