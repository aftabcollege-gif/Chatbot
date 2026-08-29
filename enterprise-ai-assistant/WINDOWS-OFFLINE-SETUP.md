# ساخت نصب‌کنندهٔ ویندوز کاملاً آفلاین (setup.exe)

این راهنما توضیح می‌دهد چطور یک **`setup.exe`** برای نصب «دستیار هوشمند سازمانی» روی
**ویندوز ۱۰ به بالا** بسازید، به‌گونه‌ای که روی ماشین‌های هدف **بدون اینترنت** و
**بدون اجازهٔ نصب برنامهٔ کمکی** کاملاً کار کند.

## ۱. اصل مهم: همهٔ پیش‌نیازها داخل setup.exe هستند

ماشین‌های هدف نه اینترنت دارند و نه اجازهٔ نصب نرم‌افزار جانبی. بنابراین تمام
پیش‌نیازها **در حین نصب** و به‌صورت **بی‌صدا (silent)** تأمین می‌شوند:

| پیش‌نیاز | در کدام پوسته | نحوهٔ تأمین |
|---|---|---|
| **Visual C++ Redistributable 2015–2022 (x64)** | Electron و Tauri | به‌صورت `vc_redist.x64.exe` (نصب‌کنندهٔ کاملاً آفلاین) **داخل خود setup.exe** قرار گرفته و با `/install /quiet /norestart` نصب می‌شود. |
| **Microsoft Edge WebView2 Runtime** | فقط Tauri | بکاند/فرانت Tauri به آن نیاز دارند. برای نصب آفلاین از **Evergreen Standalone (آفلاین)** استفاده می‌شود — نه Bootstrapper آنلاین (`LinkId=2124703`) که در حین نصب از اینترنت دانلود می‌کند. |
| **WebView2 برای Electron** | — | **نیازی نیست**؛ Electron مرورگر Chromium خودش را همراه دارد. |
| **مدل LLM (Qwen2.5-1.5B)، embedding و reranker (BGE-M3)** | هر دو | به‌صورت فایل‌های محلی (`models/`, `llm/`) داخل نصب‌کننده باندل می‌شوند. در نبود مدل، برنامه به‌صورت برون‌خط به حالت «پاسخ استخراجی» تنزل می‌کند. |
| **افزونهٔ sqlite-vec** | هر دو | فایل `sqlite_vec.dll` در `extensions/` باندل می‌شود. |

همهٔ سرویس‌ها فقط روی `127.0.0.1` گوش می‌دهند؛ بدون تله‌متری و بدون هیچ تماس
خروجی. یعنی پس از نصب، برنامه کاملاً برون‌خط کار می‌کند.

## ۲. چه تغییراتی برای «کاملاً آفلاین» اعمال شد

- بکاندِ فریز (PyInstaller) حالا با `EAI_ROOT`/`EAI_FRONTEND_DIST` می‌تواند
  پوشهٔ `config/`, `frontend/dist`, `models/`, `llm/`, `extensions/` را از پوشهٔ
  منابع باندل‌شده پیدا کند (پوستهٔ Electron این متغیر را هنگام اجرا ست می‌کند).
- نصب‌کنندهٔ Electron، VC++ Redistributable را از `extraResources` داخل
  خود installer باندل کرده و بی‌صدا نصب می‌کند؛ Bootstrapper آنلاین WebView2 حذف شد.
- فایل‌های آیکون ویندوز (Electron build, Tauri icons, Inno assets) و
  `desktop-electron/package-lock.json` (که مرحلهٔ کش CI به آن نیاز دارد) اضافه شدند.

## ۳. ساخت setup.exe

> برای ساختن یک `.exe` واقعیِ ویندوز به یک محیط **ویندوزی** یا‌ **GitHub Actions**
> نیاز است (نسخه‌ی بکاند باید با PyInstaller روی ویندوز کامپایل شود؛ از لینوکس
> امکان cross-compile نیست). این مخزن هر دو مسیر را آماده کرده است.

