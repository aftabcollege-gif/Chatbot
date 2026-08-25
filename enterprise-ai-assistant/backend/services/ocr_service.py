"""OCR service.

Uses Tesseract via the bundled ``tesseract.exe`` (Windows build) or the system
binary (Linux/macOS) with bundled ``tessdata`` (Persian + English). When no
OCR engine is available it returns an empty string and the document pipeline
records a clear status, rather than failing the upload.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import List, Optional

from core.config import settings


class OCRService:
    def __init__(self) -> None:
        self.binary = self._find_binary()
        self.tessdata = self._find_tessdata()
        self.languages = settings.get("ocr.languages", ["fa", "en"])

    def _find_binary(self) -> Optional[str]:
        # Bundled with the Windows installer.
        bundled = settings.root / "ocr" / "tesseract.exe"
        if bundled.exists():
            return str(bundled)
        return shutil.which("tesseract")

    def _find_tessdata(self) -> Optional[str]:
        bundled = settings.root / "ocr" / "tessdata"
        if bundled.exists():
            return str(bundled)
        return None

    @property
    def available(self) -> bool:
        return self.binary is not None

    def image_to_text(self, image_path: Path) -> str:
        if not self.binary:
            return ""
        cmd: List[str] = [self.binary, str(image_path), "stdout", "-l", "+".join(self.languages)]
        env = None
        if self.tessdata:
            import os

            env = dict(os.environ)
            env["TESSDATA_PREFIX"] = self.tessdata
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=120, env=env
            )
            if result.returncode == 0:
                return result.stdout
        except (subprocess.TimeoutExpired, OSError):
            return ""
        return ""


_service: Optional[OCRService] = None


def get_ocr_service() -> OCRService:
    global _service
    if _service is None:
        _service = OCRService()
    return _service
