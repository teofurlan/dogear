import pytest
from bson import ObjectId

from dogear.entrypoints import api
from tests.fakes import FakeCaptures, FakePhotos

ALICE, BOB = "auth0|alice", "auth0|bob"
BOOK_1 = str(ObjectId())
BOOK_2 = str(ObjectId())


@pytest.fixture
def export_client(auth):
    client, issue, _, _ = auth
    captures = FakeCaptures()
    client.app.dependency_overrides[api.capture_store] = lambda: captures

    captures.add_book(ALICE, BOOK_1)
    captures.add_book(ALICE, BOOK_2)

    def headers(subject=ALICE, **extra):
        return {"Authorization": f"Bearer {issue({'sub': subject})}", **extra}

    return client, headers, captures


def test_export_requires_auth(export_client):
    client, _, _ = export_client
    response = client.get("/quotes/export")
    assert response.status_code == 401


def test_export_single_book_not_found_if_unknown_or_foreign(export_client):
    client, headers, _ = export_client
    # Unknown book
    res_unknown = client.get(f"/quotes/export?book_id={ObjectId()}", headers=headers(ALICE))
    assert res_unknown.status_code == 404

    # Foreign book
    res_foreign = client.get(f"/quotes/export?book_id={BOOK_1}", headers=headers(BOB))
    assert res_foreign.status_code == 404


def test_export_single_book_empty_quotes(export_client):
    client, headers, _ = export_client
    res = client.get(f"/quotes/export?book_id={BOOK_1}", headers=headers(ALICE))
    assert res.status_code == 200
    assert res.headers["content-type"] == "text/markdown; charset=utf-8"
    assert "attachment" in res.headers["content-disposition"]
    assert res.text == ""


def test_export_single_book_with_kept_quotes(export_client):
    client, headers, captures = export_client
    captures.add_quote(ALICE, BOOK_1, "First kept quote")
    captures._insert_quote(ALICE, BOOK_1, None, "Pending quote", "Pending quote", [], "pending", None)

    res = client.get(f"/quotes/export?book_id={BOOK_1}", headers=headers(ALICE))
    assert res.status_code == 200
    assert res.headers["content-type"] == "text/markdown; charset=utf-8"
    assert f'filename="quotes-{BOOK_1}.md"' in res.headers["content-disposition"]
    assert "# Untitled book" in res.text
    assert "> First kept quote" in res.text
    assert "Pending quote" not in res.text


def test_export_all_books(export_client):
    client, headers, captures = export_client
    captures.add_quote(ALICE, BOOK_1, "Quote from book 1")
    captures.add_quote(ALICE, BOOK_2, "Quote from book 2")
    captures.add_quote(BOB, BOOK_1, "Bob quote")  # should not appear

    res = client.get("/quotes/export", headers=headers(ALICE))
    assert res.status_code == 200
    assert res.headers["content-type"] == "text/markdown; charset=utf-8"
    assert 'filename="quotes.md"' in res.headers["content-disposition"]
    assert "> Quote from book 1" in res.text
    assert "> Quote from book 2" in res.text
    assert "Bob quote" not in res.text
