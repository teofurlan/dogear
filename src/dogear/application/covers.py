"""Book cover photos: storage keys and preparation."""

import hashlib
from io import BytesIO

from dogear.application.identify import load_photo

JPEG_QUALITY = 90


def cover_key(owner: str, book_id: str) -> str:
    """Object key for a book's cover photo; owner subject is hashed, never exposed."""
    digest = hashlib.sha256(owner.encode()).hexdigest()
    return f"covers/{digest}/{book_id}.jpg"


def prepare_cover_photo(data: bytes) -> bytes:
    """Validate an upload and re-encode it as an upright JPEG without metadata."""
    output = BytesIO()
    load_photo(data, "cover photo").save(output, format="JPEG", quality=JPEG_QUALITY)
    return output.getvalue()
