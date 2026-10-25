from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId

from dogear.adapters.mongo_captures import MongoCaptures
from dogear.adapters.mongo_books import MongoConfig
from dogear.ports.captures import CapturesUnavailable
from tests.adapters.fake_mongo import FakeDatabase

NOW = datetime(2026, 10, 24, 3, 0, tzinfo=timezone.utc)
CONFIG = MongoConfig("mongodb+srv://db.example.test/", "user", "secret", "dogear")


@pytest.fixture
def db():
    return FakeDatabase()


@pytest.fixture
def store(db):
    return MongoCaptures(CONFIG, database=db)


def book_for(db, owner):
    return str(db["books"].insert_one({"owner_sub": owner, "title": "T"}).inserted_id)


def test_a_book_belongs_only_to_its_owner(db, store):
    book = book_for(db, "alice")
    assert store.owns_book("alice", book)
    assert not store.owns_book("bob", book)
    assert not store.owns_book("alice", str(ObjectId()))
    assert not store.owns_book("alice", "not-an-object-id")
    fetched = store.get_book("alice", book)
    assert fetched is not None and fetched["id"] == book and fetched["title"] == "T"
    assert store.get_book("bob", book) is None
    assert store.get_book("alice", str(ObjectId())) is None
    assert store.get_book("alice", "not-an-id") is None


def test_pages_are_created_pending_and_listed_newest_first_for_their_owner(store):
    for page_id in ("p1", "p2"):
        created = store.create_page("alice", "b1", page_id, f"pages/x/{page_id}.jpg")
    assert created["id"] == "p2" and created["status"] == "pending"
    assert set(created) == {"id", "book_id", "status", "created_at"}
    store.create_page("bob", "b1", "p3", "pages/y/p3.jpg")
    assert [p["id"] for p in store.list_pages("alice", "b1")] == ["p2", "p1"]
    assert store.list_pages("alice", "other") == []


def test_quotes_are_scoped_filtered_and_edited_by_owner(store):
    mine = store.add_quote("alice", "b1", "First")
    store.add_quote("alice", "b2", "Second")
    theirs = store.add_quote("bob", "b1", "Secret")
    assert (mine["status"], mine["page_id"], mine["has_crop"]) == ("kept", None, False)
    assert [q["text"] for q in store.list_quotes("alice", None, None)] == [
        "First",
        "Second",
    ]
    assert [q["text"] for q in store.list_quotes("alice", "b1", "kept")] == ["First"]
    assert store.list_quotes("alice", None, "pending") == []
    edited = store.update_quote("alice", mine["id"], "Changed", None)
    assert edited["text"] == "Changed"
    assert store.update_quote("alice", theirs["id"], "Mine now", None) is None
    assert store.update_quote("alice", "bad-id", "x", None) is None
    assert not store.delete_quote("alice", theirs["id"])
    assert store.delete_quote("alice", mine["id"])
    assert not store.delete_quote("alice", mine["id"])


def test_night_claims_pages_one_at_a_time_and_counts_attempts(store, db):
    for page_id in ("p1", "p2"):
        store.create_page("alice", "b1", page_id, f"k/{page_id}")
    first = store.claim_page(NOW, set())
    assert (first["id"], first["owner"], first["book_id"], first["key"]) == (
        "p1",
        "alice",
        "b1",
        "k/p1",
    )
    assert store.claim_page(NOW, {"p2"}) is None
    assert store.claim_page(NOW, set())["id"] == "p2"
    assert store.claim_page(NOW, set()) is None
    assert db["pages"].find_one({"_id": "p1"})["attempts"] == 1


def test_night_reclaims_stale_processing_and_retries_failures_up_to_three(store, db):
    store.create_page("alice", "b1", "p1", "k/p1")
    store.claim_page(NOW, set())
    assert store.claim_page(NOW + timedelta(hours=1, minutes=59), set()) is None
    assert store.claim_page(NOW + timedelta(hours=2, minutes=1), set())["id"] == "p1"
    store.fail_page("p1", "boom")  # attempt 2 failed, attempt 3 is allowed
    assert store.claim_page(NOW + timedelta(days=1), set())["id"] == "p1"
    store.fail_page("p1", "boom")
    assert store.claim_page(NOW + timedelta(days=2), set()) is None
    assert db["pages"].find_one({"_id": "p1"})["error"] == "boom"


def test_finishing_a_page_and_replacing_its_pending_quotes(store, db):
    store.create_page("alice", "b1", "p1", "k/p1")
    page = store.claim_page(NOW, set())
    candidate = {"text": "Quote", "ocr_text": "Quate", "flags": ["x"], "crop": b"jpeg"}
    store.replace_page_quotes(page, [candidate], NOW)
    kept = store.list_quotes("alice", "b1", "pending")[0]
    store.update_quote("alice", kept["id"], None, "kept")
    store.replace_page_quotes(page, [candidate, candidate], NOW)  # a retry
    quotes = store.list_quotes("alice", "b1", None)
    assert [q["status"] for q in quotes] == ["kept", "pending", "pending"]
    assert all(q["page_id"] == "p1" and q["has_crop"] for q in quotes)
    assert store.quote_crop("alice", quotes[1]["id"]) == b"jpeg"
    assert store.quote_crop("bob", quotes[1]["id"]) is None
    store.finish_page("p1", NOW)
    done = db["pages"].find_one({"_id": "p1"})
    assert done["status"] == "processed" and done["processed_at"] == NOW


def test_driver_failures_become_capture_unavailable(db):
    class Broken:
        def __getitem__(self, name):
            raise OSError("private detail")

    with pytest.raises(CapturesUnavailable):
        MongoCaptures(CONFIG, database=Broken()).list_quotes("alice", None, None)
