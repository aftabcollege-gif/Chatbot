import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Users, MessageSquare, BookOpen, Activity, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toPersianDigits } from "@/lib/persian";

export function AdminDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [rag, setRag] = useState<any>(null);

  useEffect(() => {
    api.get("/admin/system/stats").then((r) => setStats(r.data));
    api.get("/admin/analytics/rag").then((r) => setRag(r.data));
  }, []);

  const cards = [
    { label: "اسناد", value: stats?.documents || 0, icon: FileText, to: "/resources" },
    { label: "آماده جستجو", value: stats?.ready_documents || 0, icon: Activity, to: "/resources" },
    { label: "کاربران", value: stats?.users || 0, icon: Users, to: "/admin/users" },
    { label: "گفتگوها", value: stats?.conversations || 0, icon: MessageSquare, to: "/chat" },
    { label: "تجربیات", value: stats?.knowledge || 0, icon: BookOpen, to: "/knowledge" },
    { label: "قطعات", value: stats?.chunks || 0, icon: TrendingUp, to: "/admin/models" },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6">
        <h2 className="text-xl font-bold">داشبورد مدیریت</h2>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {cards.map((c) => (
            <Link key={c.label} to={c.to}>
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <c.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{toPersianDigits(c.value)}</div>
                    <div className="text-xs text-muted-foreground">{c.label}</div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {rag && (
          <Card>
            <CardHeader><CardTitle>عملکرد RAG</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <Metric label="کل پرسش‌ها" value={rag.total_queries} />
              <Metric label="پاسخ‌داده‌شده" value={rag.answered} />
              <Metric label="میانگین اطمینان" value={`${toPersianDigits(Math.round((rag.avg_retrieval_score || 0) * 100))}٪`} />
              <Metric label="میانگین زمان (ms)" value={toPersianDigits(rag.avg_response_time_ms)} />
              <Metric label="بازخورد مثبت" value={rag.feedback_positive} />
              <Metric label="بازخورد منفی" value={rag.feedback_negative} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-2xl font-bold">{typeof value === "number" ? toPersianDigits(value) : value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}
