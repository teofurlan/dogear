"""Deleting a book with everything tied to it."""

import logging

from dogear.application.covers import cover_key
from dogear.application.pages import page_key
from dogear.ports.captures import CaptureStore
from dogear.ports.photo_store import PhotosUnavailable, PhotoStore

log = logging.getLogger(__name__)


def delete_book(
    captures: CaptureStore, photos: PhotoStore, owner: str, book_id: str
) -> bool:
    """Remove an own book, its quotes, pages and photos; False if unknown or foreign.

    Photos go first: if the photo store fails nothing else is removed, so a retry is
    safe. Raises CapturesUnavailable or PhotosUnavailable.
    """
    book = captures.get_book(owner, book_id)
    if book is None:
        return False
    keys = [
        page_key(owner, page["id"])
        for page in captures.list_pages(owner, book_id)
        if page["status"] != "processed"
    ]
    if book["has_cover_photo"]:
        keys.append(cover_key(owner, book_id))
    for key in keys:
        photos.delete(key)
    late = captures.delete_book(owner, book_id)
    if late is None:
        return False
    # Pages uploaded between the listing and the deletion.
    for key in set(late) - set(keys):
        try:
            photos.delete(key)
        except PhotosUnavailable:
            log.warning("a page photo of a deleted book was not deleted")
    return True
