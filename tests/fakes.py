"""In-memory stand-ins for the photo and capture stores."""

from datetime import datetime, timedelta, timezone
from itertools import count

from dogear.ports.captures import MAX_ATTEMPTS, CapturesUnavailable
from dogear.ports.photo_store import PhotosUnavailable

STALE = timedelta(hours=2)


class FakePhotos:
    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.unavailable = False
        self.delete_fails = False

    def _check(self):
        if self.unavailable:
            raise PhotosUnavailable()

    def put(self, key, data):
        self._check()
        self.objects[key] = data

    def get(self, key):
        self._check()
        if key not in self.objects:
            raise PhotosUnavailable()
        return self.objects[key]

    def delete(self, key):
        if self.delete_fails:
            raise PhotosUnavailable()
        self._check()
        self.objects.pop(key, None)


class FakeCaptures:
    def __init__(self):
        self.books: set[tuple[str, str]] = set()
        self.pages: list[dict] = []
        self.quotes: list[dict] = []
        self.unavailable = False
        self._ids = count(1)
        self._clock = datetime(2026, 10, 23, tzinfo=timezone.utc)

    def _check(self):
        if self.unavailable:
            raise CapturesUnavailable()

    def _now(self):
        self._clock += timedelta(seconds=1)
        return self._clock

    def add_book(self, owner, book_id):
        self.books.add((owner, book_id))

    def add_page(self, owner, book_id, status="pending", attempts=0, claimed_at=None):
        page = {
            "id": f"page{next(self._ids)}",
            "owner": owner,
            "book_id": book_id,
            "key": f"pages/test/{next(self._ids)}.jpg",
            "status": status,
            "attempts": attempts,
            "claimed_at": claimed_at,
            "error": None,
            "created_at": self._now(),
        }
        self.pages.append(page)
        return page

    def _page(self, page):
        return {
            "id": page["id"],
            "book_id": page["book_id"],
            "status": page["status"],
            "created_at": page["created_at"].isoformat(),
        }

    def _quote(self, quote):
        return {
            "id": quote["id"],
            "book_id": quote["book_id"],
            "page_id": quote["page_id"],
            "text": quote["text"],
            "flags": list(quote["flags"]),
            "status": quote["status"],
            "has_crop": quote["crop"] is not None,
            "created_at": quote["created_at"].isoformat(),
        }

    def _insert_quote(
        self, owner, book_id, page_id, text, ocr_text, flags, status, crop
    ):
        now = self._now()
        quote = {
            "id": f"quote{next(self._ids)}",
            "owner": owner,
            "book_id": book_id,
            "page_id": page_id,
            "text": text,
            "ocr_text": ocr_text,
            "flags": list(flags),
            "status": status,
            "crop": crop,
            "created_at": now,
            "updated_at": now,
        }
        self.quotes.append(quote)
        return quote

    def _owned(self, owner, quote_id):
        return next(
            (q for q in self.quotes if q["id"] == quote_id and q["owner"] == owner),
            None,
        )

    # CaptureStore
    def owns_book(self, owner, book_id):
        self._check()
        return (owner, book_id) in self.books

    def create_page(self, owner, book_id, page_id, key):
        self._check()
        page = self.add_page(owner, book_id)
        page.update(id=page_id, key=key)
        return self._page(page)

    def list_pages(self, owner, book_id):
        self._check()
        found = [
            p for p in self.pages if p["owner"] == owner and p["book_id"] == book_id
        ]
        return [self._page(p) for p in reversed(found)]

    def list_quotes(self, owner, book_id, status):
        self._check()
        return [
            self._quote(q)
            for q in self.quotes
            if q["owner"] == owner
            and book_id in (None, q["book_id"])
            and status in (None, q["status"])
        ]

    def quote_crop(self, owner, quote_id):
        self._check()
        quote = self._owned(owner, quote_id)
        return quote["crop"] if quote else None

    def update_quote(self, owner, quote_id, text, status):
        self._check()
        quote = self._owned(owner, quote_id)
        if quote is None:
            return None
        if text is not None:
            quote["text"] = text
        if status is not None:
            quote["status"] = status
        quote["updated_at"] = self._now()
        return self._quote(quote)

    def delete_quote(self, owner, quote_id):
        self._check()
        quote = self._owned(owner, quote_id)
        if quote:
            self.quotes.remove(quote)
        return quote is not None

    def add_quote(self, owner, book_id, text):
        self._check()
        return self._quote(
            self._insert_quote(owner, book_id, None, text, text, [], "kept", None)
        )

    # NightStore
    def claim_page(self, now, exclude):
        self._check()
        for page in self.pages:
            eligible = (
                page["status"] == "pending"
                or (page["status"] == "failed" and page["attempts"] < MAX_ATTEMPTS)
                or (
                    page["status"] == "processing"
                    and page["attempts"] < MAX_ATTEMPTS
                    and page["claimed_at"] < now - STALE
                )
            )
            if eligible and page["id"] not in exclude:
                page.update(status="processing", claimed_at=now, error=None)
                page["attempts"] += 1
                return {
                    k: page[k] for k in ("id", "owner", "book_id", "key", "attempts")
                }
        return None

    def replace_page_quotes(self, page, quotes, now):
        self._check()
        self.quotes = [
            q
            for q in self.quotes
            if not (q["page_id"] == page["id"] and q["status"] == "pending")
        ]
        for quote in quotes:
            self._insert_quote(
                page["owner"],
                page["book_id"],
                page["id"],
                quote["text"],
                quote["ocr_text"],
                quote["flags"],
                "pending",
                quote["crop"],
            )

    def _stored(self, page_id):
        return next(p for p in self.pages if p["id"] == page_id)

    def finish_page(self, page_id, now):
        self._check()
        self._stored(page_id).update(status="processed", processed_at=now)

    def fail_page(self, page_id, error):
        self._check()
        self._stored(page_id).update(status="failed", error=error)
