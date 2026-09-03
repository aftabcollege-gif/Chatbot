; NSIS custom installer hooks for the standalone Enterprise AI desktop app.
; All application, LLM, embedding, reranker and native runtime assets are
; already bundled by electron-builder. VC++ is optional and installed only
; when the bundled redistributable is present.

!macro customInstall
  IfFileExists "$INSTDIR\resources\prerequisites\vc_redist.x64.exe" 0 +3
    ExecWait '"$INSTDIR\resources\prerequisites\vc_redist.x64.exe" /install /quiet /norestart'
    Delete "$INSTDIR\resources\prerequisites\vc_redist.x64.exe"
!macroend

!macro customUnInstall
  ; Keep user data by default so uninstall/reinstall does not destroy the
  ; knowledge base. A future explicit "remove data" option can clean it.
!macroend
