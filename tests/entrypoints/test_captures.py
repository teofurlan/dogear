from io import BytesIO

import pytest
from PIL import Image

from dogear.application.pages import page_key
from dogear.entrypoints import api
from tests.fakes import FakeCaptures, FakePhotos

ALICE, BOB = "auth0|alice", "auth0|bob"
BOOK = "book-1"


@pytest.fixture
def capture(auth):
    client, issue, _, _ = auth
    store, photos = FakeCaptures(), FakePhotos()
    client.app.dependency_overrides[api.capture_store] = lambda: store
    client.app.dependency_overrides[api.photo_store] = lambda: photos
    store.add_book(ALICE, BOOK)
    store.add_book(BOB, "book-2")

    def headers(subject=ALICE, **extra):
        return {"Authorization": f"Bearer {issue({'sub': subject})}", **extra}

    return client, headers, store, photos


def image(fmt="PNG", size=(80, 120)):
    data = BytesIO()
    Image.new("RGB", size, "white").save(data, format=fmt)
    return data.getvalue()


def upload(client, headers, book=BOOK, content=None, kind="image/png", subject=ALICE):
    return client.post(
        f"/books/{book}/pages",
        content=image() if content is None else content,
        headers=headers(subject, **{"Content-Type": kind}),
    )


def seed_quote(store, owner=ALICE, book=BOOK, text="A line", crop=None, status="pending"):
    quote = store._insert_quote(owner, book, None, text, text, ["ocr_only"], status, crop)
    return quote["id"]


# Uploading pages


def test_uploading_a_page_stores_a_jpeg_and_a_pending_page(capture):
    client, headers, store, photos = capture
    response = upload(client, headers)
    assert response.status_code == 201
    body = response.json()
    assert set(body) == {"id", "book_id", "status", "created_at"}
    assert (body["book_id"], body["status"]) == (BOOK, "pending")
    (key,) = photos.objects
    assert key == page_key(ALICE, body["id"])
    with Image.open(BytesIO(photos.objects[key])) as stored:
        assert stored.format == "JPEG"
    assert store.pages[0]["key"] == key and store.pages[0]["owner"] == ALICE


def test_pages_need_a_bearer_token(capture):
    client, _, _, photos = capture
    response = client.post("/books/book-1/pages", content=image())
    assert response.status_code == 401
    assert photos.objects == {}


@pytest.mark.parametrize("book", ["book-2", "missing"], ids=["foreign", "unknown"])
def test_uploading_to_a_foreign_or_unknown_book_is_not_found(capture, book):
    client, headers, store, photos = capture
    assert upload(client, headers, book=book).status_code == 404
    assert photos.objects == {} and store.pages == []


@pytest.mark.parametrize(
    "kind,data,status",
    [
        ("text/plain", b"photo", 415),
        ("image/png", b"", 422),
        ("image/png", b"not an image", 422),
        ("image/png", b"x" * (6 * 1024 * 1024 + 1), 413),
        ("image/png", image("GIF"), 415),
    ],
    ids=["wrong-type", "empty", "garbage", "too-large", "gif"],
)
def test_invalid_page_uploads_store_nothing(capture, kind, data, status):
    client, headers, store, photos = capture
    assert upload(client, headers, content=data, kind=kind).status_code == status
    assert photos.objects == {} and store.pages == []


def test_declared_oversize_is_rejected_before_reading_the_body(capture):
    client, headers, _, photos = capture
    response = client.post(
        "/books/book-1/pages",
        content=b"x",
        headers=headers(**{"Content-Type": "image/png", "Content-Length": "6291457"}),
    )
    assert response.status_code == 413
    assert photos.objects == {}


