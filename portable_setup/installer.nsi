; NSIS installer definition for the self-contained portable bundle.
;
;   makensis /DAPP_VERSION=1.2.0 /DSOURCE_DIR=release\app installer.nsi
;
; NOTE: NSIS cannot produce installers larger than 2 GB. The full bundle
; (with the LLM + embedding models) exceeds that, so build-installer.ps1
; uses installer.iss (Inno Setup) by default and only falls back to this
; script for "lite" builds (-SkipModels). Both installers are interchangeable
; for the end user: same install directory, same launcher, same data folder.
Unicode True
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!ifndef APP_VERSION
  !define APP_VERSION "1.0.0"
!endif
!ifndef SOURCE_DIR
  !define SOURCE_DIR "release\app"
!endif
!define APP_NAME "Chatbot سازمانی آفلاین"
!define APP_DIR "ChatbotOrganizationalOffline"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_DIR}"

OutFile "Chatbot-Organizational-Offline-Setup.exe"
InstallDir "$LOCALAPPDATA\${APP_DIR}"
InstallDirRegKey HKCU "Software\${APP_DIR}" "InstallDir"
Name "${APP_NAME} ${APP_VERSION}"
BrandingText "Offline Organizational Chatbot ${APP_VERSION}"

!include "MUI2.nsh"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\portable_bild\Start-Portable.bat"
!define MUI_FINISHPAGE_RUN_TEXT "اجرای برنامه"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Persian"
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  ; A previous version's build output and hashed external aliases must not
  ; linger next to the new ones (names change with every build).
  RMDir /r "$INSTDIR\.next"
  RMDir /r "$INSTDIR\node_modules"

  ; Everything staged by stage-bundle.cjs (no .env, no database).
  File /r /x ".env" /x "database" /x "files" "${SOURCE_DIR}\*.*"
  CreateDirectory "$INSTDIR\storage"
  CreateDirectory "$INSTDIR\storage\database"
  CreateDirectory "$INSTDIR\storage\files"

  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\portable_bild\Start-Portable.bat" "" "$SYSDIR\shell32.dll" 21
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\حذف ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\portable_bild\Start-Portable.bat" "" "$SYSDIR\shell32.dll" 21

  WriteRegStr HKCU "Software\${APP_DIR}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Aftab College"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  ; Program files only. `storage` (PGlite database + uploaded files) and
  ; `.env` (per-machine secrets) are kept on purpose so a reinstall/upgrade
  ; never destroys organisational data.
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\حذف ${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"
  Delete "$DESKTOP\${APP_NAME}.lnk"

  RMDir /r "$INSTDIR\.next"
  RMDir /r "$INSTDIR\node_modules"
  RMDir /r "$INSTDIR\models"
  RMDir /r "$INSTDIR\drizzle"
  RMDir /r "$INSTDIR\portable_bild"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\.env.template"
  Delete "$INSTDIR\README-Setup.md"
  Delete "$INSTDIR\VERSION.txt"
  Delete "$INSTDIR\Uninstall.exe"
  ; Removed only when empty (i.e. the user deleted storage/.env themselves).
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${APP_DIR}"
SectionEnd
