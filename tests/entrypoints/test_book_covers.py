from io import BytesIO

import pytest
from bson import ObjectId
from PIL import Image

from dogear.adapters.mongo_books import MongoBooks, MongoConfig
from dogear.application.covers import cover_key
from dogear.entrypoints import api
from tests.adapters.fake_mongo import FakeDatabase
from tests.fakes import FakePhotos

ALICE, BOB = "auth0|alice", "auth0|bob"
CONFIG = MongoConfig("mongodb+srv://db.example.test/", "user", "secret", "dogear")


@pytest.fixture
def cover_fixture(auth, monkeypatch):
    client, issue, _, _ = auth
    db = FakeDatabase()
    books = MongoBooks(CONFIG)
    monkeypatch.setattr(books, "_collection", lambda: db["books"])
    photos = FakePhotos()

    client.app.dependency_overrides[api.book_store] = lambda: books
    client.app.dependency_overrides[api.photo_store] = lambda: photos

    alice_book = books.create(ALICE, "Alice's Book", "Alice Author")
    bob_book = books.create(BOB, "Bob's Book", "Bob Author")

    def headers(subject=ALICE, **extra):
        return {"Authorization": f"Bearer {issue({'sub': subject})}", **extra}

    return client, headers, books, photos, alice_book, bob_book


def encoded_image(fmt="PNG", size=(80, 120), color="white"):
    data = BytesIO()
    Image.new("RGB", size, color).save(data, format=fmt)
    return data.getvalue()


