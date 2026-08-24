# بستهٔ قابل‌حمل آفلاین — Windows x64

این پوشه، منبع ساخت نسخهٔ قابل‌حمل است. خروجی نهایی یک فایل ZIP با نام
`Chatbot-Portable-Windows-x64.zip` در **GitHub Release** است. ZIP را کامل روی
فلش یا هر رایانهٔ Windows 10/11 x64 منتقل و extract کنید؛ سپس فقط
`portable_bild\Start-Portable.bat` را اجرا کنید.

## بدون نیاز به نصب

خروجی Release شامل همهٔ این موارد است:

- `runtime\node.exe` — Node.js قابل‌حمل؛ نصب Node.js لازم نیست.
- `.next` و `node_modules` ساخته‌شده روی Windows x64 — نصب npm لازم نیست.
- `models\llm\model.gguf` — مدل زبانی محلی Qwen؛ دانلود مدل لازم نیست.
- OCR فارسی و انگلیسی — هیچ سرویس OCR خارجی استفاده نمی‌شود.
- PGlite در `storage\database` — PostgreSQL محلی مبتنی بر WASM؛ نصب یا اجرای
  PostgreSQL لازم نیست.
- همهٔ داده‌ها، اسناد و پایگاه داده در همان پوشهٔ `storage` نگهداری می‌شوند.

در اولین اجرا، فایل `.env` با کلیدهای تصادفی محلی ایجاد می‌شود. `AI_MODE=offline`
است و هیچ کلید API یا اتصال اینترنتی برای کارکرد برنامه وجود ندارد.

> برای انتقال اطلاعات به رایانهٔ دیگر، در حالی که برنامه بسته است کل پوشهٔ
> `Chatbot-Portable` را کپی کنید؛ پوشهٔ `storage` را حذف نکنید.

## ساخت و انتشار ZIP در GitHub

به تب **Actions** مخزن بروید، workflow با نام **Build portable Windows package**
را انتخاب کنید و **Run workflow** را اجرا نمایید. یک tag مانند
`portable-v1.0.0` وارد کنید. workflow به‌صورت خودکار روی Windows:

1. dependencyهای Windows را نصب می‌کند؛
2. مدل زبانی و OCR را دریافت می‌کند؛
3. برنامه را build می‌کند؛
4. Node.js قابل‌حمل را اضافه می‌کند؛
5. ZIP کامل را در GitHub Release همان tag بارگذاری می‌کند.

مدل‌ها و باینری‌ها عمداً در Git source قرار ندارند: محدودیت GitHub برای هر فایل
Git حدود ۱۰۰MB است، درحالی‌که مدل زبانی صدها مگابایت حجم دارد. اما فایل Release
خروجی کامل و قابل‌انتقال است و پس از دریافت، کاملاً آفلاین کار می‌کند.

## رفع alias PGlite

`repair-pglite-external.cjs` پیش از شروع Next.js اجرا می‌شود. در بعضی buildهای
Turbopack، PGlite با نام داخلی هش‌شده صادر می‌شود. اسکریپت نام را از `.next`
می‌خواند و alias محلی لازم را بدون اینترنت می‌سازد تا خطای
`ERR_MODULE_NOT_FOUND` رخ ندهد.
