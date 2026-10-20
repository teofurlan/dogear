import shutil
from pathlib import Path

import cv2
import numpy as np
import pytest

from dogear.adapters.tesseract_ocr import TesseractOcr, default_tesseract_cmd

pytestmark = pytest.mark.tesseract

TESSDATA = Path(__file__).resolve().parents[2] / "models" / "tessdata"


@pytest.fixture
def ocr():
    cmd = default_tesseract_cmd()
    if cmd is None or not shutil.which(cmd) and not Path(cmd).exists():
        pytest.skip("Tesseract is not installed")
    tessdata = TESSDATA if (TESSDATA / "spa.traineddata").exists() else None
    return TesseractOcr(cmd=cmd, tessdata=tessdata, lang="spa" if tessdata else "eng")


def test_words_come_back_with_their_boxes(ocr):
    img = np.full((120, 600, 3), 255, np.uint8)
    cv2.putText(img, "hello quiet world", (20, 70), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 0), 3)

    words = ocr.read_words(img)

    assert [w.text for w in words] == ["hello", "quiet", "world"]
    first, second = words[0].box, words[1].box
    assert first.x < second.x
    assert 20 <= first.x <= 40 and first.h > 10
