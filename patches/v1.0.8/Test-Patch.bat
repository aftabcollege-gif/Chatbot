@echo off
setlocal
chcp 65001 >nul
title Test Patch v1.0.8

echo.
echo === Test Patch v1.0.8 (numpy vector backend) ===
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

echo [*] Stopping app processes...
taskkill /F /IM "Chatbot Enterprise.exe" /T >nul 2>&1
taskkill /F /IM "backend-server.exe" /T >nul 2>&1
timeout /t 2 /nobreak >nul

echo [*] Copying test script...
copy /Y "%~dp0test-patch-v1.0.8.py" "%INTERNAL%\" >nul
if not exist "%INTERNAL%\test-patch-v1.0.8.py" (
  echo [X] Failed to copy test script. Run as administrator.
  pause
  exit /b 1
)

set "PYEXE="
if exist "%INTERNAL%\python.exe" set "PYEXE=%INTERNAL%\python.exe"
if not defined PYEXE if exist "%INTERNAL%\..\python.exe" set "PYEXE=%INTERNAL%\..\python.exe"
if not defined PYEXE (
  echo [X] Embedded python.exe not found.
  pause
  exit /b 1
)

echo [*] Running patch self-test with embedded Python:
echo     %PYEXE%
echo ------------------------------------------------------
cd /D "%INTERNAL%"
"%PYEXE%" "test-patch-v1.0.8.py"
set "TEST_ERR=%ERRORLEVEL%"
echo ------------------------------------------------------
echo.
if "%TEST_ERR%"=="0" (
  echo [OK] Patch is WORKING. Vector backend is numpy.
  echo     You can now launch Chatbot Enterprise normally.
) else (
  echo [X] Patch test FAILED with code %TEST_ERR%.
  echo.
  echo     Please take a SCREENSHOT of this window AND send the file:
  echo       %INTERNAL%\test-patch-result.txt
)
echo.
pause
