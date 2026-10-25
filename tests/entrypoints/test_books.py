import asyncio
import re
import time
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier
from types import SimpleNamespace

import pymongo
import pytest
from bson import ObjectId
from fastapi.testclient import TestClient

from dogear.entrypoints.api import create_app


@pytest.fixture
def mongo(monkeypatch):
    for name, value in {
        "URI": "mongodb+srv://database.example.test/",
        "USERNAME": "application",
        "PASSWORD": "test-only-password",
        "DATABASE": "test_books",
    }.items():
        monkeypatch.setenv(f"DOGEAR_MONGODB_{name}", value)
    state = SimpleNamespace(rows=[], clients=[], unavailable=False, connect_delay=0)

    class Cursor:
        def __init__(self, rows):
            self.rows = rows

        def sort(self, field, direction):
            self.rows.sort(key=lambda row: row[field], reverse=direction < 0)
            return self

        def limit(self, count):
            self.rows = self.rows[:count]
            return self

        def __iter__(self):
            return iter(deepcopy(self.rows))

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    class Collection:
        def check(self):
            with pytest.raises(RuntimeError):
                asyncio.get_running_loop()  # SDK calls must not block the event loop.
            if state.unavailable:
                raise pymongo.errors.ServerSelectionTimeoutError(
                    "private database detail"
                )

        def insert_one(self, row):
            self.check()
            row = {**row, "_id": ObjectId()}
            state.rows.append(deepcopy(row))
            return SimpleNamespace(inserted_id=row["_id"])

        def find(self, query):
            self.check()

            def matches_clause(row, k, v):
                if k == "$or":
                    return any(
                        all(matches_clause(row, subk, subv) for subk, subv in branch.items())
                        for branch in v
                    )
                val = row.get(k)
                if isinstance(v, dict):
                    if "$gt" in v:
                        return val is not None and val > v["$gt"]
                    if "$regex" in v:
                        flags = re.IGNORECASE if v.get("$options") == "i" else 0
                        return val is not None and bool(re.search(v["$regex"], str(val), flags=flags))
                return val == v

            def matches(row):
                return all(matches_clause(row, k, v) for k, v in query.items())

            return Cursor([row for row in state.rows if matches(row)])

        def find_one(self, query):
            self.check()
            for row in state.rows:
                if all(row.get(key) == value for key, value in query.items()):
                    return deepcopy(row)
            return None

    class Client:
        def __init__(self, *args, **kwargs):
            time.sleep(state.connect_delay)
            self.closed = False
            state.clients.append(self)

        def __getitem__(self, database):
            return {"books": Collection()}

        def close(self):
            self.closed = True

    monkeypatch.setattr(pymongo, "MongoClient", Client)
    return state


def headers(issue, subject):
    return {"Authorization": f"Bearer {issue({'sub': subject})}"}


def test_each_verified_reader_can_create_and_list_only_their_books(mongo, auth):
    client, issue, _, _ = auth
    alice, bob = headers(issue, "auth0|alice"), headers(issue, "auth0|bob")
    first = client.post("/books", headers=alice, json={"title": "A quiet morning"})
    assert first.status_code == 201
    assert first.json() == {
        "id": first.json()["id"],
        "title": "A quiet morning",
        "author": None,
        "has_cover_photo": False,
        "catalog_cover_id": None,
        "catalog_checked_at": None,
    }
    assert ObjectId.is_valid(first.json()["id"])
    assert client.get("/books", headers=bob).json() == []
    second = client.post(
        "/books", headers=bob, json={"title": "New horizons", "author": "Ada Reed"}
    )
    assert second.status_code == 201
    for owner, expected in [(alice, first.json()), (bob, second.json())]:
        response = client.get("/books", headers=owner)
        assert response.status_code == 200
        assert response.json() == [expected]


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"title": ""},
        {"title": "   "},
        {"title": 12},
        {"title": "x" * 301},
        {"title": "Valid", "owner_sub": "auth0|bob"},
        {"title": "Valid", "author": "   "},
        {"title": "Valid", "author": {"$ne": None}},
    ],
)
def test_rejected_book_input_leaves_the_readers_books_unchanged(mongo, auth, payload):
    client, issue, _, _ = auth
    owner = headers(issue, "auth0|alice")
    saved = client.post(
        "/books", headers=owner, json={"title": "Keep this book"}
    ).json()
    response = client.post("/books", headers=owner, json=payload)
    assert response.status_code == 422
    assert client.get("/books", headers=owner).json() == [saved]


