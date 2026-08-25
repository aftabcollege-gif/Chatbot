import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";

export function KnowledgeNewPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: "",
    subject: "",
    problem_description: "",
    action_taken: "",
    result: "",
    lesson_learned: "",
    suggestion: "",
    visibility: "department",
    tags: "",
  });
  const [saving, setSaving] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(publishAfter = false) {
    if (!form.title || !form.problem_description || !form.action_taken || !form.lesson_learned) {
      toast.error("عنوان، شرح مشکل، اقدام و درس‌آموخته الزامی است.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        tags: form.tags.split(/[،,]/).map((t) => t.trim()).filter(Boolean),
      };
      const res = await api.post("/knowledge", payload);
      if (publishAfter) await api.post(`/knowledge/${res.data.id}/publish`);
      toast.success("تجربه ثبت شد.");
      navigate("/knowledge");
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "خطا در ثبت.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6">
        <h2 className="text-xl font-bold mb-6">ثبت تجربه جدید</h2>
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="space-y-2">
              <Label>عنوان تجربه *</Label>
              <Input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="مثال: رفع خطای اتصال به پایگاه داده" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>موضوع</Label>
                <Input value={form.subject} onChange={(e) => update("subject", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>محدوده دسترسی</Label>
                <Select value={form.visibility} onChange={(e) => update("visibility", e.target.value)}>
                  <option value="private">خصوصی</option>
                  <option value="department">دپارتمان</option>
                  <option value="public">عمومی</option>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>شرح مشکل *</Label>
              <Textarea rows={3} value={form.problem_description} onChange={(e) => update("problem_description", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>اقدام انجام‌شده *</Label>
              <Textarea rows={3} value={form.action_taken} onChange={(e) => update("action_taken", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>نتیجه</Label>
              <Textarea rows={2} value={form.result} onChange={(e) => update("result", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>درس‌آموخته *</Label>
              <Textarea rows={3} value={form.lesson_learned} onChange={(e) => update("lesson_learned", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>پیشنهاد برای آینده</Label>
              <Textarea rows={2} value={form.suggestion} onChange={(e) => update("suggestion", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>برچسب‌ها (با ویرگول)</Label>
              <Input value={form.tags} onChange={(e) => update("tags", e.target.value)} placeholder="شبکه، پایگاه‌داده، خطا" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => navigate(-1)}>انصراف</Button>
              <Button variant="secondary" onClick={() => save(false)} disabled={saving}>ذخیره پیش‌نویس</Button>
              <Button onClick={() => save(true)} disabled={saving}>
                ثبت و انتشار <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
