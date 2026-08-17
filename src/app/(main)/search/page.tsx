"use client";

import React, { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  FileText,
  Globe,
  Brain,
  MessageSquare,
  Filter,
  Calendar,
  Building2,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getRelativeTime } from "@/lib/persian-date";

interface SearchResult {
  id: string;
  type: "document" | "web" | "knowledge";
  title: string;
  snippet: string;
  pageNumber?: number;
  section?: string;
  department?: string;
  relevanceScore: number;
  createdAt: string;
}

const typeConfig = {
  document: { icon: FileText, label: "سند", color: "text-blue-400 bg-blue-500/20" },
  web: { icon: Globe, label: "وب", color: "text-purple-400 bg-purple-500/20" },
  knowledge: { icon: Brain, label: "تجربه", color: "text-emerald-400 bg-emerald-500/20" },
};

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);

    // Simulate search
    await new Promise((resolve) => setTimeout(resolve, 800));

    setResults([
      {
        id: "1",
        type: "document",
        title: "دستورالعمل نگهداری تجهیزات صنعتی",
        snippet: `... بازرسی دوره‌ای **${query}** باید هر 30 روز انجام شود. این فرآیند شامل بررسی وضعیت فیلترها، روان‌کارها و...`,
        pageNumber: 12,
        section: "بخش 3.4",
        department: "واحد تولید",
        relevanceScore: 0.92,
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "2",
        type: "knowledge",
        title: "تجربه تعمیر پمپ فشار قوی",
        snippet: `... با رعایت نکات مربوط به **${query}** توانستیم مشکل را در مدت کوتاهی برطرف کنیم...`,
        department: "واحد نگهداری",
        relevanceScore: 0.85,
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "3",
        type: "document",
        title: "راهنمای ایمنی کارگاه",
        snippet: `... استفاده از تجهیزات حفاظتی در هنگام کار با **${query}** الزامی است...`,
        pageNumber: 5,
        section: "فصل 2",
        relevanceScore: 0.78,
        createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);

    setIsSearching(false);
  };

  const filteredResults =
    activeFilter === "all"
      ? results
      : results.filter((r) => r.type === activeFilter);

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar title="جستجو" />

      <div className="flex-1 p-6">
        {/* Search Box */}
        <div className="max-w-3xl mx-auto mb-8">
          <form onSubmit={handleSearch}>
            <div className="relative">
              <Search
                size={24}
                className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="جستجو در منابع..."
                className="w-full pl-16 pr-14 py-5 bg-[#17211D] border border-white/10 rounded-2xl text-white text-lg placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
              />
              <Button
                type="submit"
                className="absolute left-3 top-1/2 -translate-y-1/2"
                disabled={isSearching || !query.trim()}
              >
                {isSearching ? "..." : "جستجو"}
              </Button>
            </div>
          </form>

          {/* Filters */}
          <div className="flex items-center gap-4 mt-4">
            <div className="flex gap-2">
              {[
                { id: "all", label: "همه" },
                { id: "document", label: "PDF" },
                { id: "knowledge", label: "تجربیات" },
                { id: "web", label: "وب" },
              ].map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => setActiveFilter(filter.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm transition-colors",
                    activeFilter === filter.id
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "text-gray-400 hover:bg-white/5"
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" className="gap-1">
              <Building2 size={14} />
              واحد
            </Button>
            <Button variant="outline" size="sm" className="gap-1">
              <Calendar size={14} />
              تاریخ
            </Button>
          </div>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="max-w-3xl mx-auto">
            <p className="text-sm text-gray-400 mb-4">
              {filteredResults.length} نتیجه برای «{query}»
            </p>

            <div className="space-y-4">
              {filteredResults.map((result) => (
                <SearchResultCard key={result.id} result={result} />
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!isSearching && results.length === 0 && query && (
          <div className="text-center py-12">
            <Search size={48} className="mx-auto text-gray-600 mb-4" />
            <h3 className="text-white text-lg mb-2">نتیجه‌ای یافت نشد</h3>
            <p className="text-gray-500">
              عبارت دیگری را جستجو کنید یا فیلترها را تغییر دهید
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SearchResultCard({ result }: { result: SearchResult }) {
  const config = typeConfig[result.type];
  const Icon = config.icon;

  return (
    <Card className="p-5 hover:border-emerald-500/30 transition-all group cursor-pointer">
      <div className="flex items-start gap-4">
        <div className={cn("p-2 rounded-lg", config.color)}>
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="default">{config.label}</Badge>
            {result.pageNumber && (
              <span className="text-xs text-gray-500">
                صفحه {result.pageNumber}
                {result.section && ` • ${result.section}`}
              </span>
            )}
          </div>
          <h3 className="text-white font-medium mb-2">{result.title}</h3>
          <p
            className="text-sm text-gray-400 line-clamp-2"
            dangerouslySetInnerHTML={{
              __html: result.snippet.replace(/\*\*(.*?)\*\*/g, '<mark class="bg-emerald-500/30 text-emerald-300 px-0.5 rounded">$1</mark>'),
            }}
          />
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
            {result.department && (
              <span className="flex items-center gap-1">
                <Building2 size={12} />
                {result.department}
              </span>
            )}
            <span>{getRelativeTime(result.createdAt)}</span>
            <span className="flex items-center gap-1">
              <div
                className={cn(
                  "w-2 h-2 rounded-full",
                  result.relevanceScore > 0.8
                    ? "bg-emerald-400"
                    : result.relevanceScore > 0.5
                    ? "bg-yellow-400"
                    : "bg-gray-400"
                )}
              />
              {Math.round(result.relevanceScore * 100)}%
            </span>
          </div>
        </div>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
          <Button variant="ghost" size="sm" className="gap-1">
            <Eye size={14} />
            مشاهده
          </Button>
          <Button variant="ghost" size="sm" className="gap-1">
            <MessageSquare size={14} />
            چت
          </Button>
        </div>
      </div>
    </Card>
  );
}
