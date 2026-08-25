# Windows Setup واقعی — چت‌بات سازمانی آفلاین

`installer.nsi` تعریف واقعی NSIS برای ساخت فایل زیر است:

```text
Chatbot-Organizational-Offline-Setup.exe
```

Installer، کل برنامهٔ ساخته‌شده را در `%LOCALAPPDATA%\ChatbotOrganizationalOffline`
نصب و میانبر Start Menu و Desktop می‌سازد. داده‌های کاربر و دیتابیس محلی در
`storage` باقی می‌مانند و Uninstall آن‌ها را حذف نمی‌کند.

## پیش‌نیاز build (فقط روی ماشین سازنده)

- Windows x64
- NSIS 3.x (`makensis.exe`)
- خروجی portable کامل شامل Node runtime، `node_modules` ویندوز، مدل‌ها و `.next`

برای ساخت اجرا کنید:

```powershell
powershell -ExecutionPolicy Bypass -File .\portable_setup\build-installer.ps1
```

فایل EXE در همین پوشه تولید می‌شود. رایانهٔ مقصد به Node.js، PostgreSQL، مدل
یا هیچ نصب دیگری نیاز ندارد.
