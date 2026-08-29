import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Clock, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useAuth } from "@/store/auth";
import { toJalaliDateTime, toPersianDigits } from "@/lib/persian";
import type { KnowledgeItem } from "@/types";

export function KnowledgeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<KnowledgeItem | null>(null);
  const [loading, setLoading] = useState(true);
  const me = useAuth((s) => s.user);

  useEffect(() => {
    api.get(`/knowledge/${id}`).then((r) => setItem(r.data)).finally(() => setLoading(false));
  }, [id]);

  async function act(path: string) {
    await api.post(`/knowledge/${id}/${path}`);
    toast.success("انجام شد.");
    const r = await api.get(`/knowledge/${id}`);
    setItem(r.data);
  }

  if (loading) return <div className="flex-1 flex items-center justify-center"><Spinner className="h-6 w-6" /></div>;
  if (!item) return <div className="p-8 text-center text-muted-foreground">یافت نشد.</div>;

  const canManage = item.owner_id === me?.id || me?.is_superadmin;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6">
        <Link to="/knowledge" className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block">
          ← بازگشت به فهرست
        </Link>
        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold mb-2">{item.title}</h1>
                {item.subject && <p className="text-muted-foreground">{item.subject}</p>}
              </div>
              <Badge variant={item.status === "PUBLISHED" ? "success" : item.status === "REJECTED" ? "destructive" : "secondary"}>
                {item.status}
              </Badge>
            </div>

            <div className="flex gap-2 flex-wrap">
              {item.tags.map((t) => (
                <span key={t} className="text-xs bg-muted px-2 py-1 rounded">#{t}</span>
              ))}
            </div>

            <Section title="شرح مشکل">{item.problem_description}</Section>
            <Section title="اقدام انجام‌شده">{item.action_taken}</Section>
            {item.result && <Section title="نتیجه">{item.result}</Section>}
            <Section title="درس‌آموخته" highlight>{item.lesson_learned}</Section>
            {item.suggestion && <Section title="پیشنهاد">{item.suggestion}</Section>}

            <div className="text-xs text-muted-foreground border-t pt-4 flex justify-between">
              <span>ثبت: {toJalaliDateTime(item.created_at)}</span>
              <span>به‌روزرسانی: {toJalaliDateTime(item.updated_at)}</span>
            </div>

            {canManage && (
              <div className="flex gap-2 justify-end pt-2">
                {item.status === "DRAFT" && (
                  <Button variant="secondary" onClick={() => act("submit")}>
                    <Clock className="h-4 w-4" /> ارسال برای بررسی
                  </Button>
                )}
                {item.status !== "PUBLISHED" && (
                  <Button onClick={() => act("publish")}>
                    <CheckCircle2 className="h-4 w-4" /> انتشار
                  </Button>
                )}
                <Button
                  variant="destructive"
                  onClick={async () => {
                    if (confirm("حذف شود؟")) {
                      await api.delete(`/knowledge/${id}`);
                      navigate("/knowledge");
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Section({ title, children, highlight }: { title: string; children: React.ReactNode; highlight?: boolean }) {
  return (
    <div>
      <h3 className={`font-semibold mb-1.5 ${highlight ? "text-primary" : ""}`}>{title}</h3>
      <p className="text-sm leading-7 text-foreground/90 whitespace-pre-wrap">{children}</p>
    </div>
  );
}