def test_upload_cover_stores_jpeg_and_updates_book(cover_fixture):
    client, headers, books, photos, alice_book, _ = cover_fixture
    book_id = alice_book["id"]

    response = client.put(
        f"/books/{book_id}/cover",
        content=encoded_image("PNG"),
        headers=headers(ALICE, **{"Content-Type": "image/png"}),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == book_id
    assert body["has_cover_photo"] is True

    # Check stored in photos
    key = cover_key(ALICE, book_id)
    assert key in photos.objects
    with Image.open(BytesIO(photos.objects[key])) as stored:
        assert stored.format == "JPEG"

    # Check updated in books store
    fetched = books.get_for_owner(ALICE, book_id)
    assert fetched["has_cover_photo"] is True


def test_get_cover_returns_jpeg_only_to_owner(cover_fixture):
    client, headers, _, _, alice_book, bob_book = cover_fixture
    book_id = alice_book["id"]

    # Before upload: 404
    assert client.get(f"/books/{book_id}/cover", headers=headers(ALICE)).status_code == 404

    # Upload cover
    client.put(
        f"/books/{book_id}/cover",
        content=encoded_image("PNG"),
        headers=headers(ALICE, **{"Content-Type": "image/png"}),
    )

    # Alice can get her cover
    response = client.get(f"/books/{book_id}/cover", headers=headers(ALICE))
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "image/jpeg"
    assert response.headers["Cache-Control"] == "private, no-store"
    with Image.open(BytesIO(response.content)) as img:
        assert img.format == "JPEG"

    # Bob cannot get Alice's cover (404)
    assert client.get(f"/books/{book_id}/cover", headers=headers(BOB)).status_code == 404

    # Unauthenticated gets 401
    assert client.get(f"/books/{book_id}/cover").status_code == 401

    # Non-existent book gets 404
    fake_id = str(ObjectId())
    assert client.get(f"/books/{fake_id}/cover", headers=headers(ALICE)).status_code == 404


def test_cannot_upload_cover_for_another_readers_book(cover_fixture):
    client, headers, _, photos, alice_book, _ = cover_fixture
    book_id = alice_book["id"]

    response = client.put(
        f"/books/{book_id}/cover",
        content=encoded_image("PNG"),
        headers=headers(BOB, **{"Content-Type": "image/png"}),
    )
    assert response.status_code == 404
    assert photos.objects == {}


def test_upload_cover_requires_authentication(cover_fixture):
    client, _, _, photos, alice_book, _ = cover_fixture
    response = client.put(
        f"/books/{alice_book['id']}/cover",
        content=encoded_image("PNG"),
        headers={"Content-Type": "image/png"},
    )
    assert response.status_code == 401
    assert photos.objects == {}


def test_rejected_cover_photo_formats_and_sizes(cover_fixture):
    client, headers, _, photos, alice_book, _ = cover_fixture
    book_id = alice_book["id"]

    # Unsupported format
    res = client.put(
        f"/books/{book_id}/cover",
        content=b"GIF89a...",
        headers=headers(ALICE, **{"Content-Type": "image/gif"}),
    )
    assert res.status_code == 415

    # Missing Content-Type
    res = client.put(
        f"/books/{book_id}/cover",
        content=encoded_image("PNG"),
        headers=headers(ALICE),
    )
    assert res.status_code == 415

    # Garbage data
    res = client.put(
        f"/books/{book_id}/cover",
        content=b"not an image",
        headers=headers(ALICE, **{"Content-Type": "image/jpeg"}),
    )
    assert res.status_code == 422

    # Empty data
    res = client.put(
        f"/books/{book_id}/cover",
        content=b"",
        headers=headers(ALICE, **{"Content-Type": "image/jpeg"}),
    )
    assert res.status_code == 422

    assert photos.objects == {}


def test_photo_storage_unavailable_returns_503(cover_fixture):
    client, headers, books, photos, alice_book, _ = cover_fixture
    book_id = alice_book["id"]
    photos.unavailable = True

    # Upload fails gracefully with 503
    res = client.put(
        f"/books/{book_id}/cover",
        content=encoded_image("PNG"),
        headers=headers(ALICE, **{"Content-Type": "image/png"}),
    )
    assert res.status_code == 503
    assert res.json() == {"detail": "Photo storage unavailable"}

    # Book is unchanged
    assert books.get_for_owner(ALICE, book_id)["has_cover_photo"] is False


def test_compensation_deletes_photo_if_db_update_fails(cover_fixture, monkeypatch):
    client, headers, books, photos, alice_book, _ = cover_fixture
    book_id = alice_book["id"]

    from dogear.adapters.mongo_books import BooksUnavailable

    def failing_set_cover(*args, **kwargs):
        raise BooksUnavailable()

    monkeypatch.setattr(books, "set_cover_photo", failing_set_cover)

    res = client.put(
        f"/books/{book_id}/cover",
        content=encoded_image("PNG"),
        headers=headers(ALICE, **{"Content-Type": "image/png"}),
    )
    assert res.status_code == 503
    assert res.json() == {"detail": "Book storage unavailable"}
    # The photo key should have been deleted
    key = cover_key(ALICE, book_id)
    assert key not in photos.objects


def test_put_catalog_cover_matched_stores_id_and_checked_at(cover_fixture):
    client, headers, books, _, alice_book, _ = cover_fixture
    book_id = alice_book["id"]

    res = client.put(
        f"/books/{book_id}/catalog-cover",
        json={
            "cover_id": 12345,
            "title": alice_book["title"],
            "author": alice_book["author"],
        },
        headers=headers(ALICE),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == book_id
    assert data["catalog_cover_id"] == 12345
    assert data["catalog_checked_at"] is not None

    stored = books.get_for_owner(ALICE, book_id)
    assert stored["catalog_cover_id"] == 12345
    assert stored["catalog_checked_at"] == data["catalog_checked_at"]


def test_put_catalog_cover_null_stores_no_match(cover_fixture):
    client, headers, books, _, alice_book, _ = cover_fixture
    book_id = alice_book["id"]

    res = client.put(
        f"/books/{book_id}/catalog-cover",
        json={
            "cover_id": None,
            "title": alice_book["title"],
            "author": alice_book["author"],
        },
        headers=headers(ALICE),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == book_id
    assert data["catalog_cover_id"] is None
    assert data["catalog_checked_at"] is not None

    stored = books.get_for_owner(ALICE, book_id)
    assert stored["catalog_cover_id"] is None
    assert stored["catalog_checked_at"] == data["catalog_checked_at"]


def test_put_catalog_cover_returns_409_when_title_or_author_differ(cover_fixture):
    client, headers, books, _, alice_book, _ = cover_fixture
    book_id = alice_book["id"]

    # Mismatched title returns 409 and stores nothing
    res_title = client.put(
        f"/books/{book_id}/catalog-cover",
        json={
            "cover_id": 12345,
            "title": "A Different Title",
            "author": alice_book["author"],
        },
        headers=headers(ALICE),
    )
    assert res_title.status_code == 409
    assert res_title.json() == {"detail": "Book changed"}
    stored = books.get_for_owner(ALICE, book_id)
    assert stored["catalog_cover_id"] is None
    assert stored["catalog_checked_at"] is None

    # Mismatched author returns 409 and stores nothing
    res_author = client.put(
        f"/books/{book_id}/catalog-cover",
        json={
            "cover_id": 12345,
            "title": alice_book["title"],
            "author": "Different Author",
        },
        headers=headers(ALICE),
    )
    assert res_author.status_code == 409
    assert res_author.json() == {"detail": "Book changed"}
    stored = books.get_for_owner(ALICE, book_id)
    assert stored["catalog_cover_id"] is None
    assert stored["catalog_checked_at"] is None

    # Author None when book has author returns 409
    res_none_author = client.put(
        f"/books/{book_id}/catalog-cover",
        json={
            "cover_id": 12345,
            "title": alice_book["title"],
            "author": None,
        },
        headers=headers(ALICE),
    )
    assert res_none_author.status_code == 409
    assert res_none_author.json() == {"detail": "Book changed"}


@pytest.mark.parametrize(
    "payload",
    [
        {"cover_id": 0, "title": "Valid", "author": "Valid"},
        {"cover_id": -1, "title": "Valid", "author": "Valid"},
        {"cover_id": -999, "title": "Valid", "author": "Valid"},
        {"cover_id": "12345", "title": "Valid", "author": "Valid"},
        {"cover_id": 12.34, "title": "Valid", "author": "Valid"},
        {},
        {"cover_id": 123, "title": "Valid", "author": "Valid", "extra": "field"},
        {"cover_id": 123, "author": "Valid"},
        {"cover_id": 123, "title": "", "author": "Valid"},
        {"cover_id": 123, "title": "   ", "author": "Valid"},
        {"cover_id": 123, "title": "x" * 301, "author": "Valid"},
        {"cover_id": 123, "title": 123, "author": "Valid"},
        {"cover_id": 123, "title": "Valid"},
        {"cover_id": 123, "title": "Valid", "author": ""},
        {"cover_id": 123, "title": "Valid", "author": "   "},
        {"cover_id": 123, "title": "Valid", "author": "x" * 301},
        {"cover_id": 123, "title": "Valid", "author": 123},
    ],
)
def test_put_catalog_cover_rejects_invalid_payload(cover_fixture, payload):
    client, headers, books, _, alice_book, _ = cover_fixture
    res = client.put(
        f"/books/{alice_book['id']}/catalog-cover",
        json=payload,
        headers=headers(ALICE),
    )
    assert res.status_code == 422
    assert books.get_for_owner(ALICE, alice_book["id"])["catalog_cover_id"] is None


def test_put_catalog_cover_owner_scoping_and_not_found(cover_fixture):
    client, headers, _, _, alice_book, bob_book = cover_fixture
    valid_body = {
        "cover_id": 123,
        "title": alice_book["title"],
        "author": alice_book["author"],
    }

    # Unauthenticated
    assert (
        client.put(
            f"/books/{alice_book['id']}/catalog-cover", json=valid_body
        ).status_code
        == 401
    )

    # Bob cannot update Alice's book (404)
    res = client.put(
        f"/books/{alice_book['id']}/catalog-cover",
        json=valid_body,
        headers=headers(BOB),
    )
    assert res.status_code == 404

    # Unknown book (404)
    fake_id = str(ObjectId())
    res = client.put(
        f"/books/{fake_id}/catalog-cover",
        json=valid_body,
        headers=headers(ALICE),
    )
    assert res.status_code == 404

    # Malformed book id (404)
    res = client.put(
        "/books/not-an-id/catalog-cover",
        json=valid_body,
        headers=headers(ALICE),
    )
    assert res.status_code == 404


def test_put_catalog_cover_db_unavailable_returns_503(cover_fixture, monkeypatch):
    client, headers, books, _, alice_book, _ = cover_fixture
    from dogear.adapters.mongo_books import BooksUnavailable

    def failing_set(*args, **kwargs):
        raise BooksUnavailable()

    monkeypatch.setattr(books, "set_catalog_cover", failing_set)
    res = client.put(
        f"/books/{alice_book['id']}/catalog-cover",
        json={
            "cover_id": 123,
            "title": alice_book["title"],
            "author": alice_book["author"],
        },
        headers=headers(ALICE),
    )
    assert res.status_code == 503
    assert res.json() == {"detail": "Book storage unavailable"}

