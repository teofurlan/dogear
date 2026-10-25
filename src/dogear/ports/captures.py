"""Pages and quotes, as the API and the night run need them.

Every API call is scoped to the verified subject of the caller. Stores never raise for
a missing or foreign record: they answer None/False so both look the same to callers.
"""

from datetime import datetime
from typing import Any, Collection, Protocol


MAX_ATTEMPTS = 3  # night runs that may claim one page before it is left as failed


class CapturesUnavailable(Exception):
    """Storage cannot safely complete the requested operation."""


class CaptureStore(Protocol):
    def owns_book(self, owner: str, book_id: str) -> bool: ...

    def get_book(self, owner: str, book_id: str) -> dict[str, Any] | None: ...

    def list_books_for_export(
        self, owner: str, book_ids: Collection[str] | None = None
    ) -> list[dict[str, Any]]: ...

    def create_page(
        self, owner: str, book_id: str, page_id: str, key: str
    ) -> dict[str, Any]:
        """A pending page: {"id", "book_id", "status", "created_at"}."""
        ...

    def list_pages(self, owner: str, book_id: str) -> list[dict[str, Any]]:
        """Pages of the book owned by the caller, newest first."""
        ...

    def list_quotes(
        self, owner: str, book_id: str | None, status: str | None
    ) -> list[dict[str, Any]]:
        """Quotes owned by the caller, oldest first, optionally filtered."""
        ...

    def quote_crop(self, owner: str, quote_id: str) -> bytes | None: ...

    def update_quote(
        self, owner: str, quote_id: str, text: str | None, status: str | None
    ) -> dict[str, Any] | None: ...

    def delete_quote(self, owner: str, quote_id: str) -> bool: ...

    def add_quote(self, owner: str, book_id: str, text: str) -> dict[str, Any]:
        """A kept quote without crop or page."""
        ...


class NightStore(Protocol):
    def claim_page(
        self, now: datetime, exclude: Collection[str]
    ) -> dict[str, Any] | None:
        """Atomically take one page that needs work: {"id", "owner", "book_id", "key"}.

        Eligible: pending, failed with fewer than 3 attempts, or processing for over
        two hours (with fewer than 3 attempts). Taking a page counts as one attempt.
        """
        ...

    def replace_page_quotes(
        self, page: dict[str, Any], quotes: list[dict[str, Any]], now: datetime
    ) -> None:
        """Replace the page's pending quotes ({"text", "ocr_text", "flags", "crop"})."""
        ...

    def finish_page(self, page_id: str, now: datetime) -> None: ...

    def fail_page(self, page_id: str, error: str) -> None: ...