def test_reader_can_continue_through_a_bounded_list_without_other_readers_books(
    mongo, auth
):
    client, issue, _, _ = auth
    alice, bob = headers(issue, "auth0|alice"), headers(issue, "auth0|bob")
    books = []
    for title in ["First", "Second", "Third"]:
        books.append(client.post("/books", headers=alice, json={"title": title}).json())
        client.post("/books", headers=bob, json={"title": "Not Alice's"})
    first = client.get("/books", headers=alice, params={"limit": 1})
    assert first.status_code == 200
    assert first.json() == books[:1]
    rest = client.get(
        "/books", headers=alice, params={"limit": 2, "after": books[0]["id"]}
    )
    assert rest.status_code == 200
    assert rest.json() == books[1:]
    for params in [{"limit": 0}, {"limit": 101}, {"after": "not-an-object-id"}]:
        assert client.get("/books", headers=alice, params=params).status_code == 422
    assert client.get("/books", headers=alice).json() == books


@pytest.mark.parametrize("method", ["GET", "POST"])
@pytest.mark.parametrize("kind", ["missing", "expired", "tampered"])
def test_books_reject_unverified_callers_without_connecting(mongo, auth, method, kind):
    client, issue, _, _ = auth
    token = issue({"exp": 1}) if kind == "expired" else issue()
    if kind == "tampered":
        body, signature = token.rsplit(".", 1)
        token = body + "." + ("A" if signature[0] != "A" else "B") + signature[1:]
    credentials = {} if kind == "missing" else {"Authorization": f"Bearer {token}"}
    response = client.request(
        method, "/books", headers=credentials, json={"title": "Rejected"}
    )
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert mongo.clients == []


def test_unavailable_storage_is_sanitized_and_does_not_change_saved_books(mongo, auth):
    client, issue, _, _ = auth
    owner = headers(issue, "auth0|alice")
    saved = client.post(
        "/books", headers=owner, json={"title": "Keep this book"}
    ).json()
    mongo.unavailable = True
    for method in ["GET", "POST"]:
        response = client.request(
            method, "/books", headers=owner, json={"title": "Not saved"}
        )
        assert response.status_code == 503
        assert response.json() == {"detail": "Book storage unavailable"}
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/docs").status_code == 200
    assert client.get("/me", headers=owner).json() == {"sub": "auth0|alice"}
    mongo.unavailable = False
    assert client.get("/books", headers=owner).json() == [saved]


@pytest.mark.parametrize(
    "name,value", [("PASSWORD", ""), ("URI", "https://invalid.example")]
)
def test_incomplete_storage_configuration_fails_closed(
    mongo, auth, monkeypatch, name, value
):
    _, issue, _, _ = auth
    monkeypatch.setenv(f"DOGEAR_MONGODB_{name}", value)
    with TestClient(create_app()) as client:
        owner = headers(issue, "auth0|alice")
        for method in ["GET", "POST"]:
            response = client.request(
                method, "/books", headers=owner, json={"title": "Not saved"}
            )
            assert response.status_code == 503
            assert response.json() == {"detail": "Book storage unavailable"}
        assert client.get("/health").status_code == 200
    assert mongo.clients == []


def test_public_routes_do_not_connect_and_a_book_client_is_reused_then_closed(
    mongo, auth
):
    _, issue, _, _ = auth
    with TestClient(create_app()) as client:
        owner = headers(issue, "auth0|alice")
        assert client.get("/health").json() == {"status": "ok"}
        assert client.get("/docs").status_code == 200
        assert client.get("/me", headers=owner).json() == {"sub": "auth0|alice"}
        assert mongo.clients == []
        for _ in range(2):
            assert client.get("/books", headers=owner).json() == []
        assert len(mongo.clients) == 1
        assert not mongo.clients[0].closed
    assert mongo.clients[0].closed


def test_concurrent_first_book_requests_share_one_client(mongo, auth):
    client, issue, _, _ = auth
    owner = headers(issue, "auth0|alice")
    mongo.connect_delay = 0.05  # Simulate the SDK's blocking SRV setup.
    start = Barrier(8)

    def list_books(_):
        start.wait(timeout=5)
        return client.get("/books", headers=owner)

    with ThreadPoolExecutor(max_workers=8) as workers:
        responses = list(workers.map(list_books, range(8)))
    assert all(
        response.status_code == 200 and response.json() == [] for response in responses
    )
    assert len(mongo.clients) == 1


