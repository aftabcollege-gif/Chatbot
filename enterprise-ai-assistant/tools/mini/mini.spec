# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the small offline launcher / repair EXE.

Build (from ``enterprise-ai-assistant``):

    pyinstaller --noconfirm --clean tools/mini/mini.spec

Produces ``dist/Chatbot-Enterprise-Mini.exe`` — one file, no admin rights, no
installer, no cmd/PowerShell: double-click and it repairs the installed
application and/or runs the fixed app itself.
"""
import os
import sys

from PyInstaller.utils.hooks import collect_submodules

SPEC_DIR = os.path.dirname(os.path.abspath(SPEC))
ROOT = os.path.abspath(os.path.join(SPEC_DIR, "..", ".."))
BACKEND = os.path.join(ROOT, "backend")
TOOLS = SPEC_DIR
FRONTEND_DIST = os.path.join(ROOT, "frontend", "dist")

datas = []
if os.path.isdir(FRONTEND_DIST):
    datas.append((FRONTEND_DIST, "frontend/dist"))
else:
    print("WARNING: frontend/dist missing — build the frontend first (npm run build)")

config_dir = os.path.join(ROOT, "config")
if os.path.isdir(config_dir):
    datas.append((config_dir, "config"))

# Native vector extension (optional): the CI stage downloads the sqlite-vec
# wheel and copies ``vec0.dll`` here.  Without it the bundled backend falls
# back to the pure numpy index, so the EXE always works.
for candidate in (
    os.path.join(TOOLS, "extensions", "vec0.dll"),
    os.path.join(TOOLS, "extensions", "sqlite_vec.dll"),
):
    if os.path.isfile(candidate):
        datas.append((candidate, "extensions"))
        break

icon = os.path.join(ROOT, "desktop-electron", "build", "icon.ico")

hiddenimports = [
    # local packages (analysed through pathex below)
    "main",
    "core",
    "core.config",
    "core.database",
    "core.bootstrap",
    "core.security",
    "core.dependencies",
    "core.vector_fallback",
    "models.schemas",
    "routers",
    "routers.admin",
    "routers.admin.analytics",
    "routers.admin.health",
    "routers.admin.logs",
    "routers.admin.roles",
    "routers.admin.settings",
    "routers.admin.users",
    "routers.admin.web_sources",
    # lazily imported third-party parsers (upload pipeline)
    "pdfplumber",
    "docx",
    "openpyxl",
    "pptx",
    "bs4",
    "langdetect",
    "markdown",
    "multipart",
    "email_validator",
    # uvicorn runtime bits
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
]

for package in ("services", "utils", "workers"):
    try:
        hiddenimports += collect_submodules(package)
    except Exception:
        pass

a = Analysis(
    [os.path.join(TOOLS, "mini_main.py")],
    pathex=[BACKEND, TOOLS],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Heavy AI runtimes stay out of the download: the app degrades to the
    # numpy vector index + hash embeddings, and reuses the installed models
    # through the bundled backend when they exist.
    excludes=["onnxruntime", "tokenizers", "torch", "tensorflow", "tkinter",
              "matplotlib", "pandas", "PyQt5", "PySide2", "scipy", "IPython"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="Chatbot-Enterprise-Mini",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,               # the console shows the generated credentials
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=icon if os.path.isfile(icon) else None,
)
