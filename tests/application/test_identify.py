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
        "lines": [
            {
                "text": "Synthetic title",
                "box": [0.0, 0.0, 0.0, 1.0],
                "role": "title",
            },
            {
                "text": "Ada Reed",
                "box": [0.0, 0.0, 0.0, 1.0],
                "role": "author",
            },
        ],
    }
    assert suggest("") == {"title": "", "author": None, "text": "", "lines": []}


def test_suggest_boxes_and_roles_from_hand_written_tsv():
    out = StringIO()
    writer = csv.DictWriter(
        out,
        fieldnames=[
            "level",
            "block_num",
            "par_num",
            "line_num",
            "left",
            "top",
            "width",
            "height",
            "conf",
            "text",
        ],
        delimiter="\t",
    )
    writer.writeheader()
    # Line 1: Title in 2 words (height 100)
    writer.writerow(
        {
            "level": 5,
            "block_num": 1,
            "par_num": 1,
            "line_num": 1,
            "left": 100,
            "top": 200,
            "width": 300,
            "height": 100,
            "conf": 90,
            "text": "Great",
        }
    )
    writer.writerow(
        {
            "level": 5,
            "block_num": 1,
            "par_num": 1,
            "line_num": 1,
            "left": 450,
            "top": 200,
            "width": 450,
            "height": 100,
            "conf": 90,
            "text": "Novel",
        }
    )
    # Line 2: Author (height 55; 55% of 100, so within 0.45..0.8)
    writer.writerow(
        {
            "level": 5,
            "block_num": 1,
            "par_num": 1,
            "line_num": 2,
            "left": 200,
            "top": 800,
            "width": 500,
            "height": 55,
            "conf": 85,
            "text": "by Arthur Conan",
        }
    )
    # Line 3: Other text (height 30; < 45)
    writer.writerow(
        {
            "level": 5,
            "block_num": 1,
            "par_num": 1,
            "line_num": 3,
            "left": 300,
            "top": 1600,
            "width": 400,
            "height": 30,
            "conf": 75,
            "text": "Third Edition",
        }
    )

    result = suggest(out.getvalue(), width=1000, height=2000)
    assert result["title"] == "Great Novel"
    assert result["author"] == "Arthur Conan"
    assert result["text"] == "Great Novel\nby Arthur Conan\nThird Edition"
    assert result["lines"] == [
        {
            "text": "Great Novel",
            "box": [0.1, 0.1, 0.8, 0.05],
            "role": "title",
        },
        {
            "text": "by Arthur Conan",
            "box": [0.2, 0.4, 0.5, 0.0275],
            "role": "author",
        },
        {
            "text": "Third Edition",
            "box": [0.3, 0.8, 0.4, 0.015],
            "role": None,
        },
    ]


def test_suggest_normalization_and_clamping():
    out = StringIO()
    writer = csv.DictWriter(
        out,
        fieldnames=[
            "level",
            "block_num",
            "par_num",
            "line_num",
            "left",
            "top",
            "width",
            "height",
            "conf",
            "text",
        ],
        delimiter="\t",
    )
    writer.writeheader()
    # Word extending outside image bounds
    writer.writerow(
        {
            "level": 5,
            "block_num": 1,
            "par_num": 1,
            "line_num": 1,
            "left": -100,
            "top": -50,
            "width": 1500,
            "height": 1200,
            "conf": 90,
            "text": "Boundary Test",
        }
    )
    # Word with fractional coordinates to check rounding to 4 decimals
    writer.writerow(
        {
            "level": 5,
            "block_num": 1,
            "par_num": 1,
            "line_num": 2,
            "left": 123,
            "top": 456,
            "width": 789,
            "height": 234,
            "conf": 90,
            "text": "Rounding Test",
        }
    )

    result = suggest(out.getvalue(), width=1000, height=1000)
    assert result["lines"][0]["box"] == [0.0, 0.0, 1.0, 1.0]
    assert result["lines"][1]["box"] == [0.123, 0.456, 0.789, 0.234]


