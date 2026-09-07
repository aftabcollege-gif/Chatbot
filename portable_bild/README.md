# نسخهٔ قابل‌حمل / نصبی آفلاین — Windows x64

این پوشه «راه‌انداز» نسخهٔ قابل‌حمل است و عیناً داخل `Setup.exe` قرار می‌گیرد.
خروجی نهایی (`Chatbot-Organizational-Offline-Setup.exe`) توسط workflow
`portable-installer.yml` (پس از فعال‌سازی طبق `portable_setup/README.md`) ساخته و در
**GitHub Release** منتشر می‌شود؛ روش ساخت دستی در [`../portable_setup/README.md`](../portable_setup/README.md)
توضیح داده شده است.

## چه چیزی داخل بسته است؟

| مسیر | محتوا |
| --- | --- |
| `portable_bild\runtime\node.exe` | Node.js 22 قابل‌حمل — نصب Node لازم نیست |
| `.next\`, `node_modules\`, `drizzle\` | build تولیدی Next.js + وابستگی‌های Windows x64 + مهاجرت‌های پایگاه‌داده |
| `models\llm\model.gguf` | مدل زبانی محلی Qwen2.5‑1.5B (Q4_K_M) |
| `models\embeddings\model.gguf` | مدل embedding چندزبانهٔ bge‑m3 (۱۰۲۴ بعد) |
| `models\ocr\*.traineddata` | OCR فارسی/انگلیسی Tesseract (کاملاً محلی) |
| `portable_bild\poppler\bin\` | `pdftoppm.exe` برای PDF اسکن‌شده |
| `storage\database\` | PGlite (PostgreSQL مبتنی بر WASM) + pgvector — در اولین اجرا ساخته می‌شود |
| `storage\documents\` | فایل‌های بارگذاری‌شده |

هیچ اتصال اینترنتی، PostgreSQL، Python یا سرویس خارجی لازم نیست
(`AI_MODE=offline` + کیل‌سوییچ شبکه).

## اجرا

`Start-Portable.bat` (میانبر Start Menu / Desktop) این کارها را انجام می‌دهد:

1. **پیش‌پرواز:** وجود `runtime\node.exe`، `.next`، `node_modules`، `drizzle` را بررسی
   می‌کند و در صورت نقص با پیام روشن متوقف می‌شود.
2. **`.env`:** اگر وجود نداشته باشد از `.env.template` با کلیدهای تصادفی
   (`JWT_SECRET`, `JOB_SECRET`) ساخته می‌شود.
3. **رفع alias PGlite:** `repair-pglite-external.cjs` نام‌های هش‌شدهٔ Turbopack را از
   `.next` می‌خواند و alias محلی می‌سازد (بدون اینترنت).
4. **اجرای سرور:** `next start` روی `PORT` (پیش‌فرض ۳۸۰۰) و `PORTABLE_HOSTNAME`
   (پیش‌فرض `127.0.0.1`)، با `pdftoppm` در PATH و
   `NODE_LLAMA_CPP_SKIP_DOWNLOAD=true` (هرگز چیزی دانلود/کامپایل نمی‌شود).
5. مهاجرت‌های پایگاه‌داده خودکار اعمال می‌شوند؛ تا پایان آن‌ها `/api/health` کد ۵۰۳
   می‌دهد. سپس مرورگر روی `http://localhost:3800` باز می‌شود.

ورود اول: `admin` / `ChangeMe123!` (بلافاصله عوض شود).

## تنظیمات مهم `.env`

| کلید | پیش‌فرض | توضیح |
| --- | --- | --- |
| `PORT` | `3800` | پورت وب |
| `PORTABLE_HOSTNAME` | `127.0.0.1` | برای دسترسی سایر رایانه‌های شبکه: `0.0.0.0` (+ باز کردن پورت در فایروال) |
| `PORTABLE_DATABASE_DIR` | `./storage/database` | مسیر پایگاه‌داده |
| `STORAGE_DIR` | `./storage` | مسیر فایل‌ها |
| `INGEST_CONCURRENCY` | `2` | تعداد پردازش هم‌زمان اسناد (با embedding روی CPU ۱–۲) |
| `LOCAL_LLM_THREADS` | `4` | رشته‌های CPU مدل زبانی |
| `LOCAL_LLM_GPU_LAYERS` | `0` | فقط با باینری GPU (ساخت با `-Gpu`) |
| `RAG_TOP_K`, `RAG_MIN_SCORE` | `8`, `0.15` | قابل تغییر از پنل مدیریت هم هست |

## انتقال / پشتیبان‌گیری

در حالی که برنامه بسته است، پوشهٔ `storage` و فایل `.env` را کپی کنید؛ همین دو
مورد، همهٔ داده‌ها را دربر می‌گیرند. حذف برنامه (Uninstall) این دو را پاک نمی‌کند و
نصب نسخهٔ جدید روی نسخهٔ قبلی، آن‌ها را حفظ می‌کند.

## واردکردن انبوه اسناد

پنل مدیریت → تب «پردازش و واردکردن» → مسیر پوشه (مثلاً `D:\Archive`) → شروع.
فایل‌ها به‌صورت بازگشتی ثبت، با SHA‑256 تکراری‌زدایی و توسط کارگر پس‌زمینه پردازش
می‌شوند؛ پیشرفت (پیمایش‌شده / واردشده / تکراری / خطا) و سابقهٔ دسته‌ها در همان تب
دیده می‌شود و می‌توان همان‌جا پیمایش را متوقف کرد. (ابزار خط فرمان
`npm run import` فقط در checkout توسعه در دسترس است، نه در بستهٔ نصبی.)

## فایل‌های این پوشه

| فایل | نقش |
| --- | --- |
| `Start-Portable.bat` | نقطهٔ ورود کاربر (میانبرها به این اشاره می‌کنند) |
| `start-portable.cjs` | راه‌انداز اصلی (پیش‌پرواز، `.env`، repair، `next start`) |
| `open-browser.cjs` | صبر برای `/api/health` و باز کردن مرورگر |
| `repair-pglite-external.cjs` | رفع alias هش‌شدهٔ PGlite/Turbopack (`--check`, `--copy`) |
| `create-portable-env.cjs` | ساخت `.env` با کلیدهای تصادفی از روی `.env.template` |
| `.env.template` | قالب تنظیمات نسخهٔ قابل‌حمل |
