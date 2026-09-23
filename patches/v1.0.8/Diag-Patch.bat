@echo off
setlocal
chcp 65001 >nul
title Chatbot Enterprise v1.0.8 Diagnostics

echo.
echo ======================================================
echo   Chatbot Enterprise v1.0.8 Diagnostic
echo ======================================================
echo.

set "INSTALL_DIR="
if exist "%ProgramFiles%\Chatbot Enterprise\Chatbot Enterprise.exe" set "INSTALL_DIR=%ProgramFiles%\Chatbot Enterprise"
if not defined INSTALL_DIR if exist "%ProgramFiles(x86)%\Chatbot Enterprise\Chatbot Enterprise.exe" set "INSTALL_DIR=%ProgramFiles(x86)%\Chatbot Enterprise"
if not defined INSTALL_DIR if exist "%LocalAppData%\Programs\Chatbot Enterprise\Chatbot Enterprise.exe" set "INSTALL_DIR=%LocalAppData%\Programs\Chatbot Enterprise"
if not defined INSTALL_DIR (
  echo [X] Install folder not found.
  pause
  exit /b 1
)
set "INTERNAL=%INSTALL_DIR%\_internal"
set "APP_DATA_DIR=%APPDATA%\EnterpriseAI"
set "LOG_DIR=%APP_DATA_DIR%\logs"
set "DATA_DIR=%APP_DATA_DIR%\data"

echo [*] Install dir : %INSTALL_DIR%
echo [*] AppData     : %APP_DATA_DIR%
echo.

echo --- Patch files ---
if exist "%INTERNAL%\sitecustomize.py" (
  echo [OK] sitecustomize.py found
  findstr "v1.0.8" "%INTERNAL%\sitecustomize.py" >nul && echo      reports v1.0.8 || echo      [!!] does NOT report v1.0.8
) else (
  echo [X] sitecustomize.py MISSING
)
if exist "%INTERNAL%\patches\core\database.py" (
  echo [OK] patches\core\database.py found
  findstr "numpy" "%INTERNAL%\patches\core\database.py" >nul && echo      contains numpy backend || echo      [!!] MISSING numpy backend
) else (
  echo [X] patches\core\database.py MISSING
)
if exist "%APP_DATA_DIR%\patch-v1.0.8-applied.txt" (
  echo [OK] patch marker file found in AppData
  type "%APP_DATA_DIR%\patch-v1.0.8-applied.txt"
) else (
  echo [!] patch marker file NOT found in AppData (patch may not have run yet)
)
echo.

echo --- Patch log (last 40 lines) ---
set "LOG=%LOG_DIR%\patch-v1.0.8.log"
if exist "%LOG%" (
  echo Log file: %LOG%
  echo ------------------------------------------------------
  powershell -NoProfile -Command "Get-Content -Tail 40 -Encoding UTF8 '%LOG%'" 2>nul
  if errorlevel 1 (
    for /f "tokens=*" %%L in ('type "%LOG%"') do echo %%L
  )
  echo ------------------------------------------------------
) else (
  echo [!] No patch log at %LOG%
  echo     (This usually means sitecustomize.py did not load at all).
)
echo.

echo --- Running processes ---
tasklist /FI "IMAGENAME eq Chatbot Enterprise.exe" 2>nul | findstr /I "Chatbot"
if errorlevel 1 echo     Chatbot Enterprise.exe is NOT running.
echo.

set /p LAUNCH="Launch Chatbot Enterprise now and test /api/health? (Y/N): "
if /i not "%LAUNCH%"=="Y" goto :end
echo.
if exist "%INSTALL_DIR%\Chatbot Enterprise.exe" (
  echo [*] Starting Chatbot Enterprise...
  start "" "%INSTALL_DIR%\Chatbot Enterprise.exe"
) else (
  echo [X] EXE not found.
  goto :end
)
echo [*] Waiting 30 seconds for backend...
timeout /t 30 /nobreak >nul
echo.

echo --- Querying /api/health ---
set "HOUT=%TEMP%\ce-health.json"
if exist "%HOUT%" del /Q "%HOUT%"
curl.exe --version >nul 2>&1
if not errorlevel 1 (
  curl.exe -s --max-time 5 -o "%HOUT%" "http://127.0.0.1:8741/api/health"
  if exist "%HOUT%" (
    echo.
    echo === Health response ===
    type "%HOUT%"
    echo.
    echo =======================
    echo.
    findstr /i "\"vector_extension\"" "%HOUT%"
    findstr /i "\"vector_backend\"" "%HOUT%"
    findstr /i "\"vector_extension_path\"" "%HOUT%"
    findstr /i "\"vector_extension_error\"" "%HOUT%"
  ) else (
    echo [X] curl returned no data (backend may still be starting).
  )
) else (
  echo [!] curl.exe not available. Open http://127.0.0.1:8741/api/health in your browser.
)

:end
echo.
echo ======================================================
echo Please take a SCREENSHOT of this window and send it if
echo vector_extension is still "degraded".
echo ======================================================
pause