def test_suggest_lines_capped_at_200():
    out = StringIO()
    writer = csv.DictWriter(
        out,
        fieldnames=[
            "level",
            "block_num",
            "par_num",
            "line_num",
            "left",
            "top",
            "width",
            "height",
            "conf",
            "text",
        ],
        delimiter="\t",
    )
    writer.writeheader()
    for i in range(250):
        writer.writerow(
            {
                "level": 5,
                "block_num": 1,
                "par_num": 1,
                "line_num": i + 1,
                "left": 10,
                "top": 10 + i,
                "width": 100,
                "height": 20,
                "conf": 90,
                "text": f"Line {i}",
            }
        )
    result = suggest(out.getvalue(), width=1000, height=3000)
    assert len(result["lines"]) == 200
    assert result["lines"][0]["text"] == "Line 0"
    assert result["lines"][199]["text"] == "Line 199"


def test_exif_orientation_normalizes_in_upright_frame(monkeypatch):
    # Image is 100 x 200. Orientation 6 (rotate 90 CW) transposes it to 200 x 100 upright.
    image = Image.new("RGB", (100, 200), "white")
    exif = image.getexif()
    exif[0x0112] = 6
    data = BytesIO()
    image.save(data, format="JPEG", exif=exif)

    tsv_out = StringIO()
    writer = csv.DictWriter(
        tsv_out,
        fieldnames=[
            "level",
            "block_num",
            "par_num",
            "line_num",
            "left",
            "top",
            "width",
            "height",
            "conf",
            "text",
        ],
        delimiter="\t",
    )
    writer.writeheader()
    writer.writerow(
        {
            "level": 5,
            "block_num": 1,
            "par_num": 1,
            "line_num": 1,
            "left": 20,
            "top": 10,
            "width": 40,
            "height": 30,
            "conf": 95,
            "text": "Upright Text",
        }
    )

    def run(command, **options):
        return SimpleNamespace(stdout=tsv_out.getvalue().encode("utf-8"))

    monkeypatch.setattr(subprocess, "run", run)
    result = identify_cover(data.getvalue())
    # Upright dimensions are 200 width x 100 height.
    # left: 20/200 = 0.1, top: 10/100 = 0.1, width: 40/200 = 0.2, height: 30/100 = 0.3.
    assert result["lines"][0]["box"] == [0.1, 0.1, 0.2, 0.3]


def test_ocr_uses_bounded_subprocess_without_global_tesseract_mutation(monkeypatch):
    def run(command, **options):
        assert command[1:3] == ["stdin", "stdout"]
        assert command[-2:] == ["-c", "tessedit_create_tsv=1"]
        assert options["timeout"] == 15
        assert options["env"]["OMP_THREAD_LIMIT"] == "2"
        return SimpleNamespace(stdout=tsv().encode())

    monkeypatch.setattr(subprocess, "run", run)
    assert identify_cover(photo())["title"] == "Synthetic title"


def test_ocr_subprocess_does_not_inherit_service_secrets(monkeypatch):
    monkeypatch.setenv("DOGEAR_MONGODB_PASSWORD", "private-value")
    monkeypatch.setenv("AUTH0_CLIENT_SECRET", "private-value")
    seen = {}

    def run(command, **options):
        seen.update(options["env"])
        return SimpleNamespace(stdout=tsv().encode())

    monkeypatch.setattr(subprocess, "run", run)
    identify_cover(photo())
    assert "private-value" not in seen.values()
    assert seen["OMP_THREAD_LIMIT"] == "2"
    assert "PATH" in seen


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
    title_line = next(line for line in result["lines"] if line["role"] == "title")
    # Title was drawn at (60, 230) on a (1000, 1200) image with font size 80
    assert 0.04 <= title_line["box"][0] <= 0.08
    assert 0.17 <= title_line["box"][1] <= 0.23
    assert title_line["box"][2] >= 0.5
    assert title_line["box"][3] >= 0.04
