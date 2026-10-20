"""Tesseract OCR adapter: words and their boxes."""
import os
import shutil
from pathlib import Path

import cv2
import numpy as np
import pytesseract

from dogear.domain.passages import Box, Word

WINDOWS_DEFAULT = Path("C:/Program Files/Tesseract-OCR/tesseract.exe")
UPSCALE = 2  # phone photos have small text; Tesseract reads it far better at 2x


def default_tesseract_cmd() -> str | None:
    """`DOGEAR_TESSERACT_CMD`, else `tesseract` on PATH, else the Windows installer path."""
    configured = os.environ.get("DOGEAR_TESSERACT_CMD")
    if configured:
        return configured
    found = shutil.which("tesseract")
    if found:
        return found
    return str(WINDOWS_DEFAULT) if WINDOWS_DEFAULT.exists() else None


class TesseractOcr:
    def __init__(self, cmd: str | None = None, tessdata: Path | None = None, lang: str = "spa"):
        resolved = cmd or default_tesseract_cmd()
        if resolved is None:
            raise FileNotFoundError("Tesseract not found; set DOGEAR_TESSERACT_CMD")
        pytesseract.pytesseract.tesseract_cmd = resolved
        if tessdata is not None:
            # pytesseract has no per-call environment; the language data dir is process-wide.
            os.environ["TESSDATA_PREFIX"] = str(tessdata)
        self.lang = lang

    def read_words(self, img_bgr: np.ndarray) -> list[Word]:
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        big = cv2.resize(gray, None, fx=UPSCALE, fy=UPSCALE, interpolation=cv2.INTER_CUBIC)
        data = pytesseract.image_to_data(
            big, lang=self.lang, config="--psm 3", output_type=pytesseract.Output.DICT
        )
        words = []
        for i, text in enumerate(data["text"]):
            confidence = float(data["conf"][i])
            if not text.strip() or confidence < 0:
                continue
            box = Box(
                *(int(v) // UPSCALE for v in (data["left"][i], data["top"][i], data["width"][i], data["height"][i]))
            )
            line = (int(data["block_num"][i]), int(data["par_num"][i]), int(data["line_num"][i]))
            words.append(Word(text=text.strip(), box=box, confidence=confidence, line=line))
        return words