### گزینهٔ A — ساخت در GitHub Actions (بدون نیاز به ویندوز محلی)

روی ریشهٔ مخزن، فایل‌های workflow باید در `.github/workflows/` قرار بگیرند تا
GitHub آنها را اجرا کند (اکنون فقط نسخهٔ درون `enterprise-ai-assistant/.github/`
است). اسکریپت زیر این کار را خودکار انجام می‌دهد و سپس روی رانرهای ویندوزی گیت‌هاب
نصب‌کننده را می‌سازد و `setup.exe` را برمی‌گرداند:

```powershell
# یک‌بار: ورود با توکنی که دسترسی «workflows» دارد
gh auth login

# مدل سبک ۱.۵B (پیش‌فرض، ~1GB، مناسب سیستم ۸ گیگ)
powershell -ExecutionPolicy Bypass -File enterprise-ai-assistant\scripts\build-on-github.ps1

# مدل قوی ۷B (برای ۱۶ گیگ+)
powershell -ExecutionPolicy Bypass -File enterprise-ai-assistant\scripts\build-on-github.ps1 -Model 7b
```

خروجی در `release/` شامل:
- `EnterpriseAI-Setup-1.5b/setup.exe` (نصب‌کنندهٔ NSIS)
- `EnterpriseAI-Setup-1.5b/EnterpriseAI.msi`
- `Enterprise-AI-Assistant-Setup-1.5b.zip` (باندل کامل + پیش‌نیازها + README/LICENSE)

> **نکتهٔ مهم (دسترسی):** برای اینکه اسکریپت بتواند workflow را به ریشهٔ مخزن
> اضافه و push کند، توکن/اکانت باید **`workflows: write`** داشته باشد. اکانت
> خودکارِ ساخت PR ممکن است این دسترسی را نداشته باشد و push رد شود. در این صورت
> workflowها را دستی در `.github/workflows/` قرار دهید (همان دو فایل
> `build-windows.yml` و `tauri.yml` از `enterprise-ai-assistant/.github/workflows/`)
> و سپس از تب **Actions → Build Windows Installer → Run workflow** اجرا کنید.

### گزینهٔ B — ساخت محلی روی ویندوز (پوستهٔ Electron، بدون نیاز به Rust)

روی یک ماشین ویندوزی با Python 3.11 و Node 20+:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\download-models.ps1
powershell -ExecutionPolicy Bypass -File scripts\download-prerequisites.ps1
powershell -ExecutionPolicy Bypass -File scripts\build-electron.ps1
```

خروجی: `dist\Enterprise-AI-Assistant-Setup-Electron.zip` و
`dist-electron\EnterpriseAI-Setup-1.0.0.exe`.

### گزینهٔ C — ساخت محلی روی ویندوز (پوستهٔ Tauri + Inno Setup)

به Rust و Inno Setup 6 نیاز دارد:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\download-models.ps1
powershell -ExecutionPolicy Bypass -File scripts\download-prerequisites.ps1
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

## ۴. روی ماشین هدف (نصب بدون اینترنت)

فقط فایل `setup.exe` (یا `EnterpriseAI.msi`) را روی ماشینِ بدون اینترنت کپی و
اجرا کنید؛ نصب با دسترسی ادمین انجام می‌شود و پیش‌نیازها (VC++ و در صورت نیاز
WebView2 آفلاین) را خودش نصب می‌کند. پس از نصب، برنامه از منوی استارت یا آیکون
دسکتاپ اجرا می‌شود و از طریق «جادوگر راه‌اندازی» ابتدا ادمین و سازمان ساخته می‌شود.

> **حداقل سخت‌افزار:** ۸ گیگابایت رم برای مدل ۱.۵B (پیشنهادی). مدل ۷B برای
> سیستم‌های ۱۶ گیگ+.
