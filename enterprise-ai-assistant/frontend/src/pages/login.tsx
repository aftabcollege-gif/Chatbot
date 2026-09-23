import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Copy, KeyRound, MessageSquare, Lock, User as UserIcon, Eye, EyeOff } from "lucide-react";
import { API_BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/store/auth";
import { toast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";

type BootstrapInfo = {
  has_admin?: boolean;
  setup_completed?: boolean;
  credentials?: { username: string; password: string } | null;
};

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [info, setInfo] = useState<BootstrapInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const { login, loading } = useAuth();
  const navigate = useNavigate();

  // Credentials generated automatically on first run are shown here once, so
  // an offline installation can never present an unusable login page.
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/setup/bootstrap-info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        setInfo(d);
        if (d.credentials) {
          setUsername((current) => current || d.credentials.username);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function copyPassword() {
    if (!info?.credentials) return;
    try {
      await navigator.clipboard.writeText(info.credentials.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("کپی خودکار ممکن نشد؛ رمز را دستی وارد کنید.");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await login(username.trim(), password);
      navigate("/chat");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "ورود ناموفق بود.");
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-background p-4">
      <Card className="w-full max-w-md animate-fade-in">
        <CardContent className="p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-4">
              <MessageSquare className="h-7 w-7" />
            </div>
            <h1 className="text-2xl font-bold">دستیار هوشمند سازمانی</h1>
            <p className="text-sm text-muted-foreground mt-1">برای ورود اطلاعات حساب خود را وارد کنید</p>
          </div>

          {info?.credentials && (
            <div className="mb-6 rounded-xl border border-primary/40 bg-primary/5 p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold text-primary mb-2">
                <KeyRound className="h-4 w-4" />
                حساب مدیر ساخته شد — این اطلاعات را یادداشت کنید
              </div>
              <div className="space-y-1 font-mono text-xs" dir="ltr">
                <div>username: {info.credentials.username}</div>
                <div>password: {info.credentials.password}</div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => {
                    setUsername(info.credentials!.username);
                    setPassword(info.credentials!.password);
                  }}
                >
                  پر کردن خودکار فرم
                </Button>
                <Button type="button" variant="ghost" className="h-8 text-xs" onClick={copyPassword}>
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  کپی رمز
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                پس از نخستین ورود، از بخش «پروفایل» رمز عبور را تغییر دهید.
                (این اطلاعات در فایل ADMIN-CREDENTIALS.txt هم ذخیره شده است.)
              </p>
            </div>
          )}

          {info && info.has_admin === false && (
            <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
              هنوز حساب مدیری ساخته نشده است.
              <Link to="/setup" className="text-primary underline ms-1">
                اجرای راه‌اندازی اولیه
              </Link>
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">نام کاربری یا ایمیل</Label>
              <div className="relative">
                <UserIcon className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pe-9"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">رمز عبور</Label>
              <div className="relative">
                <Lock className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pe-9 ps-9"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Spinner /> : "ورود"}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground text-center mt-6">
            🔒 تمام پردازش‌ها به‌صورت کاملاً آفلاین روی همین دستگاه انجام می‌شود.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
