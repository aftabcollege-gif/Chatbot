@echo off
setlocal
chcp 65001 >nul
title Chatbot Enterprise Patch v1.0.8

echo.
echo === Chatbot Enterprise Patch v1.0.8 (numpy vector backend) ===
echo.

set "INSTALL_DIR="
if exist "%ProgramFiles%\Chatbot Enterprise\Chatbot Enterprise.exe" set "INSTALL_DIR=%ProgramFiles%\Chatbot Enterprise"
if not defined INSTALL_DIR if exist "%ProgramFiles(x86)%\Chatbot Enterprise\Chatbot Enterprise.exe" set "INSTALL_DIR=%ProgramFiles(x86)%\Chatbot Enterprise"
if not defined INSTALL_DIR if exist "%LocalAppData%\Programs\Chatbot Enterprise\Chatbot Enterprise.exe" set "INSTALL_DIR=%LocalAppData%\Programs\Chatbot Enterprise"
if not defined INSTALL_DIR (
  echo [X] Install folder not found.
  set /p "INSTALL_DIR=Enter the folder that contains Chatbot Enterprise.exe: "
)
if not exist "%INSTALL_DIR%\Chatbot Enterprise.exe" (
  echo [X] Chatbot Enterprise.exe not found in "%INSTALL_DIR%".
  pause
  exit /b 1
)
echo [*] Install dir: %INSTALL_DIR%

echo [*] Stopping running processes...
taskkill /F /IM "Chatbot Enterprise.exe" /T >nul 2>&1
taskkill /F /IM "EnterpriseAI.exe" /T >nul 2>&1
taskkill /F /IM "backend-server.exe" /T >nul 2>&1
taskkill /F /IM "llama-server.exe" /T >nul 2>&1
timeout /t 2 /nobreak >nul

set "INTERNAL=%INSTALL_DIR%\_internal"
set "SRC=%~dp0patch-files"
if not exist "%SRC%\sitecustomize.py" (
  echo [X] patch-files\sitecustomize.py not found next to this bat.
  echo     Extract the FULL zip so that patch-files\ sits next to Apply-Patch.bat.
  pause
  exit /b 1
)

echo [*] Copying patch files...
if not exist "%INTERNAL%\patches" mkdir "%INTERNAL%\patches"
xcopy /E /Y /I /Q "%SRC%\patches\*" "%INTERNAL%\patches\" >nul
if not exist "%INTERNAL%\config" mkdir "%INTERNAL%\config"
copy /Y "%SRC%\config\default.yaml" "%INTERNAL%\config\" >nul
copy /Y "%SRC%\sitecustomize.py" "%INTERNAL%\" >nul

echo.
echo --- Verification ---
set "ERR=0"
if not exist "%INTERNAL%\sitecustomize.py" (echo [X] sitecustomize.py copy FAILED & set "ERR=1") else (echo [OK] sitecustomize.py)
findstr "v1.0.8" "%INTERNAL%\sitecustomize.py" >nul
if errorlevel 1 (echo [X] sitecustomize.py is NOT v1.0.8 & set "ERR=1") else (echo [OK] sitecustomize reports v1.0.8)
if not exist "%INTERNAL%\patches\core\database.py" (echo [X] patches\core\database.py copy FAILED & set "ERR=1") else (echo [OK] patches\core\database.py)
findstr "numpy" "%INTERNAL%\patches\core\database.py" >nul
if errorlevel 1 (echo [X] database.py is NOT numpy version & set "ERR=1") else (echo [OK] database.py contains numpy backend)
if "%ERR%"=="1" (
  echo.
  echo [X] Patch copy verification failed. Try running this bat as administrator.
  pause
  exit /b 1
)
echo [OK] All patch files verified.

echo [*] Removing old sqlite_vec.dll copies (no longer needed)...
if exist "%INTERNAL%\sqlite_vec.dll" del /Q "%INTERNAL%\sqlite_vec.dll" >nul 2>&1
if exist "%INTERNAL%\extensions\sqlite_vec.dll" del /Q "%INTERNAL%\extensions\sqlite_vec.dll" >nul 2>&1

set "APP_DATA_DIR=%APPDATA%\EnterpriseAI"
set "DATA_DIR=%APP_DATA_DIR%\data"
set "LOG_DIR=%APP_DATA_DIR%\logs"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

set "LLM_DIR=%APP_DATA_DIR%\models\llm"
if not exist "%LLM_DIR%" mkdir "%LLM_DIR%"
for %%F in ("%~dp0*.gguf") do (
  if exist "%%F" copy /Y "%%F" "%LLM_DIR%\" >nul && echo [OK] Copied %%~nxF to models\llm\
)

echo.
echo === DONE ===
echo.
echo IMPORTANT: Double-click Reset-Setup.bat now if this is your first
echo time applying v1.0.8, or if vector_extension still says "degraded".
echo That will clear enterprise.db so the new numpy index is built from
echo scratch (you will need to re-upload your documents afterwards).
echo.
echo After launching Chatbot Enterprise check System Health:
echo   vector_extension: ok
echo   vector_backend:   numpy
echo   vector_extension_path: numpy-inmemory
echo.
echo Log file (if you need support):
echo   %LOG_DIR%\patch-v1.0.8.log
echo.
pause
