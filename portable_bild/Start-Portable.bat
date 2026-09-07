@echo off
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0.."

set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" (
  echo ERROR: The embedded Node.js runtime is missing: %NODE%
  echo Reinstall the application with Chatbot-Organizational-Offline-Setup.exe
  echo or extract the complete portable ZIP. Do not copy only this BAT file.
  pause
  exit /b 1
)

if not exist ".env" (
  echo Generating secure keys and offline configuration...
  "%NODE%" "%~dp0create-portable-env.cjs" ".env" "%~dp0.env.template"
  if errorlevel 1 (
    echo Could not create .env.
    pause
    exit /b 1
  )
)

REM Read PORT from .env (default 3800) so the banner matches the real address.
set "PORT=3800"
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  if /i "%%A"=="PORT" set "PORT=%%B"
)

echo.
echo ============================================
echo   Chatbot Portable - Offline AI Assistant
echo ============================================
echo   URL : http://localhost:%PORT%
echo   Close this window to stop the app.
echo   (The browser opens automatically once the server is ready.)
echo.

REM Open the browser when the server answers /api/health (max ~90 s), in the background.
start "" /b "%NODE%" "%~dp0open-browser.cjs" "http://localhost:%PORT%"

REM Repair the build-specific externals before Next.js loads instrumentation, then start.
set "NODE_LLAMA_CPP_SKIP_DOWNLOAD=true"
set "NEXT_TELEMETRY_DISABLED=1"
"%NODE%" "%~dp0start-portable.cjs"
set EXIT_CODE=%ERRORLEVEL%
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Portable Chatbot stopped with error code %EXIT_CODE%.
  pause
)
exit /b %EXIT_CODE%