def test_reader_can_get_book_by_id_and_sees_full_payload(mongo, auth):
    client, issue, _, _ = auth
    alice, bob = headers(issue, "auth0|alice"), headers(issue, "auth0|bob")
    created = client.post(
        "/books", headers=alice, json={"title": "Single book", "author": "Ada"}
    ).json()
    response = client.get(f"/books/{created['id']}", headers=alice)
    assert response.status_code == 200
    assert response.json() == {
        "id": created["id"],
        "title": "Single book",
        "author": "Ada",
        "has_cover_photo": False,
        "catalog_cover_id": None,
        "catalog_checked_at": None,
    }


def test_get_book_returns_404_for_other_owner_or_missing_or_invalid_id(mongo, auth):
    client, issue, _, _ = auth
    alice, bob = headers(issue, "auth0|alice"), headers(issue, "auth0|bob")
    created = client.post(
        "/books", headers=alice, json={"title": "Private book"}
    ).json()

    # Other owner returns 404 with generic detail
    other_owner_res = client.get(f"/books/{created['id']}", headers=bob)
    assert other_owner_res.status_code == 404
    assert other_owner_res.json() == {"detail": "Book not found"}

    # Non-existent id returns 404 with generic detail
    missing_res = client.get(f"/books/{ObjectId()}", headers=alice)
    assert missing_res.status_code == 404
    assert missing_res.json() == {"detail": "Book not found"}

    # Invalid id format returns 404 with generic detail
    invalid_res = client.get("/books/not-an-object-id", headers=alice)
    assert invalid_res.status_code == 404
    assert invalid_res.json() == {"detail": "Book not found"}


def test_get_book_fails_closed_when_storage_unavailable(mongo, auth):
    client, issue, _, _ = auth
    owner = headers(issue, "auth0|alice")
    created = client.post("/books", headers=owner, json={"title": "Book"}).json()
    mongo.unavailable = True
    response = client.get(f"/books/{created['id']}", headers=owner)
    assert response.status_code == 503
    assert response.json() == {"detail": "Book storage unavailable"}
    mongo.unavailable = False


def test_list_books_search_by_title_and_author_case_and_accent_insensitive(mongo, auth):
    client, issue, _, _ = auth
    alice, bob = headers(issue, "auth0|alice"), headers(issue, "auth0|bob")
    b1 = client.post(
        "/books", headers=alice, json={"title": "Cien años de soledad", "author": "Gabriel García Márquez"}
    ).json()
    b2 = client.post(
        "/books", headers=alice, json={"title": "El coronel no tiene quien le escriba", "author": "Gabriel Garcia Marquez"}
    ).json()
    b3 = client.post(
        "/books", headers=alice, json={"title": "Ficciones", "author": "Jorge Luis Borges"}
    ).json()
    client.post(
        "/books", headers=bob, json={"title": "Cien años de soledad", "author": "Gabriel García Márquez"}
    )

    # Search title by unaccented query matches accented title
    res_title = client.get("/books", headers=alice, params={"q": "anos"}).json()
    assert [b["id"] for b in res_title] == [b1["id"]]

    # Search author by accented query matches unaccented and accented author
    res_author = client.get("/books", headers=alice, params={"q": "GARCÍA"}).json()
    assert [b["id"] for b in res_author] == [b1["id"], b2["id"]]

    # Bob does not see Alice's books
    assert client.get("/books", headers=bob, params={"q": "Borges"}).json() == []

    # Pagination with q
    p1 = client.get("/books", headers=alice, params={"q": "Gabriel", "limit": 1}).json()
    assert len(p1) == 1
    assert p1[0]["id"] == b1["id"]
    p2 = client.get("/books", headers=alice, params={"q": "Gabriel", "limit": 1, "after": b1["id"]}).json()
    assert len(p2) == 1
    assert p2[0]["id"] == b2["id"]

    # Omitting or empty q returns all books
    assert len(client.get("/books", headers=alice).json()) == 3
    assert len(client.get("/books", headers=alice, params={"q": ""}).json()) == 3


