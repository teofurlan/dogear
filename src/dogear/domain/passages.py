"""Turning OCR words with highlight coverage into passages.

Pure rules: no image, OCR engine or model is involved here.
"""
import unicodedata
from dataclasses import dataclass
from typing import Sequence

HIGHLIGHT_THRESHOLD = 0.25  # share of the paper under a word's box that is highlighted
MAX_GAP = 2  # unhighlighted words tolerated inside a passage
MIN_WORDS = 3  # shorter runs are treated as noise


@dataclass(frozen=True)
class Box:
    x: int
    y: int
    w: int
    h: int

    def union(self, other: "Box") -> "Box":
        x0, y0 = min(self.x, other.x), min(self.y, other.y)
        x1 = max(self.x + self.w, other.x + other.w)
        y1 = max(self.y + self.h, other.y + other.h)
        return Box(x0, y0, x1 - x0, y1 - y0)


@dataclass(frozen=True)
class Word:
    text: str
    box: Box
    confidence: float
    line: tuple[int, int, int]  # (block, paragraph, line) in OCR reading order
    coverage: float = 0.0


@dataclass(frozen=True)
class Passage:
    words: tuple[Word, ...]

    @property
    def text(self) -> str:
        return join_hyphens([w.text for w in self.words])

    @property
    def box(self) -> Box:
        box = self.words[0].box
        for w in self.words[1:]:
            box = box.union(w.box)
        return box


def group_passages(
    words: Sequence[Word],
    *,
    threshold: float = HIGHLIGHT_THRESHOLD,
    max_gap: int = MAX_GAP,
    min_words: int = MIN_WORDS,
) -> list[Passage]:
    """Group words, in reading order, into highlighted passages.

    Runs of highlighted words separated by at most ``max_gap`` unhighlighted words
    are merged, because OCR boxes sometimes miss the highlight on a word.
    """
    hits = [i for i, w in enumerate(words) if w.coverage >= threshold]
    spans: list[list[int]] = []
    for i in hits:
        if spans and i - spans[-1][1] - 1 <= max_gap:
            spans[-1][1] = i
        else:
            spans.append([i, i])
    return [
        Passage(tuple(words[start : end + 1]))
        for start, end in spans
        if end - start + 1 >= min_words
    ]


def rejoin_line_breaks(text: str, ocr_tokens: Sequence[str]) -> str:
    """Remove line-break hyphens the model copied, using OCR's line ends as evidence.

    A model reading a crop keeps "cami-nado" where the line broke. A hyphen is dropped
    only when OCR saw that word split at the end of a line, so real hyphenated words
    (which OCR reads as one token) are kept. Whitespace is normalized as well.
    """
    broken = {
        _fold(token[:-1] + ocr_tokens[i + 1])
        for i, token in enumerate(ocr_tokens[:-1])
        if token.endswith("-") and len(token) > 1
    }
    tokens = text.split()
    out = []
    i = 0
    while i < len(tokens):
        token = tokens[i]
        nxt = tokens[i + 1] if i + 1 < len(tokens) else ""
        inner = token.strip("-")
        if "-" in inner and _fold(inner.replace("-", "", 1)) in broken:
            token = token.replace("-", "", 1)
        elif token.endswith("-") and len(token) > 1 and nxt:
            # "ven- tana": a hyphen left before a space. It is a line break when OCR saw
            # it, or when a lowercase word follows (Spanish never writes "word- word").
            joined = token[:-1] + nxt
            if _fold(joined) in broken or nxt[0].islower():
                token, i = joined, i + 1
        out.append(token)
        i += 1
    return " ".join(out)


def _fold(word: str) -> str:
    """Lowercase, without accents or punctuation, for comparing spellings."""
    decomposed = unicodedata.normalize("NFD", word.lower())
    return "".join(ch for ch in decomposed if ch.isalnum())


def join_hyphens(tokens: Sequence[str]) -> str:
    """Join words split by a hyphen at the end of a line."""
    out: list[str] = []
    for token in tokens:
        if out and out[-1].endswith("-") and len(out[-1]) > 1:
            out[-1] = out[-1][:-1] + token
        else:
            out.append(token)
    return " ".join(out)
