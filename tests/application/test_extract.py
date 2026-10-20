import numpy as np

from dogear.application.extract import WORD_PAD, extract_quotes, passage_crop
from dogear.domain.passages import Box, Passage, Word
from dogear.ports.reader import ReaderUnavailable

from tests.imaging.test_highlight import HIGHLIGHTERS, TINTED, page_photo

# Five words laid over the tinted block of the synthetic page, and three outside it.
INSIDE = [Box(TINTED.x + 10 + i * 40, TINTED.y + 15, 30, 14) for i in range(5)]
OUTSIDE = [Box(60 + i * 40, 300, 30, 14) for i in range(3)]


class FakeOcr:
    def __init__(self, texts_inside=("one", "two", "three", "four", "five")):
        self.texts_inside = texts_inside

    def read_words(self, img):
        words = [Word(t, b, 90.0, (1, 1, 1)) for t, b in zip(self.texts_inside, INSIDE)]
        words += [Word(t, b, 90.0, (1, 2, 1)) for t, b in zip(("x", "y", "z"), OUTSIDE)]
        return words


class FakeReader:
    def __init__(self, reply="One two three four five."):
        self.reply = reply
        self.crops = []

    def read(self, crop):
        self.crops.append(crop)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


def photo():
    return page_photo(HIGHLIGHTERS["yellow"])


def test_without_a_model_the_ocr_text_is_returned_and_flagged():
    (quote,) = extract_quotes(photo(), FakeOcr())

    assert quote.text == "one two three four five"
    assert quote.flags == ("ocr_only",)


def test_the_model_text_is_kept_when_both_readings_agree():
    (quote,) = extract_quotes(photo(), FakeOcr(), FakeReader())

    assert quote.text == "One two three four five."
    assert quote.ocr_text == "one two three four five"
    assert quote.flags == ()


def test_dropped_words_are_flagged():
    (quote,) = extract_quotes(photo(), FakeOcr(), FakeReader("One five."))

    assert quote.flags == ("readings_disagree",)
    assert quote.missing == ("two", "three", "four")


def test_a_failing_model_falls_back_to_ocr_and_says_so(caplog):
    (quote,) = extract_quotes(photo(), FakeOcr(), FakeReader(ReaderUnavailable("connection refused")))

    assert quote.text == "one two three four five"
    assert quote.flags == ("model_unavailable",)
    assert "connection refused" in caplog.text


def test_the_model_sees_the_passage_shaped_like_a_text_selection():
    # A passage that starts mid-line and ends mid-line, over three lines.
    line1 = [Word("f0", Box(100, 10, 30, 14), 90.0, (1, 1, 1)), Word("f1", Box(140, 10, 30, 14), 90.0, (1, 1, 1))]
    line2 = [Word("m0", Box(20, 30, 70, 14), 90.0, (1, 1, 2)), Word("m1", Box(100, 30, 70, 14), 90.0, (1, 1, 2))]
    line3 = [Word("l0", Box(20, 50, 30, 14), 90.0, (1, 1, 3))]
    passage = Passage(tuple(line1 + line2 + line3))
    img = np.zeros((100, 200, 3), np.uint8)  # all "ink", so anything kept is 0

    crop = passage_crop(img, passage)

    box = passage.box
    assert crop.shape[:2] == (box.h, box.w)
    row = lambda y: y - box.y + 5
    col = lambda x: x - box.x
    assert np.all(crop[row(10), : col(100) - WORD_PAD] == 255)  # before the first word: blank
    assert np.all(crop[row(10), col(100) : col(170)] == 0)  # the first line from the passage start
    assert np.all(crop[row(30), :] == 0)  # a middle line is kept whole, gaps included
    assert np.all(crop[row(50), col(50) + WORD_PAD :] == 255)  # after the last word: blank


def test_unhighlighted_words_never_become_quotes():
    quotes = extract_quotes(page_photo(None), FakeOcr())

    assert quotes == []
