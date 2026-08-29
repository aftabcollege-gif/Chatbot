import { useEffect, useState } from "react";
import { Search as SearchIcon, FileText, BookOpen, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { toPersianDigits } from "@/lib/persian";
import type { SearchResult } from "@/types";

export function SearchPage() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [time, setTime] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get("/search", { params: { q, limit: 30 } });
        setResults(res.data.results);
        setTime(res.data.query_time_ms);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-6">
        <h2 className="font-semibold text-lg mb-4">جستجوی پیشرفته</h2>
        <div className="relative max-w-2xl">
          <SearchIcon className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="در تمام اسناد و دانش سازمانی جستجو کنید..."
            className="pe-9 h-11 text-base"
          />
        </div>
        {q && !loading && results.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            {toPersianDigits(results.length)} نتیجه در {toPersianDigits(time)} میلی‌ثانیه
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin ms-2" /> در حال جستجو...
          </div>
        ) : !q ? (
          <EmptyState icon={SearchIcon} title="جستجو در دانش سازمانی" description="کلمه یا عبارتی را وارد کنید تا در اسناد و تجربیات ثبت‌شده جستجو شود." />
        ) : results.length === 0 ? (
          <EmptyState icon={SearchIcon} title="نتیجه‌ای یافت نشد" description="عبارت دیگری را امتحان کنید یا سند مرتبط را بارگذاری کنید." />
        ) : (
          <div className="max-w-3xl space-y-3">
            {results.map((r, i) => (
              <Card key={i} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    {r.type === "knowledge" ? (
                      <BookOpen className="h-4 w-4 text-primary" />
                    ) : (
                      <FileText className="h-4 w-4 text-primary" />
                    )}
                    <span className="font-medium text-sm">{r.title}</span>
                    <Badge variant="secondary" className="me-auto">
                      {r.type === "knowledge" ? "دانش" : "سند"}
                    </Badge>
                    {r.page_number && <span className="text-xs text-muted-foreground">ص {toPersianDigits(r.page_number)}</span>}
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">{r.snippet}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
