import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, User, Check, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";

export function SetupPage() {
  const [step, setStep] = useState(1);
  const [admin, setAdmin] = useState({ name: "", email: "", username: "", password: "" });
  const [org, setOrg] = useState({ name: "", description: "", departments: "فناوری اطلاعات\nمنابع انسانی\nمالی" });
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submitAdmin() {
    if (admin.password.length < 6) return toast.error("رمز باید حداقل ۶ کاراکتر باشد.");
    setBusy(true);
    try {
      await api.post("/setup/admin", admin);
      setStep(2);
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "خطا در ثبت مدیر.");
    } finally {
      setBusy(false);
    }
  }

  async function submitOrg() {
    setBusy(true);
    try {
      await api.post("/setup/organization", {
        name: org.name,
        description: org.description,
        departments: org.departments.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      await api.post("/setup/complete");
      setStep(3);
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "خطا در ثبت سازمان.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-background p-4">
      <Card className="w-full max-w-lg animate-fade-in">
        <CardContent className="p-8">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-xl font-bold">راه‌اندازی اولیه</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className={step >= 1 ? "text-primary font-semibold" : ""}>۱</span>
              <div className="w-8 h-px bg-border" />
              <span className={step >= 2 ? "text-primary font-semibold" : ""}>۲</span>
              <div className="w-8 h-px bg-border" />
              <span className={step >= 3 ? "text-primary font-semibold" : ""}>۳</span>
            </div>
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <User className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">ایجاد حساب مدیر سیستم</h2>
              </div>
              <div className="space-y-2">
                <Label>نام و نام خانوادگی</Label>
                <Input value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>ایمیل</Label>
                <Input type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>نام کاربری</Label>
                <Input value={admin.username} onChange={(e) => setAdmin({ ...admin, username: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>رمز عبور</Label>
                <Input type="password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} required />
              </div>
              <Button onClick={submitAdmin} className="w-full" disabled={busy || !admin.name || !admin.username || !admin.email || !admin.password}>
                {busy ? <Spinner /> : "ادامه"}
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <Building2 className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">اطلاعات سازمان</h2>
              </div>
              <div className="space-y-2">
                <Label>نام سازمان</Label>
                <Input value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} autoFocus required />
              </div>
              <div className="space-y-2">
                <Label>توضیحات</Label>
                <Input value={org.description} onChange={(e) => setOrg({ ...org, description: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>دپارتمان‌ها (هر کدام در یک خط)</Label>
                <textarea
                  className="flex min-h-[100px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={org.departments}
                  onChange={(e) => setOrg({ ...org, departments: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep(1)} disabled={busy}>
                  <ArrowLeft className="h-4 w-4" /> قبلی
                </Button>
                <Button onClick={submitOrg} className="flex-1" disabled={busy || !org.name}>
                  {busy ? <Spinner /> : "تکمیل راه‌اندازی"}
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="text-center py-6 space-y-4">
              <div className="h-16 w-16 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
                <Check className="h-8 w-8 text-emerald-500" />
              </div>
              <h2 className="text-xl font-bold">راه‌اندازی با موفقیت انجام شد!</h2>
              <p className="text-sm text-muted-foreground">اکنون می‌توانید با حساب مدیر وارد شوید.</p>
              <Button onClick={() => navigate("/login")} className="w-full">
                ورود به سیستم
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
