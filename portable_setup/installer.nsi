; Real Windows installer definition for the self-contained portable bundle.
; Build on Windows with NSIS 3.x: makensis installer.nsi
Unicode True
RequestExecutionLevel user
OutFile "Chatbot-Organizational-Offline-Setup.exe"
InstallDir "$LOCALAPPDATA\ChatbotOrganizationalOffline"
Name "Chatbot سازمانی آفلاین"
BrandingText "Offline Organizational Chatbot"

!include "MUI2.nsh"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "Persian"

Section "Install"
  SetOutPath "$INSTDIR"
  ; release\app is produced by portable_setup\build-installer.ps1
  File /r "release\app\*.*"
  CreateDirectory "$SMPROGRAMS\Chatbot سازمانی آفلاین"
  CreateShortcut "$SMPROGRAMS\Chatbot سازمانی آفلاین\Chatbot سازمانی آفلاین.lnk" "$INSTDIR\portable_bild\Start-Portable.bat"
  CreateShortcut "$DESKTOP\Chatbot سازمانی آفلاین.lnk" "$INSTDIR\portable_bild\Start-Portable.bat"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  ; Do not remove storage: it holds the embedded database and uploaded files.
  Delete "$SMPROGRAMS\Chatbot سازمانی آفلاین\Chatbot سازمانی آفلاین.lnk"
  Delete "$DESKTOP\Chatbot سازمانی آفلاین.lnk"
  RMDir "$SMPROGRAMS\Chatbot سازمانی آفلاین"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\node_modules"
  RMDir /r "$INSTDIR\.next"
  RMDir /r "$INSTDIR\models"
  RMDir /r "$INSTDIR\drizzle"
  RMDir /r "$INSTDIR\portable_bild"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\.env.template"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
