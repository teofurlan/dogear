import numpy as np
import pytest

from dogear.domain.passages import Box
from dogear.imaging.highlight import coverage, find_highlights

PAPER = (226, 230, 236)  # BGR, a slightly warm off-white like real book paper
BACKGROUND = (60, 90, 120)  # a brown table
SKIN = (140, 170, 220)  # a hand holding the book
HIGHLIGHTERS = {  # BGR, the pure pen color; the page gets a faint blend of it
    "yellow": (0, 230, 255),
    "green": (80, 230, 80),
    "pink": (180, 105, 255),
    "blue": (255, 200, 80),
    "orange": (0, 150, 255),
}
STRENGTH = 0.12  # phone photos of highlighter ink are this faint
TINTED = Box(60, 80, 220, 60)


def page_photo(highlighter=None, rng_seed=0):
    rng = np.random.default_rng(rng_seed)
    img = np.empty((480, 400, 3), np.float32)
    img[:] = BACKGROUND
    img[40:440, 30:340] = PAPER  # the page
    img[60:420, 340:395] = SKIN  # a hand touching the page edge
    for y in range(70, 410, 22):  # dark "text" lines
        img[y : y + 8, 50:320] = (40, 40, 40)
    if highlighter is not None:
        region = img[TINTED.y : TINTED.y + TINTED.h, TINTED.x : TINTED.x + TINTED.w]
        region[:] = region * (1 - STRENGTH) + np.array(highlighter, np.float32) * STRENGTH
    img += rng.normal(0, 2.5, img.shape)  # sensor noise
    return np.clip(img, 0, 255).astype(np.uint8)


@pytest.mark.parametrize("color", sorted(HIGHLIGHTERS))
def test_every_highlighter_color_is_found(color):
    found = find_highlights(page_photo(HIGHLIGHTERS[color]))

    assert coverage(found, TINTED) > 0.8


@pytest.mark.parametrize("color", sorted(HIGHLIGHTERS))
def test_untinted_paper_is_not_highlighted(color):
    found = find_highlights(page_photo(HIGHLIGHTERS[color]))

    assert coverage(found, Box(60, 200, 220, 150)) < 0.02


def test_a_page_without_highlights_has_none():
    found = find_highlights(page_photo())

    assert coverage(found, Box(30, 40, 310, 400)) < 0.02


def test_the_hand_and_the_background_are_never_highlights():
    found = find_highlights(page_photo(HIGHLIGHTERS["orange"]))

    assert coverage(found, Box(345, 60, 45, 360)) == 0.0
    assert coverage(found, Box(0, 0, 400, 35)) == 0.0
