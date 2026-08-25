; NSIS custom installer hooks for Enterprise AI (Electron build).
; Installs Visual C++ Redistributable silently before app files are finalized.

!macro customInstall
  ; Install Visual C++ Redistributable (silent, no reboot).
  IfFileExists "$TEMP\vc_redist.x64.exe" 0 +3
    ExecWait '"$TEMP\vc_redist.x64.exe" /install /quiet /norestart'
    Delete "$TEMP\vc_redist.x64.exe"

  ; Install WebView2 runtime (silent) — required by the Tauri variant;
  ; Electron bundles its own Chromium, but we keep this for consistency.
  IfFileExists "$TEMP\MicrosoftEdgeWebView2Setup.exe" 0 +3
    ExecWait '"$TEMP\MicrosoftEdgeWebView2Setup.exe" /silent /install'
    Delete "$TEMP\MicrosoftEdgeWebView2Setup.exe"
!macroend

!macro customUnInstall
  ; User data cleanup is offered interactively by the uninstaller.
  RMDir /r "$APPDATA\EnterpriseAI"
!macroend
