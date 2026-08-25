import { useEffect, useState } from "react";
import { Download, Search } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toJalaliDateTime, toPersianDigits } from "@/lib/persian";

export function LogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState("");
  const [eventType, setEventType] = useState("");
  const [answer, setAnswer] = useState("");

  async function load() {
    const res = await api.get("/admin/logs", {
      params: { event_type: eventType || undefined, limit: 200 },
    });
    setLogs(res.data.logs);
    setTotal(res.data.total);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventType]);

  async function askNl() {
    if (!filter.trim()) return;
    const res = await api.post("/admin/logs/query", { question: filter });
    setAnswer(res.data.answer);
    setLogs(res.data.data);
    setTotal(res.data.data.length);
  }

  function exportCsv() {
    const token = localStorage.getItem("eai_access_token");
    fetch("/api/admin/logs/export?format=csv", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((b) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = "audit-logs.csv";
        a.click();
      });
  }

  const filtered = filter
    ? logs.filter((l) => JSON.stringify(l).toLowerCase().includes(filter.toLowerCase()))
    : logs;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">لاگ‌های حسابرسی</h2>
          <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4" /> خروجی CSV</Button>
        </div>

        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium mb-2">پرسش طبیعی از لاگ‌ها</p>
            <div className="flex gap-2">
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && askNl()}
                placeholder="مثال: خطاهای امروز / ورودهای هفته / فعالیت‌های اسناد"
              />
              <Select value={eventType} onChange={(e) => setEventType(e.target.value)} className="w-44">
                <option value="">همه رویدادها</option>
                <option value="auth">احراز هویت</option>
                <option value="document">اسناد</option>
                <option value="knowledge">دانش</option>
                <option value="admin">مدیریتی</option>
              </Select>
              <Button onClick={askNl}><Search className="h-4 w-4" /></Button>
            </div>
            {answer && <p className="text-sm mt-3 text-primary bg-primary/5 rounded-lg p-3">{answer}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr className="text-muted-foreground">
                    <th className="text-start p-3 font-medium">زمان</th>
                    <th className="text-start p-3 font-medium">رویداد</th>
                    <th className="text-start p-3 font-medium">کاربر</th>
                    <th className="text-start p-3 font-medium">منبع</th>
                    <th className="text-start p-3 font-medium">شناسه</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => (
                    <tr key={l.id} className="border-b last:border-0 hover:bg-accent/40">
                      <td className="p-3 text-xs whitespace-nowrap">{toJalaliDateTime(l.created_at)}</td>
                      <td className="p-3"><Badge variant="outline">{l.event_code}</Badge></td>
                      <td className="p-3">{l.actor_name || "—"}</td>
                      <td className="p-3 text-muted-foreground">{l.resource_type || "—"}</td>
                      <td className="p-3 text-xs text-muted-foreground font-mono">{(l.resource_id || "").slice(0, 12)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">نمایش {toPersianDigits(filtered.length)} از {toPersianDigits(total)} رخداد</p>
      </div>
    </div>
  );
}
