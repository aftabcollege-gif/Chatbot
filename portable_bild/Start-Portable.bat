@echo off
setlocal
cd /d "%~dp0.."

set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" (
  echo ERROR: The embedded Node.js runtime is missing: %NODE%
  echo Extract the complete Chatbot-Portable-Windows-x64.zip. Do not copy only this BAT file.
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

echo.
echo ============================================
echo   Chatbot Portable - Offline AI Assistant
echo ============================================
echo   URL : http://localhost:3800
echo   Close this window to stop the app.
echo.

REM Repair the build-specific PGlite alias before Next.js loads instrumentation.
"%NODE%" "%~dp0start-portable.cjs"
set EXIT_CODE=%ERRORLEVEL%
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Portable Chatbot stopped with error code %EXIT_CODE%.
  pause
)
exit /b %EXIT_CODE%
