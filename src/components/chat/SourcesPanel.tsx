"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Globe,
  Brain,
  ExternalLink,
  ChevronLeft,
  X,
  Eye,
} from "lucide-react";

import type { Source } from "@/types/chat";

interface SourcesPanelProps {
  sources: Source[];
  confidenceScore?: number;
  isOpen: boolean;
  onClose: () => void;
  onSourceClick?: (source: Source) => void;
}

const typeIcons = {
  document: FileText,
  web: Globe,
  knowledge: Brain,
};

const typeLabels = {
  document: "سند",
  web: "وب",
  knowledge: "تجربه",
};

export function SourcesPanel({
  sources,
  confidenceScore,
  isOpen,
  onClose,
  onSourceClick,
}: SourcesPanelProps) {
  if (!isOpen) return null;

  return (
    <div className="w-80 bg-[#111715] border-r border-white/10 h-full overflow-hidden flex flex-col animate-slide-up">
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <h3 className="font-semibold text-white flex items-center gap-2">
          <FileText size={18} className="text-emerald-400" />
          منابع ({sources.length})
        </h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X size={18} />
        </Button>
      </div>

      {/* Confidence Score */}
      {confidenceScore !== undefined && (
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-gray-400">میزان اطمینان</span>
            <span className="text-emerald-400 font-medium">
              {Math.round(confidenceScore * 100)}%
            </span>
          </div>
          <Progress value={confidenceScore * 100} />
        </div>
      )}

      {/* Sources List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {sources.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <FileText size={32} className="mx-auto mb-2 opacity-50" />
            <p>هنوز منبعی یافت نشده</p>
          </div>
        ) : (
          sources.map((source, index) => {
            const Icon = typeIcons[source.type] || FileText;
            return (
              <button
                key={source.id}
                onClick={() => onSourceClick?.(source)}
                className="w-full text-right p-4 bg-[#17211D] rounded-xl border border-white/5 hover:border-emerald-500/30 transition-all group"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "shrink-0 w-8 h-8 rounded-lg flex items-center justify-center",
                      source.type === "document" && "bg-blue-500/20 text-blue-400",
                      source.type === "web" && "bg-purple-500/20 text-purple-400",
                      source.type === "knowledge" && "bg-emerald-500/20 text-emerald-400"
                    )}
                  >
                    <Icon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary" className="text-xs">
                        [{index + 1}]
                      </Badge>
                      <Badge variant="default" className="text-xs">
                        {typeLabels[source.type]}
                      </Badge>
                    </div>
                    <h4 className="text-sm font-medium text-white truncate mb-1">
                      {source.title}
                    </h4>
                    {source.pageNumber && (
                      <p className="text-xs text-gray-500">
                        صفحه {source.pageNumber}
                        {source.section && ` • ${source.section}`}
                      </p>
                    )}
                    {source.snippet && (
                      <p className="text-xs text-gray-400 mt-2 line-clamp-2">
                        {source.snippet}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1">
                        <div
                          className={cn(
                            "w-2 h-2 rounded-full",
                            source.relevanceScore > 0.8
                              ? "bg-emerald-400"
                              : source.relevanceScore > 0.5
                              ? "bg-yellow-400"
                              : "bg-gray-400"
                          )}
                        />
                        <span className="text-xs text-gray-500">
                          {Math.round(source.relevanceScore * 100)}%
                        </span>
                      </div>
                      <span className="text-xs text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                        <Eye size={12} />
                        مشاهده
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
