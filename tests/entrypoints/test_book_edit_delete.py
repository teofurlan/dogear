from datetime import datetime, timezone

import pytest

from dogear.adapters.mongo_books import MongoBooks, MongoConfig
from dogear.adapters.mongo_captures import MongoCaptures
from dogear.application.covers import cover_key
from dogear.application.pages import page_key
from dogear.entrypoints import api
from tests.adapters.fake_mongo import FakeDatabase
from tests.fakes import FakePhotos

ALICE, BOB = "auth0|alice", "auth0|bob"
CONFIG = MongoConfig("mongodb+srv://db.example.test/", "user", "secret", "dogear")
NOW = datetime(2026, 10, 25, 3, 0, tzinfo=timezone.utc)
CANDIDATE = {"text": "Night quote", "ocr_text": "Night quote", "flags": [], "crop": b"jpeg"}


@pytest.fixture
def library(auth, monkeypatch):
    client, issue, _, _ = auth
    db = FakeDatabase()
    books = MongoBooks(CONFIG)
    monkeypatch.setattr(books, "_collection", lambda: db["books"])
    captures, photos = MongoCaptures(CONFIG, database=db), FakePhotos()
    client.app.dependency_overrides[api.book_store] = lambda: books
    client.app.dependency_overrides[api.capture_store] = lambda: captures
    client.app.dependency_overrides[api.photo_store] = lambda: photos

    def headers(subject=ALICE):
        return {"Authorization": f"Bearer {issue({'sub': subject})}"}

    return client, headers, books, captures, photos


def add_page(captures, photos, owner, book_id, page_id):
    key = page_key(owner, page_id)
    photos.put(key, b"photo")
    captures.create_page(owner, book_id, page_id, key)
    return key


# Editing


def test_the_owner_edits_title_and_author(library):
    client, headers, books, _, _ = library
    book = books.create(ALICE, "Teh Title", "Someone")
    response = client.patch(
        f"/books/{book['id']}",
        json={"title": "  The Title ", "author": "Ada Reed"},
        headers=headers(),
    )
    assert response.status_code == 200
    assert response.json() == {
        "id": book["id"],
        "title": "The Title",
        "author": "Ada Reed",
        "has_cover_photo": False,
    }
    assert books.get_for_owner(ALICE, book["id"])["title"] == "The Title"


def test_leaving_the_author_out_clears_it(library):
    client, headers, books, _, _ = library
    book = books.create(ALICE, "Title", "Wrong Author")
    response = client.patch(f"/books/{book['id']}", json={"title": "Title"}, headers=headers())
    assert response.status_code == 200 and response.json()["author"] is None


@pytest.mark.parametrize(
    "body",
    [{}, {"title": ""}, {"title": "   "}, {"title": "x" * 301}, {"title": "T", "extra": 1}],
)
def test_invalid_edits_are_rejected(library, body):
    client, headers, books, _, _ = library
    book = books.create(ALICE, "Title", None)
    assert client.patch(f"/books/{book['id']}", json=body, headers=headers()).status_code == 422
    assert books.get_for_owner(ALICE, book["id"])["title"] == "Title"


@pytest.mark.parametrize("book_id", ["theirs", "0123456789abcdef01234567", "not-an-id"])
def test_editing_another_readers_or_an_unknown_book_is_not_found(library, book_id):
    client, headers, books, _, _ = library
    theirs = books.create(BOB, "Bob's", None)
    target = theirs["id"] if book_id == "theirs" else book_id
    response = client.patch(f"/books/{target}", json={"title": "Mine now"}, headers=headers())
    assert response.status_code == 404
    assert books.get_for_owner(BOB, theirs["id"])["title"] == "Bob's"


# Deleting


def test_deleting_a_book_removes_its_quotes_pages_and_photos(library):
    client, headers, books, captures, photos = library
    book = books.create(ALICE, "Gone", None)["id"]
    other = books.create(ALICE, "Stays", None)["id"]
    books.set_cover_photo(ALICE, book)
    photos.put(cover_key(ALICE, book), b"cover")
    add_page(captures, photos, ALICE, book, "processed")
    captures.replace_page_quotes(captures.claim_page(NOW, set()), [CANDIDATE], NOW)
    captures.finish_page("processed", NOW)
    photos.delete(page_key(ALICE, "processed"))
    add_page(captures, photos, ALICE, book, "waiting")
    captures.add_quote(ALICE, book, "Kept")
    kept_elsewhere = add_page(captures, photos, ALICE, other, "elsewhere")
    captures.add_quote(ALICE, other, "Other book")

    assert client.delete(f"/books/{book}", headers=headers()).status_code == 204

    assert client.get(f"/books/{book}", headers=headers()).status_code == 404
    assert captures.list_quotes(ALICE, book, None) == []
    assert captures.list_pages(ALICE, book) == []
    assert set(photos.objects) == {kept_elsewhere}
    assert [q["text"] for q in captures.list_quotes(ALICE, None, None)] == ["Other book"]
    assert client.delete(f"/books/{book}", headers=headers()).status_code == 404


@pytest.mark.parametrize("book_id", ["theirs", "0123456789abcdef01234567", "not-an-id"])
def test_deleting_another_readers_or_an_unknown_book_changes_nothing(library, book_id):
    client, headers, books, captures, photos = library
    theirs = books.create(BOB, "Bob's", None)["id"]
    key = add_page(captures, photos, BOB, theirs, "bobs-page")
    captures.add_quote(BOB, theirs, "Bob's quote")
    target = theirs if book_id == "theirs" else book_id
    assert client.delete(f"/books/{target}", headers=headers()).status_code == 404
    assert books.get_for_owner(BOB, theirs) is not None
    assert key in photos.objects
    assert len(captures.list_quotes(BOB, theirs, None)) == 1


def test_a_photo_store_failure_keeps_the_book_so_deleting_can_be_retried(library):
    client, headers, books, captures, photos = library
    book = books.create(ALICE, "Retry me", None)["id"]
    key = add_page(captures, photos, ALICE, book, "waiting")
    captures.add_quote(ALICE, book, "Kept")
    photos.delete_fails = True
    response = client.delete(f"/books/{book}", headers=headers())
    assert response.status_code == 503 and response.json() == {
        "detail": "Photo storage unavailable"
    }
    assert books.get_for_owner(ALICE, book) is not None
    assert len(captures.list_quotes(ALICE, book, None)) == 1
    photos.delete_fails = False
    assert client.delete(f"/books/{book}", headers=headers()).status_code == 204
    assert key not in photos.objects


def test_a_night_run_reading_a_page_during_deletion_leaves_nothing_behind(library):
    client, headers, books, captures, photos = library
    book = books.create(ALICE, "Mid-run", None)["id"]
    add_page(captures, photos, ALICE, book, "in-flight")
    page = captures.claim_page(NOW, set())
    assert client.delete(f"/books/{book}", headers=headers()).status_code == 204
    captures.replace_page_quotes(page, [CANDIDATE], NOW)
    captures.finish_page(page["id"], NOW)
    assert captures.list_quotes(ALICE, None, None) == []
    assert captures.list_pages(ALICE, book) == []
    assert photos.objects == {}


def test_deleting_needs_a_token(library):
    client, _, books, _, _ = library
    book = books.create(ALICE, "Mine", None)["id"]
    assert client.delete(f"/books/{book}").status_code == 401
    assert client.patch(f"/books/{book}", json={"title": "X"}).status_code == 401
