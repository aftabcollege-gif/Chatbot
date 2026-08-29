import { useEffect, useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";

export function RolesPage() {
  const [roles, setRoles] = useState<any[]>([]);
  const [perms, setPerms] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", permissions: [] as string[] });

  async function load() {
    const [r, p] = await Promise.all([
      api.get("/admin/roles"),
      api.get("/admin/permissions"),
    ]);
    setRoles(r.data.roles);
    setPerms(p.data.permissions);
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!form.name) return toast.error("نام نقش الزامی است.");
    await api.post("/admin/roles", form);
    toast.success("نقش ساخته شد.");
    setOpen(false);
    setForm({ name: "", description: "", permissions: [] });
    load();
  }

  async function remove(id: string) {
    if (!confirm("حذف نقش؟")) return;
    try {
      await api.delete(`/admin/roles/${id}`);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "خطا");
    }
  }

  function togglePerm(code: string) {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(code)
        ? f.permissions.filter((c) => c !== code)
        : [...f.permissions, code],
    }));
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">نقش‌ها و دسترسی‌ها</h2>
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> نقش جدید</Button>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {roles.map((role) => (
            <Card key={role.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{role.name}</span>
                    {role.is_system ? <Badge variant="secondary">سیستمی</Badge> : null}
                  </div>
                  {!role.is_system && (
                    <button onClick={() => remove(role.id)} className="text-destructive p-1 rounded hover:bg-destructive/10">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {role.description && <p className="text-sm text-muted-foreground mb-2">{role.description}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {role.permissions.map((p: string) => (
                    <span key={p} className="text-xs bg-muted px-2 py-0.5 rounded">{p}</span>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>نقش جدید</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>نام نقش</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>توضیحات</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>دسترسی‌ها</Label>
              <div className="grid grid-cols-2 gap-2 border rounded-lg p-3 max-h-64 overflow-y-auto">
                {perms.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.permissions.includes(p.code)}
                      onChange={() => togglePerm(p.code)}
                    />
                    <span>{p.description || p.code}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>انصراف</Button>
            <Button onClick={create}>ایجاد</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
