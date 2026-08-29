; NSIS custom installer hooks for Enterprise AI (Electron build).
; Electron bundles its own Chromium, so WebView2 is NOT required.
; The only prerequisite is the Visual C++ Redistributable, which is shipped
; inside the installer (resources/prerequisites) so this installs fully
; offline with no network access. It is installed silently before the app
; files are finalized.

!macro customInstall
  ; Install Visual C++ Redistributable (offline, silent, no reboot). The file is
  ; bundled with the app via electron-builder "extraResources".
  IfFileExists "$INSTDIR\resources\prerequisites\vc_redist.x64.exe" 0 +3
    ExecWait '"$INSTDIR\resources\prerequisites\vc_redist.x64.exe" /install /quiet /norestart'
!macroend

!macro customUnInstall
  ; User data cleanup is offered interactively by the uninstaller.
  RMDir /r "$APPDATA\EnterpriseAI"
!macroend
