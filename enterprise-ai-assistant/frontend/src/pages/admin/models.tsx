import { useEffect, useState } from "react";
import { Cpu, CheckCircle2, AlertTriangle, HardDrive } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/utils";
import { toPersianDigits } from "@/lib/persian";

export function ModelsPage() {
  const [models, setModels] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    api.get("/admin/models").then((r) => setModels(r.data));
    api.get("/health").then((r) => setHealth(r.data));
  }, []);

  if (!models) return <div className="p-8 text-center text-muted-foreground">در حال بارگذاری...</div>;

  const sections = [
    { key: "llm", title: "مدل زبانی (LLM)", data: models.llm, extra: health?.services?.llm },
    { key: "embedding", title: "مدل Embedding", data: models.embedding, extra: health?.services?.embedding_backend },
    { key: "reranker", title: "مدل Reranker", data: models.reranker, extra: health?.services?.reranker_backend },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-4">
        <h2 className="text-xl font-bold">مدل‌ها و موتورهای هوش مصنوعی</h2>
        <p className="text-sm text-muted-foreground">
          تمام مدل‌ها به‌صورت محلی و آفلاین اجرا می‌شوند. هیچ داده‌ای از دستگاه خارج نمی‌شود.
        </p>
        <div className="grid gap-4">
          {sections.map((s) => {
            const exists = s.data.exists;
            return (
              <Card key={s.key}>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-primary" />
                    {s.title}
                  </CardTitle>
                  {exists ? (
                    <Badge variant="success"><CheckCircle2 className="h-3 w-3 ms-1" /> موجود</Badge>
                  ) : (
                    <Badge variant="warning"><AlertTriangle className="h-3 w-3 ms-1" /> بارگذاری نشده</Badge>
                  )}
                </CardHeader>
                <CardContent className="text-sm space-y-1.5">
                  {s.data.model_name && <Row label="مدل" value={s.data.model_name} />}
                  {s.data.backend && <Row label="موتور" value={s.data.backend} />}
                  {s.data.dimension && <Row label="ابعاد" value={toPersianDigits(s.data.dimension)} />}
                  {s.data.context_size && <Row label="اندازه کانتکست" value={toPersianDigits(s.data.context_size)} />}
                  <Row label="مسیر" value={<code className="text-xs font-mono text-muted-foreground break-all">{s.data.model_path}</code>} />
                  <Row label="حجم روی دیسک" value={<span className="flex items-center gap-1"><HardDrive className="h-3 w-3" /> {toPersianDigits(formatBytes(s.data.size_mb * 1024 * 1024))}</span>} />
                  {s.extra && <Row label="وضعیت سرویس" value={s.extra} />}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
