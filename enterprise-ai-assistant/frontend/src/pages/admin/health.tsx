import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Activity, Database, Cpu, HardDrive } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/utils";
import { toPersianDigits } from "@/lib/persian";

export function HealthPage() {
  const [h, setH] = useState<any>(null);
  useEffect(() => {
    const load = () => api.get("/admin/system/health").then((r) => setH(r.data));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (!h) return <div className="p-8 text-center text-muted-foreground">در حال بررسی...</div>;

  const services = [
    { label: "پایگاه داده", value: h.services?.database, detail: h.database ? `${h.database.size_mb} MB` : "" },
    { label: "LLM", value: h.services?.llm, detail: "" },
    { label: "Embedding", value: h.services?.embedding_backend, detail: `ابعاد ${toPersianDigits(h.embedding?.dimension || 0)}` },
    { label: "Reranker", value: h.services?.reranker_backend, detail: "" },
    { label: "افزونه برداری", value: h.services?.vector_extension, detail: "" },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" /> سلامت سیستم
        </h2>

        <div className="grid md:grid-cols-3 gap-4">
          <Stat icon={Database} label="حجم دیتابیس" value={`${h.database?.size_mb ?? 0} MB`} />
          <Stat icon={HardDrive} label="فضای ذخیره اسناد" value={`${h.storage?.used_mb ?? 0} MB`} />
          <Stat icon={Cpu} label="مدت روشن بودن" value={`${toPersianDigits(Math.round(h.uptime_seconds / 60))} دقیقه`} />
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {services.map((s) => {
            const ok = s.value === "ok" || s.value === "lexical" || s.value === "hash";
            return (
              <Card key={s.label}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{s.label}</div>
                    <div className="text-xs text-muted-foreground">{s.detail || s.value}</div>
                  </div>
                  {ok ? (
                    <Badge variant="success"><CheckCircle2 className="h-3 w-3 ms-1" /> {s.value}</Badge>
                  ) : (
                    <Badge variant="warning"><AlertTriangle className="h-3 w-3 ms-1" /> {s.value}</Badge>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-5 flex items-center gap-4">
        <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