def test_uploads_answer_503_without_photo_storage(auth):
    client, issue, _, _ = auth
    store = FakeCaptures()
    store.add_book(ALICE, BOOK)
    client.app.dependency_overrides[api.capture_store] = lambda: store
    response = client.post(
        "/books/book-1/pages",
        content=image(),
        headers={
            "Authorization": f"Bearer {issue({'sub': ALICE})}",
            "Content-Type": "image/png",
        },
    )
    assert response.status_code == 503
    assert response.json() == {"detail": "Photo storage unavailable"}
    assert store.pages == []


def test_a_failing_photo_store_is_sanitized_and_leaves_no_page(capture):
    client, headers, store, photos = capture
    photos.unavailable = True
    response = upload(client, headers)
    assert response.status_code == 503
    assert response.json() == {"detail": "Photo storage unavailable"}
    assert store.pages == []


def test_a_page_that_cannot_be_recorded_does_not_leave_its_photo(capture):
    client, headers, store, photos = capture
    store.create_page = lambda *args: (_ for _ in ()).throw(
        api.CapturesUnavailable()
    )
    assert upload(client, headers).status_code == 503
    assert photos.objects == {}


def test_listing_pages_shows_own_pages_newest_first_without_photos(capture):
    client, headers, store, _ = capture
    first = upload(client, headers).json()
    second = upload(client, headers).json()
    foreign = store.add_page(BOB, "book-2")
    response = client.get("/books/book-1/pages", headers=headers())
    assert response.status_code == 200
    assert response.json() == [second, first]
    assert client.get("/books/book-2/pages", headers=headers()).status_code == 404
    assert foreign["id"] not in {p["id"] for p in response.json()}


# Reading quotes


def test_quote_list_is_owner_scoped_and_filterable(capture):
    client, headers, store, _ = capture
    pending = seed_quote(store, text="First", status="pending")
    kept = seed_quote(store, text="Second", status="kept")
    store.add_book(ALICE, "book-3")
    elsewhere = seed_quote(store, book="book-3", text="Third")
    seed_quote(store, owner=BOB, book="book-2", text="Private")

    everything = client.get("/quotes", headers=headers()).json()
    assert [q["id"] for q in everything] == [pending, kept, elsewhere]
    assert set(everything[0]) == {
        "id",
        "book_id",
        "page_id",
        "text",
        "flags",
        "status",
        "has_crop",
        "created_at",
    }
    assert everything[0]["flags"] == ["ocr_only"] and everything[0]["has_crop"] is False

    def ids(**params):
        return [
            q["id"] for q in client.get("/quotes", headers=headers(), params=params).json()
        ]

    assert ids(book_id=BOOK) == [pending, kept]
    assert ids(status="kept") == [kept]
    assert ids(book_id="book-3", status="pending") == [elsewhere]
    assert ids(book_id="book-2") == []
    assert client.get("/quotes", headers=headers(), params={"status": "bogus"}).status_code == 422


def test_a_quote_crop_is_private_and_never_cached(capture):
    client, headers, store, _ = capture
    mine = seed_quote(store, crop=b"\xff\xd8jpeg")
    nocrop = seed_quote(store)
    foreign = seed_quote(store, owner=BOB, book="book-2", crop=b"\xff\xd8secret")
    response = client.get(f"/quotes/{mine}/crop", headers=headers())
    assert response.status_code == 200
    assert response.content == b"\xff\xd8jpeg"
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == "private, no-store"
    for quote_id in (nocrop, foreign, "missing"):
        missing = client.get(f"/quotes/{quote_id}/crop", headers=headers())
        assert missing.status_code == 404
    assert client.get(f"/quotes/{mine}/crop").status_code == 401


# Reviewing quotes


