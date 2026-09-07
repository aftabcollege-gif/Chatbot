# ساخت Setup ویندوز — چت‌بات سازمانی آفلاین

این پوشه همهٔ چیزهایی را دارد که برای تولید فایل نصب زیر لازم است:

```text
Chatbot-Organizational-Offline-Setup.exe        (+ Setup-1.bin … فقط اگر حجم > ~4GB باشد)
Chatbot-Organizational-Offline-Setup.exe.sha256
```

نصب‌کننده **کاملاً خودکفا** است: Node.js قابل‌حمل، build تولیدی Next.js،
وابستگی‌های Windows x64، پایگاه‌دادهٔ PGlite + pgvector، مدل زبانی
(Qwen2.5‑1.5B GGUF)، مدل embedding (bge‑m3)، دادهٔ OCR فارسی/انگلیسی و
poppler (برای PDF اسکن‌شده). رایانهٔ مقصد به اینترنت، Node.js، PostgreSQL یا
هیچ نصب دیگری نیاز ندارد.

| فایل | نقش |
| --- | --- |
| `build-installer.ps1` | اسکریپت اصلی: دانلود runtime و poppler، staging، تست دود، کامپایل installer |
| `stage-bundle.cjs` | مونتاژ پوشهٔ نهایی (`release\app`) — چند‌سکویی، همان چیزی که CI روی لینوکس هم تست می‌کند |
| `prune-node-modules.cjs` | فقط بسته‌های production و باینری‌های Windows x64 را از روی `package-lock.json` نگه می‌دارد (بدون dev tools، بدون باینری لینوکس/CUDA) |
| `smoke-test.cjs` | بستهٔ stage شده را با پایگاه‌دادهٔ موقت بالا می‌آورد و ۱۶ بررسی پایه انجام می‌دهد |
| `api-regression.cjs` | مجموعهٔ کامل رگرسیون (۶۳ بررسی): ورود، بارگذاری، پردازش، جست‌وجو، چت استریم، گردش دانش/تجربه، RBAC، واردکردن پوشه، …  |
| `installer.iss` | تعریف Inno Setup 6.5+ (پیش‌فرض؛ محدودیت حجم ندارد، رابط فارسی با `Farsi.isl`) |
| `installer.nsi` | تعریف NSIS (فقط برای نسخهٔ سبک بدون مدل؛ NSIS بیش از ۲GB نمی‌سازد) |
| `portable-installer.workflow.yml` | workflow آمادهٔ GitHub Actions (بخش «روش ۱») |

## روش ۱ — GitHub Actions (توصیه‌شده)

> **فعال‌سازی (یک بار):** فایل workflow به‌دلیل محدودیت دسترسی، در این پوشه قرار
> گرفته است و باید به مسیر استاندارد GitHub منتقل شود:
>
> ```bash
> git mv portable_setup/portable-installer.workflow.yml .github/workflows/portable-installer.yml
> git commit -m "ci: enable portable installer workflow" && git push
> ```

workflow `portable-installer.yml`:

1. روی **ubuntu**: `npm ci` → typecheck → `next build` → staging → تست دود → رگرسیون API؛
2. روی **windows-2022**: `npm ci` (باینری‌های ویندوز) → دانلود مدل‌ها (با cache) →
   `next build` → `build-installer.ps1` (runtime + poppler + staging + تست دود با همان
   `node.exe` بسته‌بندی‌شده + Inno Setup) → آپلود artifact → انتشار در **GitHub Release**.

اجرا:

- زدن تگ: `git tag portable-v1.2.0 && git push origin portable-v1.2.0` → Release با همان نام؛ یا
- تب **Actions → Build portable Windows installer → Run workflow** (گزینه‌ها: بسته‌بندی مدل‌ها،
  انتشار در Release `portable-latest`، اجرای تست‌ها).

خروجی‌های Release: `*.exe`، `*.bin` (در صورت وجود)، `SHA256SUMS.txt`، `README-Setup.md`.

## روش ۲ — ساخت دستی روی ویندوز

پیش‌نیاز: Windows 10/11 x64، Node.js 20+، Git، **Inno Setup 6.5+** (`iscc.exe` در PATH)
— یا NSIS 3 فقط برای نسخهٔ بدون مدل.

