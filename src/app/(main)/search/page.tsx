"use client";

import { useState } from "react";

interface SearchResult {
  id: string;
  title: string;
  content: string;
  sourceType: "document" | "knowledge" | "experience";
  relevanceScore: number;
  combinedScore?: number;
  excerpt?: string;
  pageNumber?: number;
  section?: string;
}

const SOURCE_LABELS: Record<string, { label: string; icon: string; className: string }> = {
  document: { label: "سند", icon: "📄", className: "source-document" },
  knowledge: { label: "دانش", icon: "📚", className: "source-knowledge" },
  experience: { label: "تجربه کارکنان", icon: "💡", className: "source-experience" },
};

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setSearched(true);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 20 }),
      });
      if (res.ok) {
        const data = await res.json() as { results: SearchResult[]; latencyMs: number };
        setResults(data.results ?? []);
        setLatencyMs(data.latencyMs);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-white mb-1">جستجو در منابع سازمانی</h1>
          <p className="text-slate-400 text-sm">
            جستجوی هوشمند در اسناد، دانش‌نامه و تجربیات سازمانی
          </p>
        </div>

        <form onSubmit={handleSearch} className="mb-6">
          <div className="flex gap-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجو در تمام منابع سازمانی..."
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm"
              style={{ direction: "rtl" }}
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-6 py-3 rounded-xl transition-colors text-sm font-medium"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
              ) : (
                "🔍 جستجو"
              )}
            </button>
          </div>
        </form>

        {searched && !loading && (
          <div className="mb-4 text-slate-500 text-sm flex items-center gap-2">
            <span>{results.length} نتیجه یافت شد</span>
            {latencyMs !== null && (
              <span>({latencyMs}ms)</span>
            )}
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-slate-800 border border-slate-700 rounded-xl p-4 animate-pulse"
              >
                <div className="h-4 bg-slate-700 rounded w-1/3 mb-2" />
                <div className="h-3 bg-slate-700 rounded w-full mb-1" />
                <div className="h-3 bg-slate-700 rounded w-2/3" />
              </div>
            ))}
          </div>
        )}

        {searched && !loading && results.length === 0 && (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-slate-400">نتیجه‌ای یافت نشد</p>
            <p className="text-slate-600 text-sm mt-1">
              اطمینان حاصل کنید اسناد پردازش شده‌اند
            </p>
          </div>
        )}

        <div className="space-y-3">
          {results.map((result) => {
            const source = SOURCE_LABELS[result.sourceType] ?? { label: result.sourceType, icon: "📄", className: "bg-slate-700 text-slate-300" };
            const score = Math.round((result.combinedScore ?? result.relevanceScore) * 100);
            return (
              <div
                key={result.id}
                className="bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-slate-500 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="text-white font-medium text-sm flex-1 truncate">
                    {source.icon} {result.title}
                  </h3>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${source.className}`}>
                      {source.label}
                    </span>
                    <span className="text-xs text-slate-500">{score}٪</span>
                  </div>
                </div>
                <p className="text-slate-400 text-sm leading-relaxed line-clamp-3">
                  {result.excerpt ?? result.content.slice(0, 300)}
                </p>
                {(result.pageNumber || result.section) && (
                  <div className="mt-2 flex gap-3 text-slate-600 text-xs">
                    {result.pageNumber && <span>صفحه {result.pageNumber}</span>}
                    {result.section && <span>{result.section}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
