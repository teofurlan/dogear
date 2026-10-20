"""End-to-end check on real phone photos of highlighted pages.

The photos are the user's own books and are not published (tests/fixtures/private is
git-ignored), so this test is skipped elsewhere and asserts counts only, never text.
"""
from pathlib import Path

import cv2
import pytest

from dogear.adapters.tesseract_ocr import TesseractOcr, default_tesseract_cmd
from dogear.application.extract import extract_quotes

ROOT = Path(__file__).resolve().parents[2]
PHOTOS = ROOT / "tests" / "fixtures" / "private"
TESSDATA = ROOT / "models" / "tessdata"

pytestmark = [pytest.mark.photos, pytest.mark.tesseract]

# Highlighted passages a person sees on each flat page (the curled facing page is ignored).
EXPECTED = {"page-a.jpg": 3, "page-b.jpg": 3}


@pytest.fixture(scope="module")
def ocr():
    if default_tesseract_cmd() is None or not (TESSDATA / "spa.traineddata").exists():
        pytest.skip("needs Tesseract and models/tessdata/spa.traineddata")
    return TesseractOcr(tessdata=TESSDATA)


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_every_highlighted_passage_is_found_once(ocr, name):
    path = PHOTOS / name
    if not path.exists():
        pytest.skip(f"local-only photo {name} is missing")

    quotes = extract_quotes(cv2.imread(str(path)), ocr)

    assert len(quotes) == EXPECTED[name]
    assert all(len(q.text.split()) >= 8 for q in quotes)
