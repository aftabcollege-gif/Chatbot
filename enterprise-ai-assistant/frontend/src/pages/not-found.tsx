import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="min-h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="text-6xl font-bold text-primary">۴۰۴</div>
      <h1 className="text-xl font-semibold">صفحه یافت نشد</h1>
      <p className="text-muted-foreground text-sm">صفحه‌ای که دنبالش بودید وجود ندارد.</p>
      <Link to="/chat"><Button>بازگشت به گفتگو</Button></Link>
    </div>
  );
}
