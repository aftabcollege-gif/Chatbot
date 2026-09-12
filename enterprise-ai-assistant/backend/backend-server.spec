# PyInstaller spec for the embedded backend.
# Build: pyinstaller backend/backend-server.spec
# Produces dist/backend-server/backend-server.exe (onedir).

import os

from PyInstaller.utils.hooks import collect_all

# The spec lives in backend/. Because backend/__init__.py exists, PyInstaller
# auto-resolves the module search path to the PARENT directory (the repo root),
# so the local packages (core, routers, services, models, utils) are never found
# during analysis and are silently left out of the frozen executable — which then
# crashes at startup with "ModuleNotFoundError: No module named 'core'".
# Pin pathex to this spec's directory so the backend packages are collected.
try:
    _SPEC_DIR = SPECPATH  # noqa: F821 - provided by PyInstaller when running the spec
except NameError:  # pragma: no cover - older PyInstaller
    _SPEC_DIR = os.path.dirname(os.path.abspath(SPEC))  # noqa: F821

block_cipher = None

datas = [
    ("../config", "config"),
]
binaries = []
hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "sqlalchemy.dialects.sqlite",
    "email_validator",
]

# Collect optional heavy packages only if present.
for pkg in ("onnxruntime", "tokenizers", "pdfplumber", "docx", "openpyxl", "pptx", "bs4"):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        pass

a = Analysis(
    ["main.py"],
    pathex=[_SPEC_DIR],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "PIL.ImageTk"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="backend-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="backend-server",
)