def test_a_quote_can_be_edited_and_kept(capture):
    client, headers, store, _ = capture
    quote_id = seed_quote(store, text="Teh line")
    edited = client.patch(
        f"/quotes/{quote_id}", headers=headers(), json={"text": "  The line  "}
    )
    assert edited.status_code == 200
    assert edited.json()["text"] == "The line" and edited.json()["status"] == "pending"
    kept = client.patch(f"/quotes/{quote_id}", headers=headers(), json={"status": "kept"})
    assert kept.json()["status"] == "kept" and kept.json()["text"] == "The line"
    both = client.patch(
        f"/quotes/{quote_id}", headers=headers(), json={"text": "Final", "status": "kept"}
    )
    assert both.json()["text"] == "Final"


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"text": ""},
        {"text": "   "},
        {"text": "x" * 5001},
        {"text": 12},
        {"status": "pending"},
        {"status": "deleted"},
        {"text": "ok", "owner": ALICE},
    ],
)
def test_invalid_quote_edits_are_rejected_and_change_nothing(capture, payload):
    client, headers, store, _ = capture
    quote_id = seed_quote(store, text="Original")
    response = client.patch(f"/quotes/{quote_id}", headers=headers(), json=payload)
    assert response.status_code == 422
    assert store.quotes[0]["text"] == "Original"
    assert store.quotes[0]["status"] == "pending"


def test_a_foreign_quote_cannot_be_edited_or_deleted(capture):
    client, headers, store, _ = capture
    foreign = seed_quote(store, owner=BOB, book="book-2", text="Bob's")
    patched = client.patch(f"/quotes/{foreign}", headers=headers(), json={"text": "Mine"})
    deleted = client.delete(f"/quotes/{foreign}", headers=headers())
    assert (patched.status_code, deleted.status_code) == (404, 404)
    assert store.quotes[0]["text"] == "Bob's"


def test_deleting_a_quote_removes_it(capture):
    client, headers, store, _ = capture
    quote_id = seed_quote(store)
    response = client.delete(f"/quotes/{quote_id}", headers=headers())
    assert response.status_code == 204 and response.content == b""
    assert store.quotes == []
    assert client.delete(f"/quotes/{quote_id}", headers=headers()).status_code == 404


# Adding a missed passage


def test_a_missed_passage_is_added_as_a_kept_quote_without_crop(capture):
    client, headers, store, _ = capture
    response = client.post(
        "/books/book-1/quotes", headers=headers(), json={"text": "  Missed one  "}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["text"] == "Missed one"
    assert (body["status"], body["has_crop"], body["page_id"]) == ("kept", False, None)
    assert body["book_id"] == BOOK and body["flags"] == []
    assert store.quotes[0]["owner"] == ALICE


@pytest.mark.parametrize("payload", [{}, {"text": ""}, {"text": "x" * 5001}, {"text": 1}])
def test_invalid_manual_quotes_are_rejected(capture, payload):
    client, headers, store, _ = capture
    response = client.post("/books/book-1/quotes", headers=headers(), json=payload)
    assert response.status_code == 422 and store.quotes == []


def test_manual_quotes_need_an_owned_book(capture):
    client, headers, store, _ = capture
    for book in ("book-2", "missing"):
        response = client.post(
            f"/books/{book}/quotes", headers=headers(), json={"text": "Nope"}
        )
        assert response.status_code == 404
    assert store.quotes == []


# Availability


def test_capture_routes_answer_503_when_book_storage_is_missing(auth):
    client, issue, _, _ = auth
    owner = {"Authorization": f"Bearer {issue({'sub': ALICE})}"}
    for method, path, body in [
        ("GET", "/quotes", None),
        ("GET", "/quotes/q/crop", None),
        ("PATCH", "/quotes/q", {"text": "x"}),
        ("DELETE", "/quotes/q", None),
        ("POST", "/books/b/quotes", {"text": "x"}),
        ("GET", "/books/b/pages", None),
        ("POST", "/books/b/pages", None),
    ]:
        response = client.request(method, path, headers=owner, json=body)
        assert response.status_code == 503, (method, path)
    assert client.get("/health").status_code == 200


def test_a_failing_capture_store_is_sanitized(capture):
    client, headers, store, _ = capture
    store.unavailable = True
    response = client.get("/quotes", headers=headers())
    assert response.status_code == 503
    assert response.json() == {"detail": "Book storage unavailable"}
