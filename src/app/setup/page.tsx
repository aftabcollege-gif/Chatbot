"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    organizationName: "",
    adminName: "",
    adminUsername: "",
    adminEmail: "",
    adminPassword: "",
    adminPasswordConfirm: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (form.adminPassword !== form.adminPasswordConfirm) {
      setError("رمز عبور و تأیید آن یکسان نیستند.");
      return;
    }

    if (form.adminPassword.length < 8) {
      setError("رمز عبور باید حداقل ۸ کاراکتر باشد.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/setup/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName: form.organizationName,
          adminName: form.adminName,
          adminUsername: form.adminUsername,
          adminEmail: form.adminEmail,
          adminPassword: form.adminPassword,
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (res.ok && data.success) {
        setStep(3);
        setTimeout(() => router.push("/login"), 3000);
      } else {
        setError(data.error ?? "خطا در راه‌اندازی");
      }
    } catch {
      setError("خطا در اتصال به سرور");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🧠</span>
          </div>
          <h1 className="text-2xl font-bold text-white">راه‌اندازی سامانه</h1>
          <p className="text-slate-400 mt-2 text-sm">
            سامانه هوش مصنوعی سازمانی آفلاین
          </p>
        </div>

        {step === 3 ? (
          <div className="bg-slate-800 rounded-2xl p-8 text-center border border-slate-700">
            <div className="text-5xl mb-4">✅</div>
            <h2 className="text-xl font-semibold text-white mb-2">
              راه‌اندازی کامل شد
            </h2>
            <p className="text-slate-400 text-sm">
              در حال انتقال به صفحه ورود...
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-slate-800 rounded-2xl p-8 border border-slate-700 space-y-5"
          >
            {/* Step indicator */}
            <div className="flex items-center gap-2 mb-6">
              {[1, 2].map((s) => (
                <div key={s} className="flex-1">
                  <div
                    className={`h-1 rounded-full transition-colors ${
                      s <= step ? "bg-blue-500" : "bg-slate-600"
                    }`}
                  />
                </div>
              ))}
            </div>

            {step === 1 && (
              <>
                <h2 className="text-lg font-semibold text-white">
                  مرحله ۱: اطلاعات سازمان
                </h2>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">
                    نام سازمان <span className="text-red-400">*</span>
                  </label>
                  <input
                    name="organizationName"
                    value={form.organizationName}
                    onChange={handleChange}
                    placeholder="مثال: شرکت برق منطقه‌ای"
                    required
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!form.organizationName.trim()) {
                      setError("نام سازمان الزامی است.");
                      return;
                    }
                    setStep(2);
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-lg font-medium transition-colors"
                >
                  مرحله بعد
                </button>
              </>
            )}

            {step === 2 && (
              <>
                <h2 className="text-lg font-semibold text-white">
                  مرحله ۲: حساب مدیر ارشد
                </h2>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">
                    نام و نام خانوادگی <span className="text-red-400">*</span>
                  </label>
                  <input
                    name="adminName"
                    value={form.adminName}
                    onChange={handleChange}
                    placeholder="نام کامل"
                    required
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">
                    نام کاربری <span className="text-red-400">*</span>
                  </label>
                  <input
                    name="adminUsername"
                    value={form.adminUsername}
                    onChange={handleChange}
                    placeholder="فقط حروف انگلیسی و عدد"
                    pattern="[a-zA-Z0-9_]+"
                    required
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">
                    ایمیل <span className="text-red-400">*</span>
                  </label>
                  <input
                    name="adminEmail"
                    type="email"
                    value={form.adminEmail}
                    onChange={handleChange}
                    placeholder="admin@example.com"
                    required
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">
                    رمز عبور <span className="text-red-400">*</span>
                  </label>
                  <input
                    name="adminPassword"
                    type="password"
                    value={form.adminPassword}
                    onChange={handleChange}
                    placeholder="حداقل ۸ کاراکتر"
                    required
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">
                    تأیید رمز عبور <span className="text-red-400">*</span>
                  </label>
                  <input
                    name="adminPasswordConfirm"
                    type="password"
                    value={form.adminPasswordConfirm}
                    onChange={handleChange}
                    placeholder="رمز عبور را دوباره وارد کنید"
                    required
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                {error && (
                  <p className="text-red-400 text-sm bg-red-900/20 px-3 py-2 rounded-lg">
                    {error}
                  </p>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2.5 rounded-lg font-medium transition-colors"
                  >
                    قبلی
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        در حال راه‌اندازی...
                      </>
                    ) : (
                      "تکمیل راه‌اندازی"
                    )}
                  </button>
                </div>
              </>
            )}
          </form>
        )}

        <p className="text-center text-slate-600 text-xs mt-6">
          سامانه هوش مصنوعی سازمانی — نسخه ۱.۰.۰ — کاملاً آفلاین
        </p>
      </div>
    </div>
  );
}
