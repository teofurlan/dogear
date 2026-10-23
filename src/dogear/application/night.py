"""The night run: pending page photos -> pending quotes for the morning review.

Pages are claimed one at a time so a crash loses at most the page in flight, which
the next run reclaims. A failure never stops the other pages and never deletes a
photo: only a fully processed page loses its object, leaving the quote crops as the
only image kept.
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

import cv2
import numpy as np

from dogear.application.extract import Candidate
from dogear.domain.passages import Box
from dogear.ports.captures import NightStore
from dogear.ports.photo_store import PhotosUnavailable, PhotoStore

CROP_MAX_WIDTH = 800
CROP_QUALITY = 80
CROP_PAD = 8  # px of page context around the passage's bounding box

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class NightSummary:
    claimed: int
    processed: int
    failed: int
    quotes: int

    def __str__(self) -> str:
        return (
            f"pages={self.claimed} processed={self.processed} "
            f"failed={self.failed} quotes={self.quotes}"
        )


def crop_jpeg(img_bgr: np.ndarray, box: Box) -> bytes | None:
    """The passage's box (with a little context) as a small JPEG, for the review."""
    height, width = img_bgr.shape[:2]
    x0, y0 = max(0, box.x - CROP_PAD), max(0, box.y - CROP_PAD)
    x1 = min(width, box.x + box.w + CROP_PAD)
    y1 = min(height, box.y + box.h + CROP_PAD)
    if x1 <= x0 or y1 <= y0:
        return None
    crop = img_bgr[y0:y1, x0:x1]
    if crop.shape[1] > CROP_MAX_WIDTH:
        scale = CROP_MAX_WIDTH / crop.shape[1]
        size = (CROP_MAX_WIDTH, max(1, round(crop.shape[0] * scale)))
        crop = cv2.resize(crop, size, interpolation=cv2.INTER_AREA)
    ok, encoded = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, CROP_QUALITY])
    return encoded.tobytes() if ok else None


def run_night(
    store: NightStore,
    photos: PhotoStore,
    extract: Callable[[np.ndarray], list[Candidate]],
    now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
) -> NightSummary:
    claimed = processed = failed = quotes = 0
    seen: set[str] = set()  # a page that failed waits for the next night
    while (page := store.claim_page(now(), seen)) is not None:
        seen.add(page["id"])
        claimed += 1
        try:
            found = _process(page, store, photos, extract, now)
        except Exception as error:  # noqa: BLE001 - any failure keeps the photo
            log.warning("page %s failed: %s", page["id"], error)
            store.fail_page(page["id"], f"{type(error).__name__}: {error}")
            failed += 1
            continue
        processed += 1
        quotes += found
        try:
            photos.delete(page["key"])
        except PhotosUnavailable:
            log.warning("page %s processed but its photo was not deleted", page["id"])
    return NightSummary(claimed, processed, failed, quotes)


def _process(page, store, photos, extract, now) -> int:
    data = photos.get(page["key"])
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("the photo could not be decoded")
    candidates = extract(image)
    store.replace_page_quotes(
        page,
        [
            {
                "text": c.text,
                "ocr_text": c.ocr_text,
                "flags": list(c.flags),
                "crop": crop_jpeg(image, c.box),
            }
            for c in candidates
        ],
        now(),
    )
    store.finish_page(page["id"], now())
    return len(candidates)
