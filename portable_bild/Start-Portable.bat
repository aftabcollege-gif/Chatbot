@echo off
setlocal
cd /d "%~dp0.."

echo Generating secure keys...
echo.
echo ============================================
echo   Chatbot Portable - Offline AI Assistant
echo ============================================
echo   URL : http://localhost:3800
echo   Close this window to stop the app.
echo.

REM Repair the build-specific PGlite alias before Next.js loads instrumentation.
node "%~dp0start-portable.cjs"
set EXIT_CODE=%ERRORLEVEL%
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Portable Chatbot stopped with error code %EXIT_CODE%.
  pause
)
exit /b %EXIT_CODE%
