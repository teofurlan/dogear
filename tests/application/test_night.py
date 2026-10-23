from datetime import datetime, timedelta, timezone

import cv2
import numpy as np
import pytest

from dogear.application.extract import Candidate
from dogear.application.night import NightSummary, crop_jpeg, run_night
from dogear.domain.passages import Box
from tests.fakes import FakeCaptures, FakePhotos

NOW = datetime(2026, 10, 24, 3, 0, tzinfo=timezone.utc)


def photo_bytes(width=1600, height=1000):
    image = np.full((height, width, 3), 255, np.uint8)
    return cv2.imencode(".jpg", image)[1].tobytes()


class World:
    def __init__(self):
        self.store, self.photos = FakeCaptures(), FakePhotos()
        self.seen = []
        self.extract = self._extract

    def _extract(self, image):
        self.seen.append(image.shape)
        return [
            Candidate("First quote", "Fisrt quote", Box(100, 100, 1200, 200)),
            Candidate("Second", "Second", Box(50, 400, 300, 60), ("readings_disagree",)),
        ]

    def page(self, data=None, **fields):
        page = self.store.add_page("auth0|alice", "book-1", **fields)
        self.photos.objects[page["key"]] = photo_bytes() if data is None else data
        return page

    def run(self, now=NOW):
        return run_night(self.store, self.photos, self.extract, now=lambda: now)


@pytest.fixture
def world():
    return World()


def test_a_pending_page_becomes_pending_quotes_with_crops_and_loses_its_photo(world):
    page = world.page()
    summary = world.run()
    assert summary == NightSummary(claimed=1, processed=1, failed=0, quotes=2)
    assert page["status"] == "processed" and page["processed_at"] == NOW
    assert world.photos.objects == {}
    first, second = world.store.quotes
    assert (first["owner"], first["book_id"], first["page_id"]) == (
        "auth0|alice",
        "book-1",
        page["id"],
    )
    assert (first["text"], first["ocr_text"], first["status"]) == (
        "First quote",
        "Fisrt quote",
        "pending",
    )
    assert second["flags"] == ["readings_disagree"]
    decoded = cv2.imdecode(np.frombuffer(first["crop"], np.uint8), cv2.IMREAD_COLOR)
    assert first["crop"][:2] == b"\xff\xd8"
    assert decoded.shape[1] <= 800 and decoded.shape[1] > 0
    assert world.seen == [(1000, 1600, 3)]


def test_crops_are_downscaled_to_800px_and_clamped_to_the_photo():
    image = np.full((1000, 1600, 3), 255, np.uint8)
    wide = cv2.imdecode(
        np.frombuffer(crop_jpeg(image, Box(0, 0, 1600, 100)), np.uint8), cv2.IMREAD_COLOR
    )
    assert wide.shape[1] == 800
    small = cv2.imdecode(
        np.frombuffer(crop_jpeg(image, Box(10, 10, 100, 40)), np.uint8), cv2.IMREAD_COLOR
    )
    assert small.shape[1] <= 800 and small.shape[1] >= 100
    outside = cv2.imdecode(
        np.frombuffer(crop_jpeg(image, Box(1500, 900, 400, 400)), np.uint8),
        cv2.IMREAD_COLOR,
    )
    assert outside.shape[0] > 0 and outside.shape[1] > 0
    assert crop_jpeg(image, Box(2000, 2000, 10, 10)) is None


def test_a_page_with_no_candidates_is_still_processed(world):
    world.extract = lambda image: []
    page = world.page()
    assert world.run() == NightSummary(1, 1, 0, 0)
    assert page["status"] == "processed" and world.photos.objects == {}


@pytest.mark.parametrize(
    "case", ["undecodable", "extraction-error", "photo-missing"]
)
def test_a_failing_page_is_marked_failed_and_keeps_its_photo(world, case):
    if case == "extraction-error":
        world.extract = lambda image: (_ for _ in ()).throw(RuntimeError("tesseract died"))
    page = world.page(b"not an image" if case == "undecodable" else None)
    if case == "photo-missing":
        world.photos.objects.clear()
    summary = world.run()
    assert summary == NightSummary(claimed=1, processed=0, failed=1, quotes=0)
    assert page["status"] == "failed" and page["error"]
    assert page["attempts"] == 1
    assert world.store.quotes == []
    assert (page["key"] in world.photos.objects) == (case != "photo-missing")


def test_one_bad_page_does_not_stop_the_others_and_is_tried_once_per_run(world):
    bad = world.page(b"garbage")
    good = world.page()
    assert world.run() == NightSummary(2, 1, 1, 2)
    assert (bad["attempts"], good["status"]) == (1, "processed")


def test_failed_pages_are_retried_on_later_nights_until_three_attempts(world):
    page = world.page(b"garbage")
    for night in range(1, 4):
        world.run(NOW + timedelta(days=night))
        assert (page["status"], page["attempts"]) == ("failed", night)
    assert world.run(NOW + timedelta(days=4)) == NightSummary(0, 0, 0, 0)
    assert page["attempts"] == 3


def test_a_retry_that_succeeds_clears_the_failure(world):
    page = world.page(b"garbage")
    world.run()
    world.photos.objects[page["key"]] = photo_bytes()
    assert world.run(NOW + timedelta(days=1)).processed == 1
    assert page["status"] == "processed"


def test_pages_stuck_in_processing_for_over_two_hours_are_reclaimed(world):
    stuck = world.page(status="processing", attempts=1, claimed_at=NOW - timedelta(hours=3))
    busy = world.page(status="processing", attempts=1, claimed_at=NOW - timedelta(hours=1))
    assert world.run() == NightSummary(1, 1, 0, 2)
    assert stuck["status"] == "processed" and busy["status"] == "processing"
    assert busy["key"] in world.photos.objects


def test_nothing_to_do_is_a_quiet_success(world):
    world.page(status="processed")
    assert world.run() == NightSummary(0, 0, 0, 0)


def test_a_photo_that_cannot_be_deleted_does_not_undo_the_result(world):
    page = world.page()
    world.photos.delete_fails = True
    assert world.run() == NightSummary(1, 1, 0, 2)
    assert page["status"] == "processed" and len(world.store.quotes) == 2


def test_the_summary_is_one_line():
    assert str(NightSummary(5, 3, 2, 9)) == "pages=5 processed=3 failed=2 quotes=9"


def ocr_only(image):
    return [Candidate("Ocr text", "Ocr text", Box(100, 100, 1200, 200), ("model_unavailable",))]


def test_an_unreachable_model_keeps_the_photo_for_another_night(world):
    world.extract = ocr_only
    page = world.page()
    summary = world.run()
    assert summary == NightSummary(claimed=1, processed=0, failed=1, quotes=0)
    assert page["status"] == "failed" and "ReaderUnavailable" in page["error"]
    assert page["key"] in world.photos.objects
    assert world.store.quotes == []


def test_the_last_attempt_settles_for_ocr_text_instead_of_retrying_forever(world):
    world.extract = ocr_only
    page = world.page(status="failed", attempts=2)
    summary = world.run()
    assert summary == NightSummary(claimed=1, processed=1, failed=0, quotes=1)
    assert page["status"] == "processed"
    assert world.store.quotes[0]["flags"] == ["model_unavailable"]
