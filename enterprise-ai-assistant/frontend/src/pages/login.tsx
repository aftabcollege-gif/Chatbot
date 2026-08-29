import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, Lock, User as UserIcon, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/store/auth";
import { toast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const { login, loading } = useAuth();
  const navigate = useNavigate();

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
