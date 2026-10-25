import pytest
from bson import ObjectId
from pymongo.errors import PyMongoError

from dogear.adapters.mongo_books import BooksUnavailable, MongoBooks, MongoConfig
from tests.adapters.fake_mongo import FakeDatabase

CONFIG = MongoConfig("mongodb+srv://db.example.test/", "user", "secret", "dogear")


@pytest.fixture
def db():
    return FakeDatabase()


@pytest.fixture
def books(db, monkeypatch):
    store = MongoBooks(CONFIG)
    monkeypatch.setattr(store, "_collection", lambda: db["books"])
    return store


def test_create_and_get_for_owner(books):
    created = books.create("alice", "Quiet Book", "Ada Reed")
    assert created["title"] == "Quiet Book"
    assert created["author"] == "Ada Reed"
    assert created["has_cover_photo"] is False
    assert ObjectId.is_valid(created["id"])

    fetched = books.get_for_owner("alice", created["id"])
    assert fetched == created

    # Other owner or invalid id returns None
    assert books.get_for_owner("bob", created["id"]) is None
    assert books.get_for_owner("alice", "not-an-id") is None
    assert books.get_for_owner("alice", str(ObjectId())) is None


def test_create_with_cover_photo(books):
    created = books.create("alice", "Covered Book", None, has_cover_photo=True)
    assert created["has_cover_photo"] is True
    fetched = books.get_for_owner("alice", created["id"])
    assert fetched["has_cover_photo"] is True


def test_set_cover_photo(books):
    created = books.create("alice", "Updating Cover", "Author")
    assert created["has_cover_photo"] is False

    updated = books.set_cover_photo("alice", created["id"], True)
    assert updated is not None
    assert updated["has_cover_photo"] is True

    # Non-owner cannot update
    assert books.set_cover_photo("bob", created["id"], True) is None
    assert books.set_cover_photo("alice", "invalid-id", True) is None


def test_set_catalog_cover(books):
    created = books.create("alice", "Quiet Book", "Ada Reed")
    assert created["catalog_cover_id"] is None
    assert created["catalog_checked_at"] is None

    # Set positive cover ID
    updated = books.set_catalog_cover("alice", created["id"], 54321)
    assert updated is not None
    assert updated["catalog_cover_id"] == 54321
    assert updated["catalog_checked_at"] is not None

    # Set null cover ID (no match)
    updated_null = books.set_catalog_cover("alice", created["id"], None)
    assert updated_null is not None
    assert updated_null["catalog_cover_id"] is None
    assert updated_null["catalog_checked_at"] is not None

    # Non-owner or invalid id returns None
    assert books.set_catalog_cover("bob", created["id"], 123) is None
    assert books.set_catalog_cover("alice", "invalid-id", 123) is None
    assert books.set_catalog_cover("alice", str(ObjectId()), 123) is None


def test_update_clears_catalog_cover_only_when_title_or_author_changes(books):
    created = books.create("alice", "Title 1", "Author 1")
    books.set_catalog_cover("alice", created["id"], 100)

    # Same title and author does not clear
    same = books.update("alice", created["id"], "Title 1", "Author 1")
    assert same["catalog_cover_id"] == 100
    assert same["catalog_checked_at"] is not None

    # Change title clears
    diff_title = books.update("alice", created["id"], "Title 2", "Author 1")
    assert diff_title["catalog_cover_id"] is None
    assert diff_title["catalog_checked_at"] is None

    # Re-set catalog cover
    books.set_catalog_cover("alice", created["id"], 200)

    # Change author clears
    diff_author = books.update("alice", created["id"], "Title 2", "Author 2")
    assert diff_author["catalog_cover_id"] is None
    assert diff_author["catalog_checked_at"] is None


def test_owns_book(books):
    created = books.create("alice", "Owned Book", None)
    assert books.owns_book("alice", created["id"]) is True
    assert books.owns_book("bob", created["id"]) is False
    assert books.owns_book("alice", str(ObjectId())) is False
    assert books.owns_book("alice", "invalid-id") is False


def test_list_for_owner_includes_has_cover_photo(books):
    b1 = books.create("alice", "Book One", None, has_cover_photo=False)
    b2 = books.create("alice", "Book Two", None, has_cover_photo=True)
    books.create("bob", "Bob's Book", None, has_cover_photo=True)

    items = books.list_for_owner("alice", limit=10, after=None)
    assert len(items) == 2
    assert items[0]["has_cover_photo"] is False
    assert items[1]["has_cover_photo"] is True


def test_list_for_owner_with_search_accent_and_case_insensitive(books):
    b1 = books.create("alice", "Cien años de soledad", "Gabriel García Márquez")
    b2 = books.create("alice", "El amor en los tiempos del cólera", "Gabriel Garcia Marquez")
    b3 = books.create("alice", "Rayuela", "Julio Cortázar")
    b4 = books.create("bob", "Cien años de soledad", "Gabriel García Márquez")

    # Match by title with accents ignoring accents
    assert [b["id"] for b in books.list_for_owner("alice", 10, None, q="anos")] == [b1["id"]]
    assert [b["id"] for b in books.list_for_owner("alice", 10, None, q="años")] == [b1["id"]]

    # Match by author case-insensitively and accent-insensitively
    results_garcia = books.list_for_owner("alice", 10, None, q="GARCIA")
    assert [b["id"] for b in results_garcia] == [b1["id"], b2["id"]]
    results_accent = books.list_for_owner("alice", 10, None, q="garcía")
    assert [b["id"] for b in results_accent] == [b1["id"], b2["id"]]

    # Owner scoping: Bob's book is never returned to Alice
    results_bob = books.list_for_owner("bob", 10, None, q="anos")
    assert [b["id"] for b in results_bob] == [b4["id"]]

    # Pagination with search
    first_page = books.list_for_owner("alice", limit=1, after=None, q="Gabriel")
    assert len(first_page) == 1
    assert first_page[0]["id"] == b1["id"]
    second_page = books.list_for_owner("alice", limit=1, after=b1["id"], q="Gabriel")
    assert len(second_page) == 1
    assert second_page[0]["id"] == b2["id"]

    # Empty or whitespace query returns normal list
    all_alice = books.list_for_owner("alice", 10, None, q="   ")
    assert len(all_alice) == 3


def test_storage_errors_raise_books_unavailable(books, monkeypatch):
    class FailingCollection:
        def insert_one(self, *args, **kwargs):
            raise PyMongoError("fail")

        def find(self, *args, **kwargs):
            raise PyMongoError("fail")

        def find_one(self, *args, **kwargs):
            raise PyMongoError("fail")

        def find_one_and_update(self, *args, **kwargs):
            raise PyMongoError("fail")

    monkeypatch.setattr(books, "_collection", lambda: FailingCollection())

    with pytest.raises(BooksUnavailable):
        books.create("alice", "T", None)
    with pytest.raises(BooksUnavailable):
        books.list_for_owner("alice", limit=10, after=None)
    with pytest.raises(BooksUnavailable):
        books.get_for_owner("alice", str(ObjectId()))
    with pytest.raises(BooksUnavailable):
        books.set_cover_photo("alice", str(ObjectId()), True)
    with pytest.raises(BooksUnavailable):
        books.owns_book("alice", str(ObjectId()))
