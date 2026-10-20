"""Photo of a highlighted page -> candidate quotes for the morning review.

The color mask and OCR decide which words are a quote and where it starts and ends;
the model only transcribes. Its text is kept, and any disagreement with OCR is flagged.
Flags only point the reviewer's attention: every candidate stays editable.
"""
import logging
from dataclasses import dataclass, replace

import numpy as np

from dogear.domain.agreement import compare
from dogear.domain.passages import Box, Passage, group_passages, rejoin_line_breaks
from dogear.imaging.highlight import coverage, find_highlights
from dogear.ports.ocr import OcrEngine
from dogear.ports.reader import Reader, ReaderUnavailable

WORD_PAD = 2  # px around each word box kept in the crop sent to the model

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Candidate:
    text: str  # the text proposed for review
    ocr_text: str
    box: Box  # in photo pixels
    flags: tuple[str, ...] = ()  # "ocr_only" | "model_unavailable" | "readings_disagree"
    missing: tuple[str, ...] = ()
    extra: tuple[str, ...] = ()


def extract_quotes(img_bgr: np.ndarray, ocr: OcrEngine, reader: Reader | None = None) -> list[Candidate]:
    found = find_highlights(img_bgr)
    words = [replace(w, coverage=coverage(found, w.box)) for w in ocr.read_words(img_bgr)]
    return [_candidate(img_bgr, p, reader) for p in group_passages(words)]


def _candidate(img_bgr: np.ndarray, passage: Passage, reader: Reader | None) -> Candidate:
    ocr_text = passage.text
    if reader is None:
        return Candidate(ocr_text, ocr_text, passage.box, ("ocr_only",))
    try:
        model_text = reader.read(passage_crop(img_bgr, passage))
    except ReaderUnavailable as error:
        log.warning("model unavailable, keeping the OCR text: %s", error)
        return Candidate(ocr_text, ocr_text, passage.box, ("model_unavailable",))
    model_text = rejoin_line_breaks(model_text, [w.text for w in passage.words])
    agreement = compare(ocr_text, model_text)
    return Candidate(
        text=agreement.text,
        ocr_text=ocr_text,
        box=passage.box,
        flags=() if agreement.agrees else ("readings_disagree",),
        missing=tuple(agreement.missing),
        extra=tuple(agreement.extra),
    )


def passage_crop(img_bgr: np.ndarray, passage: Passage) -> np.ndarray:
    """The passage's bounding box, shaped like a text selection.

    Middle lines are kept whole, so the model sees the real text even where OCR boxes
    are wrong. Only the first line before the passage starts and the last line after it
    ends are blanked: a quote that starts or ends mid-line shares those lines with other
    text, which the model must not transcribe.
    """
    box = passage.box
    crop = img_bgr[box.y : box.y + box.h, box.x : box.x + box.w].copy()
    first, last = passage.words[0], passage.words[-1]
    first_rows = _line_rows(passage, first.line, box)
    last_rows = _line_rows(passage, last.line, box)
    crop[first_rows, : max(0, first.box.x - WORD_PAD - box.x)] = 255
    crop[last_rows, last.box.x + last.box.w + WORD_PAD - box.x :] = 255
    return crop


def _line_rows(passage: Passage, line: tuple[int, int, int], box: Box) -> slice:
    words = [w for w in passage.words if w.line == line]
    top = min(w.box.y for w in words) - WORD_PAD
    bottom = max(w.box.y + w.box.h for w in words) + WORD_PAD
    return slice(max(0, top - box.y), max(0, bottom - box.y))
