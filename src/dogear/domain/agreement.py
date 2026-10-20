"""Comparing two independent readings of the same passage: OCR and the model.

OCR is reliable about which words are there but misreads letters; the model spells
well but can silently drop or invent words. The model's text is kept, and word-level
disagreement is reported so the review can flag it.
"""
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher

SIMILAR_WORD = 0.7  # two spellings this similar are the same word read differently
TOLERATED_RUN = 1  # a single stray or missing token does not flag a passage
SAME_LETTERS = 0.85  # differing word runs whose letters match this well are a split/merge


@dataclass(frozen=True)
class Agreement:
    text: str
    agrees: bool
    missing: list[str] = field(default_factory=list)  # in OCR, absent from the model text
    extra: list[str] = field(default_factory=list)  # in the model text, absent from OCR


def _tokens(text: str) -> list[str]:
    tokens = []
    for raw in unicodedata.normalize("NFC", text).lower().split():
        token = "".join(ch for ch in raw if not unicodedata.category(ch).startswith("P"))
        if token.strip("*"):
            tokens.append(token)
    return tokens


def _same_letters(ocr: list[str], model: list[str]) -> bool:
    return SequenceMatcher(a="".join(ocr), b="".join(model)).ratio() >= SAME_LETTERS


def compare(ocr_text: str, model_text: str) -> Agreement:
    ocr, model = _tokens(ocr_text), _tokens(model_text)
    missing: list[str] = []
    extra: list[str] = []
    flagged = False
    for op, i1, i2, j1, j2 in SequenceMatcher(a=ocr, b=model, autojunk=False).get_opcodes():
        if op == "equal":
            continue
        run_missing: list[str] = []
        run_extra: list[str] = []
        if op == "replace" and _same_letters(ocr[i1:i2], model[j1:j2]):
            continue  # the same words, glued into one or split in two by OCR
        if op == "replace":
            for a, b in zip(ocr[i1:i2], model[j1:j2]):
                if SequenceMatcher(a=a, b=b).ratio() < SIMILAR_WORD:
                    run_missing.append(a)
                    run_extra.append(b)
            pairs = min(i2 - i1, j2 - j1)
            run_missing += ocr[i1 + pairs : i2]
            run_extra += model[j1 + pairs : j2]
        elif op == "delete":
            run_missing = ocr[i1:i2]
        elif op == "insert":
            run_extra = model[j1:j2]
        missing += run_missing
        extra += run_extra
        if len(run_missing) > TOLERATED_RUN or len(run_extra) > TOLERATED_RUN:
            flagged = True
    return Agreement(text=model_text, agrees=not flagged, missing=missing, extra=extra)
