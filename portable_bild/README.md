# اصلاح نسخهٔ Portable (آفلاین)

این پوشه باید **کنار** پوشه‌های `.next` و `node_modules` نسخهٔ قابل‌حمل قرار بگیرد. برای اجرای برنامه در ویندوز فقط فایل **`Start-Portable.bat`** را اجرا کنید؛ `next start` یا فایل bat قدیمی را مستقیماً اجرا نکنید.

## خطای برطرف‌شده

در بعضی خروجی‌های Next.js/Turbopack، وابستگی واقعی زیر:

```text
@electric-sql/pglite
```

به نام داخلی و مخصوص همان build، مانند زیر، تبدیل می‌شود:

```text
@electric-sql/pglite-7966c14983af6418
```

این نام داخلی پکیج npm نیست. هنگام کپی کردن نسخهٔ portable، پوشهٔ alias آن معمولاً موجود نیست و Next.js پیش از بالا آمدن برنامه و هنگام اجرای `instrumentation` با `ERR_MODULE_NOT_FOUND` متوقف می‌شود.

`Start-Portable.bat` ابتدا `repair-pglite-external.cjs` را اجرا می‌کند. این اسکریپت:

1. نام aliasهای واقعی را از `.next/server/chunks` می‌خواند (به یک هش ثابت وابسته نیست)؛
2. نسخهٔ موجود و آفلاین `node_modules/@electric-sql/pglite` را در مسیر alias مورد نیاز کپی می‌کند؛
3. resolve شدن آن را با Node.js بررسی می‌کند؛
4. **فقط پس از موفقیت** سرور Next.js را اجرا می‌کند.

بنابراین هیچ دانلود، `npm install`، symlink یا دسترسی Administrator لازم نیست. در اجرای بعدی نیز در صورت آماده بودن alias، تغییری انجام نمی‌شود.

## ساختار لازم

```text
app/
├─ .next/
├─ node_modules/
│  └─ @electric-sql/pglite/     ← باید داخل بستهٔ portable باشد
├─ portable_bild/
│  ├─ Start-Portable.bat
│  ├─ start-portable.cjs
│  └─ repair-pglite-external.cjs
└─ package.json
```

> پوشهٔ اصلی `@electric-sql/pglite` را از نسخهٔ portable حذف نکنید. اگر اسکریپت اعلام کرد این پوشه وجود ندارد، نسخهٔ portable ناقص کپی شده است؛ کل `node_modules/@electric-sql/pglite` را از بستهٔ اصلی بازگردانید. نصب اینترنتی در زمان اجرای آفلاین راه‌حل نیست.

## برای تولید build جدید

در buildهای بعدی نیز همین launcher را حفظ کنید. فایل‌های `.next`، `node_modules` و `portable_bild` باید با هم و از یک خروجی منتشر شوند. این روش به‌صورت خودکار هش جدید Turbopack را تشخیص می‌دهد.
