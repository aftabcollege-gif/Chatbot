import { useEffect, useState } from "react";
import { Plus, Search, Trash2, KeyRound, Ban, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toPersianDigits, relativeTime } from "@/lib/persian";

export function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", username: "", password: "", department_id: "" });

  async function load() {
    const res = await api.get("/admin/users", { params: { search: search || undefined, limit: 100 } });
    setUsers(res.data.users);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function create() {
    try {
      await api.post("/admin/users", {
        ...form,
        department_id: form.department_id || undefined,
      });
      toast.success("کاربر ساخته شد.");
      setOpen(false);
      setForm({ name: "", email: "", username: "", password: "", department_id: "" });
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "خطا");
    }
  }

  async function toggle(id: string) {
    await api.post(`/admin/users/${id}/toggle-status`);
    load();
  }
  async function reset(id: string) {
    const pw = prompt("رمز جدید را وارد کنید (حداقل ۶ کاراکتر):");
    if (!pw) return;
    await api.post(`/admin/users/${id}/reset-password`, { new_password: pw });
    toast.success("رمز بازنشانی شد.");
  }
  async function remove(id: string) {
    if (!confirm("کاربر حذف شود؟")) return;
    await api.delete(`/admin/users/${id}`);
    load();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">مدیریت کاربران</h2>
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> کاربر جدید</Button>
        </div>
        <div className="relative max-w-sm">
          <Search className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجو..." className="pe-9" />
        </div>

        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-start text-muted-foreground">
                  <th className="text-start p-3 font-medium">کاربر</th>
                  <th className="text-start p-3 font-medium">نام کاربری</th>
                  <th className="text-start p-3 font-medium">نقش</th>
                  <th className="text-start p-3 font-medium">وضعیت</th>
                  <th className="text-start p-3 font-medium">آخرین ورود</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8"><AvatarFallback>{u.name?.slice(0, 2)}</AvatarFallback></Avatar>
                        <div>
                          <div className="font-medium">{u.name}</div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">{u.username}</td>
                    <td className="p-3">
                      {u.is_superadmin ? <Badge>مدیر سیستم</Badge> : u.roles?.map((r: any) => <Badge key={r.id} variant="secondary">{r.name}</Badge>)}
                    </td>
                    <td className="p-3">
                      {u.is_active ? <Badge variant="success">فعال</Badge> : <Badge variant="destructive">غیرفعال</Badge>}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{relativeTime(u.last_login)}</td>
                    <td className="p-3">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => reset(u.id)} className="p-1.5 rounded hover:bg-accent" title="بازنشانی رمز"><KeyRound className="h-4 w-4" /></button>
                        <button onClick={() => toggle(u.id)} className="p-1.5 rounded hover:bg-accent" title="تغییر وضعیت">
                          {u.is_active ? <Ban className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                        </button>
                        <button onClick={() => remove(u.id)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive" title="حذف"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">مجموع: {toPersianDigits(users.length)} کاربر</p>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>کاربر جدید</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>نام</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>ایمیل</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>نام کاربری</Label><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>رمز عبور</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
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
