"""Transient cover OCR. Suggestions are evidence for a reader, never saved records."""

import csv
import os
import subprocess
import warnings
from collections import defaultdict
from io import BytesIO, StringIO
from pathlib import Path

MAX_BYTES = 6 * 1024 * 1024
MAX_PIXELS = 20_000_000


# Tesseract needs to find itself and its data, nothing else from the service.
OCR_ENVIRONMENT = (
    "PATH",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "TESSDATA_PREFIX",
    "LANG",
    "LC_ALL",
)


def ocr_environment() -> dict[str, str]:
    return {name: os.environ[name] for name in OCR_ENVIRONMENT if name in os.environ}


class CoverError(Exception):
    def __init__(self, status: int, message: str):
        self.status, self.message = status, message


def suggest(tsv: str) -> dict:
    lines = defaultdict(list)
    for row in csv.DictReader(StringIO(tsv), delimiter="\t"):
        if row.get("level") != "5" or not row.get("text", "").strip():
            continue
        if float(row["conf"]) < 40:
            continue
        key = (row["block_num"], row["par_num"], row["line_num"])
        lines[key].append(row)
    ranked = []
    for rows in lines.values():
        text = " ".join(row["text"].strip() for row in rows)
        if any(char.isalpha() for char in text):
            ranked.append((max(int(row["height"]) for row in rows), text))
    text = "\n".join(line for _, line in ranked)[:2000]
    if not ranked:
        return {"title": "", "author": None, "text": text}
    largest = max(height for height, _ in ranked)
    title = " ".join(line for height, line in ranked if height >= largest * 0.8)[:300]
    others = [
        (height, line)
        for height, line in ranked
        if largest * 0.45 <= height < largest * 0.8
    ]
    author = max(others, default=(0, None), key=lambda item: item[0])[1]
    if author:
        author = (
            author.removeprefix("by ").removeprefix("By ").removeprefix("por ")[:300]
        )
    return {"title": title, "author": author, "text": text}


def load_photo(data: bytes, what: str = "cover photo"):
    """Validate an upload and return it upright as an RGB image, or raise CoverError."""
    # Lazy import keeps health/docs and normal book requests independent of imaging.
    from PIL import Image, ImageOps, UnidentifiedImageError

    if not data or len(data) > MAX_BYTES:
        raise CoverError(422, f"Choose a non-empty JPEG or PNG {what}")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format not in {"JPEG", "PNG"}:
                    raise CoverError(415, f"Choose a JPEG or PNG {what}")
                if image.width * image.height > MAX_PIXELS or max(image.size) > 10000:
                    raise CoverError(413, "Use a smaller photo (at most 20 megapixels)")
                return ImageOps.exif_transpose(image).convert("RGB")
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise CoverError(422, "The photo could not be read; try JPEG or PNG") from None


def identify_cover(data: bytes) -> dict:
    from dogear.adapters.tesseract_ocr import default_tesseract_cmd

    image = load_photo(data)
    image.thumbnail((1800, 1800))
    output = BytesIO()
    image.save(output, format="PNG")
    command = [default_tesseract_cmd(), "stdin", "stdout", "-l", "spa", "--psm", "11"]
    tessdata = os.environ.get("DOGEAR_TESSDATA")
    local = Path("models/tessdata")
    if not tessdata and (local / "spa.traineddata").exists():
        tessdata = str(local.resolve())
    if tessdata:
        command += ["--tessdata-dir", tessdata]
    # Local language directories need not contain Tesseract's named config files.
    command += ["-c", "tessedit_create_tsv=1"]
    try:
        result = subprocess.run(
            command,
            input=output.getvalue(),
            capture_output=True,
            timeout=15,
            check=True,
            env={**ocr_environment(), "OMP_THREAD_LIMIT": "2"},
        )
        return suggest(result.stdout.decode("utf-8"))
    except (OSError, subprocess.SubprocessError, UnicodeError, KeyError, ValueError):
        raise CoverError(
            503, "Cover reading is unavailable; enter the details manually"
        ) from None
