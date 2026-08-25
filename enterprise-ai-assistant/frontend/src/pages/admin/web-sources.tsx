import { useEffect, useState } from "react";
import { Plus, Globe, Trash2, Play } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { toPersianDigits } from "@/lib/persian";

export function WebSourcesPage() {
  const [sources, setSources] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ domain: "", paths: "/", depth: 2, refresh: 24 });

  async function load() {
    const r = await api.get("/admin/web-sources");
    setSources(r.data.sources);
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!form.domain) return;
    await api.post("/admin/web-sources", {
      domain: form.domain,
      allowed_paths: form.paths.split("\n").map((s) => s.trim()).filter(Boolean),
      crawl_depth: Number(form.depth),
      refresh_hours: Number(form.refresh),
    });
    setOpen(false);
    setForm({ domain: "", paths: "/", depth: 2, refresh: 24 });
    load();
  }

  async function crawl(id: string) {
    const r = await api.post(`/admin/web-sources/${id}/crawl`);
    toast.info(r.data.note || "کراول صف شد.");
  }

  async function remove(id: string) {
    if (!confirm("حذف منبع؟")) return;
    await api.delete(`/admin/web-sources/${id}`);
    load();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">منابع وب مجاز</h2>
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> منبع جدید</Button>
        </div>
        <p className="text-sm text-muted-foreground">
          در حالت کاملاً آفلاین، منابع وب فقط ثبت می‌شوند. کراول هنگام اتصال مجاز اجرا می‌گردد.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          {sources.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-primary" />
                    <span className="font-semibold">{s.domain}</span>
                  </div>
                  <Badge variant={s.is_active ? "success" : "secondary"}>{s.is_active ? "فعال" : "غیرفعال"}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mb-3">
                  عمق: {toPersianDigits(s.crawl_depth)} · بازه: {toPersianDigits(s.refresh_hours)} ساعت · صفحات: {toPersianDigits(s.pages_count || 0)}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => crawl(s.id)}><Play className="h-3.5 w-3.5" /> کراول</Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>منبع وب جدید</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>دامنه</Label><Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="example.com" /></div>
            <div className="space-y-1.5"><Label>مسیرهای مجاز (هر خط)</Label><textarea className="flex min-h-[70px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm" value={form.paths} onChange={(e) => setForm({ ...form, paths: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>عمق کراول</Label><Input type="number" value={form.depth} onChange={(e) => setForm({ ...form, depth: Number(e.target.value) })} /></div>
              <div className="space-y-1.5"><Label>بازه (ساعت)</Label><Input type="number" value={form.refresh} onChange={(e) => setForm({ ...form, refresh: Number(e.target.value) })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>انصراف</Button>
            <Button onClick={create}>افزودن</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
