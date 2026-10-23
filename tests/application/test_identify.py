import csv
import subprocess
from io import BytesIO, StringIO
from types import SimpleNamespace

import pytest
from PIL import Image

from dogear.application.identify import CoverError, identify_cover, suggest


def photo(size=(80, 120)):
    data = BytesIO()
    Image.new("RGB", size, "white").save(data, format="PNG")
    return data.getvalue()


def tsv():
    out = StringIO()
    writer = csv.DictWriter(
        out,
        fieldnames=[
            "level",
            "block_num",
            "par_num",
            "line_num",
            "height",
            "conf",
            "text",
        ],
        delimiter="\t",
    )
    writer.writeheader()
    for line, height, text in [(1, 80, "Synthetic title"), (2, 40, "Ada Reed")]:
        writer.writerow(
            {
                "level": 5,
                "block_num": 1,
                "par_num": 1,
                "line_num": line,
                "height": height,
                "conf": 95,
                "text": text,
            }
        )
    return out.getvalue()


def test_layout_suggestions_are_editable_evidence_not_saved_books():
    assert suggest(tsv()) == {
        "title": "Synthetic title",
        "author": "Ada Reed",
        "text": "Synthetic title\nAda Reed",
    }
    assert suggest("") == {"title": "", "author": None, "text": ""}


def test_ocr_uses_bounded_subprocess_without_global_tesseract_mutation(monkeypatch):
    def run(command, **options):
        assert command[1:3] == ["stdin", "stdout"]
        assert command[-2:] == ["-c", "tessedit_create_tsv=1"]
        assert options["timeout"] == 15
        assert options["env"]["OMP_THREAD_LIMIT"] == "2"
        return SimpleNamespace(stdout=tsv().encode())

    monkeypatch.setattr(subprocess, "run", run)
    assert identify_cover(photo())["title"] == "Synthetic title"


@pytest.mark.parametrize(
    "data,status",
    [(b"not an image", 422), (photo((5000, 4100)), 413)],
    ids=["corrupt", "pixels"],
)
def test_invalid_images_are_rejected_before_ocr(monkeypatch, data, status):
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: pytest.fail("OCR called"))
    with pytest.raises(CoverError) as error:
        identify_cover(data)
    assert error.value.status == status


def test_timeout_fails_safely_without_private_process_output(monkeypatch):
    def run(*args, **kwargs):
        raise subprocess.TimeoutExpired("private path", 15, stderr=b"private details")

    monkeypatch.setattr(subprocess, "run", run)
    with pytest.raises(CoverError) as error:
        identify_cover(photo())
    assert error.value.status == 503
    assert "private" not in error.value.message


@pytest.mark.tesseract
def test_real_ocr_on_a_synthetic_cover():
    import shutil
    from pathlib import Path

    from PIL import ImageDraw, ImageFont

    from dogear.adapters.tesseract_ocr import default_tesseract_cmd

    if (
        not shutil.which(default_tesseract_cmd())
        or not Path("models/tessdata/spa.traineddata").exists()
    ):
        pytest.skip("local Spanish Tesseract data unavailable")
    try:
        font = ImageFont.truetype("arial.ttf", 80)
        author_font = ImageFont.truetype("arial.ttf", 45)
    except OSError:
        pytest.skip("synthetic cover test font unavailable")
    image = Image.new("RGB", (1000, 1200), "white")
    draw = ImageDraw.Draw(image)
    draw.text((60, 230), "SYNTHETIC BOOK", fill="black", font=font)
    draw.text((90, 750), "Ada Reed", fill="black", font=author_font)
    data = BytesIO()
    image.save(data, format="PNG")
    result = identify_cover(data.getvalue())
    assert result["title"] == "SYNTHETIC BOOK"
    assert result["author"] == "Ada Reed"
