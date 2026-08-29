import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/store/auth";
import { toast } from "@/components/ui/toast";
import { toJalaliDateTime, toPersianDigits } from "@/lib/persian";

export function ProfilePage() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [stats, setStats] = useState<any>(null);
  const [passwords, setPasswords] = useState({ current: "", next: "" });

  useEffect(() => {
    api.get("/profile").then((r) => {
      setStats(r.data.stats);
    });
  }, []);

  async function save() {
    const res = await api.patch("/profile", { name });
    setUser(res.data.user);
    toast.success("پروفایل به‌روزرسانی شد.");
  }

  async function changePassword() {
    if (passwords.next.length < 6) return toast.error("رمز جدید حداقل ۶ کاراکتر.");
    await api.post("/auth/change-password", {
      current_password: passwords.current,
      new_password: passwords.next,
    });
    toast.success("رمز تغییر کرد. دوباره وارد شوید.");
    setPasswords({ current: "", next: "" });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <h2 className="text-xl font-bold">پروفایل کاربری</h2>

        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={user?.avatar_url || undefined} />
              <AvatarFallback className="text-lg">{user?.name?.slice(0, 2)}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="font-semibold text-lg">{user?.name}</div>
              <div className="text-sm text-muted-foreground">{user?.email}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {user?.department?.name || "بدون دپارتمان"} · {user?.roles.join("، ") || "کاربر"}
              </div>
            </div>
            <div>
              <Label htmlFor="avatar" className="cursor-pointer">
                <span className="inline-flex h-9 items-center rounded-lg border px-3 text-sm hover:bg-accent">تغییر تصویر</span>
              </Label>
              <input
                id="avatar"
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const form = new FormData();
                  form.append("file", f);
                  const res = await api.post("/profile/avatar", form);
                  setUser({ ...user!, avatar_url: res.data.avatar_url });
                  toast.success("تصویر به‌روزرسانی شد.");
                }}
              />
            </div>
          </CardContent>
        </Card>

        {stats && (
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "گفتگوها", value: stats.conversations },
              { label: "پیام‌ها", value: stats.messages },
              { label: "اسناد", value: stats.documents_uploaded },
              { label: "تجربیات", value: stats.knowledge_items },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-primary">{toPersianDigits(s.value)}</div>
                  <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card>
          <CardHeader><CardTitle>اطلاعات شخصی</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>نام</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button onClick={save}>ذخیره تغییرات</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>تغییر رمز عبور</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>رمز فعلی</Label>
              <Input type="password" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>رمز جدید</Label>
              <Input type="password" value={passwords.next} onChange={(e) => setPasswords({ ...passwords, next: e.target.value })} />
            </div>
            <Button variant="secondary" onClick={changePassword}>تغییر رمز</Button>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">آخرین ورود: {toJalaliDateTime(user?.last_login)}</p>
      </div>
    </div>
  );
}
