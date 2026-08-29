import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";

export function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    api.get("/admin/settings").then((r) => {
      const map: Record<string, string> = {};
      for (const [k, v] of Object.entries<any>(r.data.settings)) map[k] = v.value;
      setSettings(map);
      setForm(map);
    });
  }, []);

  async function save() {
    await api.patch("/admin/settings", { settings: form });
    toast.success("تنظیمات ذخیره شد.");
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-2xl space-y-4">
        <h2 className="text-xl font-bold">تنظیمات سیستم</h2>
        <Card>
          <CardHeader><CardTitle>پیکربندی</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {Object.keys(settings).map((key) => (
              <div key={key} className="space-y-1.5">
                <Label>{key}</Label>
                <Input
                  value={form[key] ?? ""}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </div>
            ))}
            <Button onClick={save}><Save className="h-4 w-4" /> ذخیره</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
