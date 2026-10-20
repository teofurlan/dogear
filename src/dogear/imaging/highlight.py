"""Finding highlighter marks on a phone photo of a book page, whatever the pen color.

In a phone photo a highlighter barely changes the paper: in RGB/HSV its saturation is
close to zero. In the Lab color space, which separates lightness (L) from color (a, b),
highlighted paper drifts measurably away from the paper's own tint. Measuring the
*distance* to that tint, not the direction toward one color, makes any pen color work.
"""
from dataclasses import dataclass

import cv2
import numpy as np

from dogear.domain.passages import Box

PAPER_TINT_TOLERANCE = 3.0  # Lab a/b distance still considered plain paper
HIGHLIGHT_DISTANCE = 4.0  # Lab a/b distance from the paper tint that counts as highlighter
TEXT_GAP_KERNEL = 15  # px; closes the text lines so the page is one region
OUTLIER_DISTANCE = 6.0  # Lab a/b distance from the median tint ignored by the tint fit
FIT_ROUNDS = 3
STEP = 4  # px; the tint fit samples one pixel in STEP x STEP


@dataclass(frozen=True)
class Highlights:
    mask: np.ndarray  # bool, highlighted paper
    paper: np.ndarray  # bool, bright page pixels (plain or highlighted), ink excluded


def find_highlights(img_bgr: np.ndarray) -> Highlights:
    lab = cv2.cvtColor(cv2.GaussianBlur(img_bgr, (5, 5), 0), cv2.COLOR_BGR2LAB)
    lightness = lab[..., 0]
    a = lab[..., 1].astype(np.float32)
    b = lab[..., 2].astype(np.float32)

    # Ink, shadows and dark background fall below Otsu's split; paper is above it.
    threshold, _ = cv2.threshold(lightness, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    bright = lightness > threshold
    if not bright.any():
        empty = np.zeros(bright.shape, bool)
        return Highlights(empty, empty)

    tint_a, tint_b = _paper_tint(a, b, bright)
    distance = np.hypot(a - tint_a, b - tint_b)
    page = _page_region(bright & (distance < PAPER_TINT_TOLERANCE))
    paper = bright & page

    mask = paper & (distance > HIGHLIGHT_DISTANCE)
    mask = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
    return Highlights(mask=mask, paper=paper)


def _paper_tint(a: np.ndarray, b: np.ndarray, bright: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The paper's tint at every pixel, as a smooth quadratic surface.

    Uneven light changes the paper's tint across a photo (warmer at one end, cooler at
    the other), so a single reference tint mistakes part of the page for something
    else. Highlights, the hand and the background are outliers: the fit starts from the
    median tint and drops pixels far from it before each refit.
    """
    h, w = a.shape
    ys, xs = np.nonzero(bright[::STEP, ::STEP])
    ys, xs = ys * STEP, xs * STEP
    sa, sb = a[ys, xs], b[ys, xs]
    keep = np.hypot(sa - np.median(sa), sb - np.median(sb)) < OUTLIER_DISTANCE
    design = _quadratic_terms(xs / w, ys / h)
    coef_a = coef_b = None
    for _ in range(FIT_ROUNDS):
        if keep.sum() < design.shape[1] * 10:
            break
        coef_a, *_ = np.linalg.lstsq(design[keep], sa[keep], rcond=None)
        coef_b, *_ = np.linalg.lstsq(design[keep], sb[keep], rcond=None)
        residual = np.hypot(sa - design @ coef_a, sb - design @ coef_b)
        keep = residual < PAPER_TINT_TOLERANCE
    if coef_a is None:
        return np.full(a.shape, np.median(sa)), np.full(b.shape, np.median(sb))
    gy, gx = np.mgrid[0:h, 0:w]
    grid = _quadratic_terms(gx.ravel() / w, gy.ravel() / h)
    return (grid @ coef_a).reshape(h, w), (grid @ coef_b).reshape(h, w)


def _quadratic_terms(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    return np.column_stack([np.ones_like(x), x, y, x * x, x * y, y * y])


def _page_region(paper_like: np.ndarray) -> np.ndarray:
    """The largest paper surface, with the holes inside it (text, highlights) filled.

    Holes are filled instead of taking a convex hull on purpose: a thumb on the page
    edge enters from outside, so it is not a hole and stays excluded, even when its
    color is close to a warm highlighter.
    """
    kernel = np.ones((TEXT_GAP_KERNEL, TEXT_GAP_KERNEL), np.uint8)
    closed = cv2.morphologyEx(paper_like.astype(np.uint8), cv2.MORPH_CLOSE, kernel)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(closed)
    if count < 2:
        return np.zeros(paper_like.shape, bool)
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    region = (labels == largest).astype(np.uint8)

    # Flood the outside from a padded border; whatever the flood cannot reach is a hole.
    padded = np.pad(region, 1)
    flood = padded.copy()
    cv2.floodFill(flood, None, (0, 0), 1)
    holes = flood[1:-1, 1:-1] == 0
    return (region > 0) | holes


def coverage(found: Highlights, box: Box) -> float:
    """Share of the paper inside ``box`` that is highlighted (0.0 when there is no paper)."""
    window = (slice(max(0, box.y), box.y + box.h), slice(max(0, box.x), box.x + box.w))
    paper = found.paper[window]
    total = int(paper.sum())
    if total == 0:
        return 0.0
    return float((found.mask[window] & paper).sum()) / total
