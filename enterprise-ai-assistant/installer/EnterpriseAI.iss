; ============================================================
;  Enterprise AI Assistant — Inno Setup installer script
;  Build with: iscc installer/EnterpriseAI.iss
; ============================================================
#define MyAppName "دستیار هوشمند سازمانی"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Enterprise AI"
#define MyAppExeName "EnterpriseAI.exe"

[Setup]
AppId={{8F3A1E2A-7C4B-4E2D-9B6A-ENTERPRISEAI}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\EnterpriseAI
DefaultGroupName={#MyAppName}
OutputBaseFilename=setup
OutputDir=..\dist-installer
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
MinVersion=10.0
WizardStyle=modern
DisableWelcomePage=no
LicenseFile=..\LICENSE.txt
PrivilegesRequired=admin
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile=assets\icon.ico
; Show Persian/English language selector
ShowLanguageDialog=yes

[Languages]
Name: "persian"; MessagesFile: "compiler:Languages\Persian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "ایجاد آیکون روی دسکتاپ"; GroupDescription: "آیکون‌ها:"; Flags: unchecked
Name: "startmenu"; Description: "اضافه کردن به منوی استارت"; GroupDescription: "آیکون‌ها:"; Flags: checkedonce

[Files]
; --- Desktop shell (Tauri) ---
Source: "..\desktop\src-tauri\target\release\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\desktop\src-tauri\target\release\*.dll"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\desktop\src-tauri\target\release\webview2data\*"; DestDir: "{app}\webview2data"; Flags: ignoreversion recursesubdirs skipifsourcedoesntexist

; --- Backend (PyInstaller onedir) ---
Source: "..\backend\dist\backend-server\*"; DestDir: "{app}\backend"; Flags: ignoreversion recursesubdirs createallsubdirs

; --- LLM engine (llama.cpp native binary) ---
Source: "..\llm\llama-server.exe"; DestDir: "{app}\llm"; Flags: ignoreversion skipifsourcedoesntexist

; --- Models (large; included in installer) ---
; Default lightweight 1.5B model (~1GB) for 8GB systems.
Source: "..\models\llm\qwen2.5-1.5b-instruct-q4_k_m.gguf"; DestDir: "{app}\models\llm"; Flags: ignoreversion skipifsourcedoesntexist
; Optional 7B model for 16GB+ systems.
Source: "..\models\llm\qwen2.5-7b-instruct-q4_k_m.gguf"; DestDir: "{app}\models\llm"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\models\embedding\*"; DestDir: "{app}\models\embedding"; Flags: ignoreversion recursesubdirs skipifsourcedoesntexist
Source: "..\models\reranker\*"; DestDir: "{app}\models\reranker"; Flags: ignoreversion recursesubdirs skipifsourcedoesntexist
Source: "..\models\ocr\*"; DestDir: "{app}\models\ocr"; Flags: ignoreversion recursesubdirs skipifsourcedoesntexist

; --- Frontend is served by the backend (already bundled into PyInstaller one-dir) ---
Source: "..\frontend\dist\*"; DestDir: "{app}\frontend\dist"; Flags: ignoreversion recursesubdirs

; --- Config ---
Source: "..\config\*"; DestDir: "{app}\config"; Flags: ignoreversion recursesubdirs

; --- SQLite extension (vector search) ---
Source: "..\extensions\*.dll"; DestDir: "{app}\extensions"; Flags: ignoreversion skipifsourcedoesntexist

; --- Prerequisites (run, then remove) ---
Source: "..\prerequisites\vc_redist.x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall skipifsourcedoesntexist
Source: "..\prerequisites\MicrosoftEdgeWebView2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall skipifsourcedoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\حذف {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; Install Visual C++ Redistributable (silent).
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/install /quiet /norestart"; StatusMsg: "نصب پیش‌نیازهای ویژوال سی++..."; Flags: waituntilterminated skipifsilent skipifdoesntexist
; Install WebView2 runtime if not present.
Filename: "{tmp}\MicrosoftEdgeWebView2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "نصب WebView2..."; Flags: waituntilterminated skipifsilent skipifdoesntexist
; Launch app after install.
Filename: "{app}\{#MyAppExeName}"; Description: "اجرای {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
Type: filesandordirs; Name: "{userappdata}\EnterpriseAI"; Check: ShouldDeleteData

[Code]
function ShouldDeleteData: Boolean;
begin
  Result := MsgBox('آیا داده‌های کاربر (پایگاه داده و اسناد) هم حذف شوند؟', mbConfirmation, MB_YESNO) = IDYES;
end;

function InitializeSetup(): Boolean;
var
  RamMB: Cardinal;
begin
  Result := True;
  // Basic RAM warning (does not block).
  RamMB := 0;
  if GetPhysicallyInstalledSystemMemory(RamMB) then begin
    if RamMB < 7*1024*1024 then
      MsgBox('هشدار: حداقل ۸ گیگابایت رم پیشنهاد می‌شود.', mbWarning, MB_OK);
  end;
end;
