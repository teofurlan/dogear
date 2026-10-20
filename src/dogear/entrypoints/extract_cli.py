"""`dogear-extract`: print the candidate quotes found on photos of highlighted pages.

    dogear-extract page.jpg [more.jpg ...] [--no-model] [--model gemma4:e4b] [--cpu-only]

Environment: DOGEAR_TESSERACT_CMD (Tesseract binary), DOGEAR_TESSDATA (language data
dir; defaults to ./models/tessdata when present), DOGEAR_OLLAMA_URL.
"""
import argparse
import json
import logging
import os
import sys
import time
from dataclasses import asdict
from pathlib import Path

import cv2

from dogear.adapters.ollama_reader import OllamaReader
from dogear.adapters.tesseract_ocr import TesseractOcr
from dogear.application.extract import extract_quotes


def _tessdata() -> Path | None:
    configured = os.environ.get("DOGEAR_TESSDATA")
    if configured:
        return Path(configured)
    local = Path("models/tessdata")
    return local if (local / "spa.traineddata").exists() else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="dogear-extract", description=__doc__.split("\n")[0])
    parser.add_argument("photos", nargs="+", type=Path)
    parser.add_argument("--no-model", action="store_true", help="OCR only; skip the vision model")
    parser.add_argument("--model", default="gemma4:e4b")
    parser.add_argument("--ollama-url", default=os.environ.get("DOGEAR_OLLAMA_URL", "http://localhost:11434"))
    parser.add_argument("--cpu-only", action="store_true", help="force the model onto the CPU")
    parser.add_argument("--threads", type=int, help="CPU threads for the model")
    parser.add_argument("--lang", default="spa", help="Tesseract language")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="dogear-extract: %(message)s")

    images = {}
    for path in args.photos:
        img = cv2.imread(str(path))
        if img is None:
            print(f"dogear-extract: cannot read {path}", file=sys.stderr)
            return 2
        images[path] = img

    ocr = TesseractOcr(tessdata=_tessdata(), lang=args.lang)
    reader = None if args.no_model else OllamaReader(
        model=args.model, url=args.ollama_url, cpu_only=args.cpu_only, threads=args.threads
    )
    results = []
    for path, img in images.items():
        started = time.perf_counter()
        quotes = extract_quotes(img, ocr, reader)
        results.append(
            {
                "photo": str(path),
                "seconds": round(time.perf_counter() - started, 1),
                "quotes": [asdict(q) for q in quotes],
            }
        )
    json.dump(results, sys.stdout, ensure_ascii=False, indent=2)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
