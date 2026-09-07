; Inno Setup 6.5+ script for the self-contained offline Chatbot bundle.
;
;   iscc /DAppVersion=1.2.0 /DSourceDir=release\app installer.iss
;
; build-installer.ps1 stages release\app (Node runtime, production build,
; pruned node_modules, GGUF models, OCR data, poppler) and then calls iscc.
; Inno Setup is preferred over NSIS because the bundle with models is larger
; than the 2 GB NSIS limit. A single Setup.exe may be up to ~4 GB; above that
; DiskSpanning creates Setup-1.bin slices that must ship next to the exe.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "release\app"
#endif
#define AppName "Chatbot سازمانی آفلاین"
#define AppNameAscii "Chatbot Organizational Offline"
#define AppPublisher "Aftab College"
#define AppExeName "portable_bild\Start-Portable.bat"

[Setup]
AppId={{7D2F0B56-6F4A-4B4E-9E1C-0C6C2C3E8A11}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\ChatbotOrganizationalOffline
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; Per-user install: no UAC prompt, data stays with the user profile.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=.
OutputBaseFilename=Chatbot-Organizational-Offline-Setup
Compression=lzma2/fast
SolidCompression=no
LZMAUseSeparateProcess=yes
; GGUF/wasm payloads barely compress; a fast preset keeps CI time sane.
; A single Setup.exe is limited to ~4 GB. build-installer.ps1 passes
; /DDiskSpanning=yes only when the staged bundle is larger, which produces
; Setup.exe + Setup-1.bin slices that must be distributed together.
#ifdef DiskSpanning
DiskSpanning=yes
DiskSliceSize=max
#endif
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern
UninstallDisplayName={#AppName}
UninstallDisplayIcon={sys}\cmd.exe
CloseApplications=yes
CloseApplicationsFilter=node.exe
SetupLogging=yes
ShowLanguageDialog=auto
; Keep the user's database/uploads on uninstall (handled in [UninstallDelete] + code).

[Languages]
; Farsi.isl is the official community translation (jrsoftware/issrc,
; Files/Languages/Unofficial). build-installer.ps1 downloads it next to this
; script; when it is absent the installer is English-only.
#ifexist "Farsi.isl"
Name: "fa"; MessagesFile: "Farsi.isl"
#endif
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
en.LaunchApp=Launch the application
en.KeepData=Your data (database and uploaded files) in the storage folder is kept.
en.UpgradeNotice=A previous installation was detected. Program files will be updated; your data is preserved.
#ifexist "Farsi.isl"
fa.LaunchApp=اجرای برنامه
fa.KeepData=داده‌های شما (پایگاه داده و فایل‌های بارگذاری‌شده) در پوشهٔ storage نگه داشته می‌شوند.
fa.UpgradeNotice=نسخهٔ قبلی شناسایی شد. فایل‌های برنامه به‌روزرسانی می‌شوند و داده‌ها حفظ خواهند شد.
#endif

[Files]
; Everything staged by build-installer.ps1 / stage-bundle.cjs.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: "\.env,\storage\database\*,\storage\files\*"

[Dirs]
Name: "{app}\storage"; Flags: uninsneveruninstall
Name: "{app}\storage\database"; Flags: uninsneveruninstall
Name: "{app}\storage\files"; Flags: uninsneveruninstall

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; IconFilename: "{sys}\shell32.dll"; IconIndex: 21; Comment: "http://localhost:3800"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; IconFilename: "{sys}\shell32.dll"; IconIndex: 21; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchApp}"; Flags: postinstall nowait shellexec skipifsilent

[InstallDelete]
; Remove stale hashed-external aliases and build output from an older version
; before the new files are copied (names change with every build).
Type: filesandordirs; Name: "{app}\.next"
Type: filesandordirs; Name: "{app}\node_modules"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\.next"
Type: filesandordirs; Name: "{app}\node_modules"
Type: filesandordirs; Name: "{app}\models"
Type: filesandordirs; Name: "{app}\drizzle"
Type: filesandordirs; Name: "{app}\portable_bild"
Type: files; Name: "{app}\package.json"
Type: files; Name: "{app}\.env.template"
Type: files; Name: "{app}\README-Setup.md"
Type: files; Name: "{app}\VERSION.txt"
; NOTE: {app}\.env (secrets) and {app}\storage (database + uploads) are kept on
; purpose so an uninstall/reinstall never destroys organisational data.

[Code]
function IsUpgrade(): Boolean;
begin
  Result := DirExists(ExpandConstant('{app}\storage\database'));
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssInstall) and IsUpgrade() then
    Log('Upgrade detected: keeping storage and .env');
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpReady) and IsUpgrade() then
    MsgBox(CustomMessage('UpgradeNotice'), mbInformation, MB_OK);
end;

function InitializeUninstall(): Boolean;
begin
  Result := True;
  MsgBox(CustomMessage('KeepData'), mbInformation, MB_OK);
end;
