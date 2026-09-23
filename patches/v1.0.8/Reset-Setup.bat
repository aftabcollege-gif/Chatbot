@echo off
setlocal
title Reset Chatbot Enterprise Setup

echo.
echo === Reset Chatbot Enterprise (fix setup/login redirect loop) ===
echo.
echo This will:
echo   - Stop Chatbot Enterprise / backend / llama-server
echo   - Delete enterprise.db so the first-run setup wizard appears again
echo   - Open the app in a fresh tab
echo.
set /p c="Type YES and press Enter to continue, or close this window to cancel: "
if /i not "%c%"=="YES" ( echo Aborted. & pause & exit /b 0 )

echo [*] Stopping all app processes...
taskkill /F /IM "Chatbot Enterprise.exe" /T >nul 2>&1
taskkill /F /IM "EnterpriseAI.exe" /T >nul 2>&1
taskkill /F /IM "backend-server.exe" /T >nul 2>&1
taskkill /F /IM "llama-server.exe" /T >nul 2>&1
timeout /t 2 /nobreak >nul

set "DATA_DIR=%APPDATA%\EnterpriseAI\data"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
if exist "%DATA_DIR%\enterprise.db" (
  echo [*] Backing up old database...
  copy /Y "%DATA_DIR%\enterprise.db" "%DATA_DIR%\enterprise.db.bak-%date:/=-%-%time::=-%.db" >nul 2>&1
  del /F /Q "%DATA_DIR%\enterprise.db" >nul 2>&1
  del /F /Q "%DATA_DIR%\enterprise.db-wal" >nul 2>&1
  del /F /Q "%DATA_DIR%\enterprise.db-shm" >nul 2>&1
  echo [OK] Old database removed.
) else (
  echo [*] No existing enterprise.db found.
)

echo.
echo [*] Launching Chatbot Enterprise...
set "APP="
if exist "%ProgramFiles%\Chatbot Enterprise\Chatbot Enterprise.exe" set "APP=%ProgramFiles%\Chatbot Enterprise\Chatbot Enterprise.exe"
if not defined APP if exist "%LocalAppData%\Programs\Chatbot Enterprise\Chatbot Enterprise.exe" set "APP=%LocalAppData%\Programs\Chatbot Enterprise\Chatbot Enterprise.exe"
if not defined APP (
  echo [!] Could not find Chatbot Enterprise.exe. Launch it manually.
  pause
  exit /b 1
)
start "" "%APP%"

echo.
echo [*] Waiting for backend to come up (~20 seconds)...
timeout /t 20 /nobreak >nul

echo [*] Opening setup wizard in your default browser (Incognito not possible here).
echo     If it still redirects to /login, please:
echo       1. Press Ctrl+Shift+N to open an Incognito window
echo       2. Go to http://127.0.0.1:8741/
start "" "http://127.0.0.1:8741/setup"
echo.
echo Done. The admin-creation wizard should now be visible.
pause
