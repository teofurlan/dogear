"""`dogear-night`: extract quotes from every pending page photo, then exit.

    dogear-night [--no-model] [--model gemma4:e4b] [--cpu-only] [--threads N]

Environment: DOGEAR_MONGODB_* (pages and quotes), DOGEAR_R2_ENDPOINT,
DOGEAR_R2_ACCESS_KEY_ID, DOGEAR_R2_SECRET_ACCESS_KEY, DOGEAR_R2_BUCKET (page photos),
plus the extraction settings of `dogear-extract`: DOGEAR_TESSERACT_CMD,
DOGEAR_TESSDATA, DOGEAR_OLLAMA_URL.
"""
import argparse
import logging
import os
import sys
import time

from dogear.adapters.mongo_books import MongoConfig
from dogear.adapters.mongo_captures import MongoCaptures
from dogear.adapters.ollama_reader import OllamaReader
from dogear.adapters.r2_photos import R2Config, R2Photos
from dogear.adapters.tesseract_ocr import TesseractOcr
from dogear.application.extract import extract_quotes
from dogear.application.night import run_night
from dogear.entrypoints.extract_cli import _tessdata


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="dogear-night", description=__doc__.split("\n")[0])
    parser.add_argument("--no-model", action="store_true", help="OCR only; skip the vision model")
    parser.add_argument("--model", default="gemma4:e4b")
    parser.add_argument("--ollama-url", default=os.environ.get("DOGEAR_OLLAMA_URL", "http://localhost:11434"))
    parser.add_argument("--cpu-only", action="store_true", help="force the model onto the CPU")
    parser.add_argument("--threads", type=int, help="CPU threads for the model")
    parser.add_argument("--lang", default="spa", help="Tesseract language")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="dogear-night: %(message)s")

    mongo, r2 = MongoConfig.from_environment(), R2Config.from_environment()
    if mongo is None or r2 is None:
        print(
            "dogear-night: set the DOGEAR_MONGODB_* and DOGEAR_R2_* variables",
            file=sys.stderr,
        )
        return 2

    ocr = TesseractOcr(tessdata=_tessdata(), lang=args.lang)
    reader = None if args.no_model else OllamaReader(
        model=args.model, url=args.ollama_url, cpu_only=args.cpu_only, threads=args.threads
    )
    store = MongoCaptures(mongo)
    started = time.perf_counter()
    try:
        summary = run_night(
            store, R2Photos(r2), lambda image: extract_quotes(image, ocr, reader)
        )
    finally:
        store.close()
    seconds = round(time.perf_counter() - started, 1)
    print(f"dogear-night: {summary} seconds={seconds}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