```powershell
git clone https://github.com/aftabcollege-gif/Chatbot.git
cd Chatbot
npm ci
node scripts\install-model.mjs          # LLM + embedding + OCR (≈ 1.8 GB)
npm run build
powershell -ExecutionPolicy Bypass -File .\portable_setup\build-installer.ps1
```

پارامترهای مفید:

| پارامتر | توضیح |
| --- | --- |
| `-SkipModels` | ساخت نسخهٔ سبک (بدون GGUF)؛ برنامه در حالت جست‌وجوی کلیدواژه‌ای + پاسخ استخراجی کار می‌کند و بعداً می‌توان مدل‌ها را در `models\` کپی کرد |
| `-Packager inno|nsis|none` | انتخاب کامپایلر (`none` فقط staging می‌کند) |
| `-NodeVersion 22.12.0` | نسخهٔ Node.js قابل‌حمل (از nodejs.org با بررسی SHA‑256) |
| `-Gpu` | نگه‌داشتن باینری‌های CUDA/Vulkan (+≈600MB) |
| `-SkipSmokeTest` | رد کردن تست دود (توصیه نمی‌شود) |
| `-Version 1.2.0` | نسخهٔ درج‌شده در installer (پیش‌فرض: `PORTABLE_VERSION` یا `package.json`) |

خروجی در همین پوشه ساخته می‌شود؛ `release\` و فایل‌های `.exe/.bin` در `.gitignore` هستند.

## آنچه نصب می‌شود

- مسیر: `%LOCALAPPDATA%\ChatbotOrganizationalOffline` (نصب برای کاربر جاری، بدون UAC)
- میانبر Start Menu و Desktop → `portable_bild\Start-Portable.bat`
- اولین اجرا: `.env` با کلیدهای تصادفی ساخته می‌شود، پایگاه‌داده در `storage\database`
  ایجاد و مهاجرت‌ها اعمال می‌شود، مرورگر روی `http://localhost:3800` باز می‌شود.
- **حذف برنامه** فقط فایل‌های برنامه را پاک می‌کند؛ `storage\` (پایگاه‌داده و فایل‌ها) و `.env`
  حفظ می‌شوند. **ارتقا** با اجرای Setup جدید روی نسخهٔ قبلی انجام می‌شود: `.next` و
  `node_modules` قدیمی جایگزین و داده‌ها حفظ می‌شوند؛ مهاجرت‌های جدید در اولین اجرا خودکار
  اعمال می‌شوند (از جمله بازسازی ایندکس کلیدواژه‌ای در صورت تغییر نسخهٔ tokenizer).

## حساب نخستین ورود

نام کاربری `admin` و رمز `ChangeMe123!`. این رمز فقط برای ورود اول است و باید بلافاصله
تغییر کند.

## عیب‌یابی

| نشانه | علت / راه‌حل |
| --- | --- |
| پنجرهٔ سیاه با «embedded Node.js runtime is missing» | فقط `Start-Portable.bat` کپی شده؛ Setup را دوباره اجرا کنید |
| `/api/health` مقدار `ok:false` و `migrations.status:"failed"` | پوشهٔ نصب ناقص است یا `storage\database` قابل نوشتن نیست؛ لاگ پنجرهٔ سیاه را ببینید |
| «LLM model file not found» در داشبورد | نسخهٔ سبک نصب شده؛ `models\llm\model.gguf` و `models\embeddings\model.gguf` را کپی و برنامه را دوباره اجرا کنید (یا `node scripts\install-model.mjs` روی ماشین آنلاین) |
| PDF اسکن‌شده متن ندارد | `portable_bild\poppler\bin\pdftoppm.exe` موجود نیست (دانلود poppler هنگام ساخت ناموفق بوده) |
| پورت ۳۸۰۰ اشغال است | در `.env` مقدار `PORT` را عوض کنید |
| دسترسی از رایانه‌های دیگر شبکه | در `.env` مقدار `PORTABLE_HOSTNAME=0.0.0.0` و باز کردن پورت در فایروال |
