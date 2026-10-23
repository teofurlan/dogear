"""Page photos: what is stored for the night run, and where."""

import hashlib
from io import BytesIO

from dogear.application.identify import load_photo

JPEG_QUALITY = 90


def page_key(owner: str, page_id: str) -> str:
    """Object key for a page photo; the owner's subject is hashed, never exposed."""
    digest = hashlib.sha256(owner.encode()).hexdigest()
    return f"pages/{digest}/{page_id}.jpg"


def prepare_page_photo(data: bytes) -> bytes:
    """Validate an upload and re-encode it as an upright JPEG without metadata."""
    output = BytesIO()
    load_photo(data, "page photo").save(output, format="JPEG", quality=JPEG_QUALITY)
    return output.getvalue()
