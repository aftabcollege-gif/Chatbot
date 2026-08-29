import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, BookOpen, CheckCircle2, Clock, FileQuestion } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { Select } from "@/components/ui/select";
import { relativeTime, toPersianDigits } from "@/lib/persian";
import type { KnowledgeItem } from "@/types";

const STATUS: Record<string, { label: string; variant: "default" | "success" | "warning" | "secondary" }> = {
  DRAFT: { label: "پیش‌نویس", variant: "secondary" },
  UNDER_REVIEW: { label: "در حال بررسی", variant: "warning" },
  PUBLISHED: { label: "منتشرشده", variant: "success" },
  REJECTED: { label: "رد شده", variant: "default" },
  ARCHIVED: { label: "بایگانی", variant: "secondary" },
};

export function KnowledgePage() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/knowledge", { params: { status: status || undefined, limit: 50 } })
      .then((r) => setItems(r.data.items))
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <div className="h-full flex flex-col">
      <div className="h-14 border-b flex items-center justify-between px-6">
        <div>
          <h2 className="font-semibold">دانش سازمانی</h2>
          <p className="text-xs text-muted-foreground">تجربیات و درس‌آموخته‌ها</p>
        </div>
        <div className="flex gap-2">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="">همه وضعیت‌ها</option>
            <option value="DRAFT">پیش‌نویس</option>
            <option value="UNDER_REVIEW">در حال بررسی</option>
            <option value="PUBLISHED">منتشرشده</option>
          </Select>
          <Link to="/knowledge/new">
            <Button>
              <Plus className="h-4 w-4" /> تجربه جدید
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="text-center text-muted-foreground py-16">در حال بارگذاری...</div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="هنوز تجربه‌ای ثبت نشده"
            description="تجربیات و راه‌حل‌های مشکلات را ثبت کنید تا با جستجو در دسترس همکاران قرار گیرد."
            action={
              <Link to="/knowledge/new">
                <Button>
                  <Plus className="h-4 w-4" /> ثبت تجربه جدید
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 max-w-4xl">
            {items.map((item) => {
              const st = STATUS[item.status] || STATUS.DRAFT;
              return (
                <Link key={item.id} to={`/knowledge/${item.id}`}>
                  <Card className="hover:shadow-md transition-shadow cursor-pointer">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <h3 className="font-semibold">{item.title}</h3>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </div>
                      {item.subject && <p className="text-sm text-muted-foreground mb-2">{item.subject}</p>}
                      <p className="text-sm line-clamp-2 mb-3">{item.lesson_learned}</p>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex gap-2 flex-wrap">
                          {item.tags.slice(0, 4).map((t) => (
                            <span key={t} className="bg-muted px-2 py-0.5 rounded">#{t}</span>
                          ))}
                        </div>
                        <span>{relativeTime(item.updated_at)}</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
