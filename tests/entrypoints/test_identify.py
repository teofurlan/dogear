import asyncio

import pytest

from dogear.entrypoints import api


def test_cover_suggestions_require_auth_and_never_create_a_book(auth, monkeypatch):
    client, issue, _, _ = auth
    calls = []

    def identify(data):
        with pytest.raises(RuntimeError):
            asyncio.get_running_loop()
        calls.append(data)
        return {
            "title": "Synthetic book",
            "author": "Ada Reed",
            "text": "Synthetic book Ada Reed",
        }

    monkeypatch.setattr(api, "identify_cover", identify, raising=False)
    assert client.post("/books/identify", content=b"photo").status_code == 401
    response = client.post(
        "/books/identify",
        content=b"photo",
        headers={"Authorization": f"Bearer {issue()}", "Content-Type": "image/png"},
    )
    assert response.status_code == 200
    assert response.json()["title"] == "Synthetic book"
    assert calls == [b"photo"]
    # No storage configured: identification must not require or write to MongoDB.
    assert (
        client.get("/books", headers={"Authorization": f"Bearer {issue()}"}).status_code
        == 503
    )


@pytest.mark.parametrize(
    "kind,data,status",
    [
        ("text/plain", b"photo", 415),
        ("image/png", b"", 422),
        ("image/png", b"x" * (6 * 1024 * 1024 + 1), 413),
    ],
    ids=["wrong-type", "empty", "too-large"],
)
def test_invalid_uploads_do_not_reach_ocr(auth, monkeypatch, kind, data, status):
    client, issue, _, _ = auth

    def unexpected(_data):
        pytest.fail("invalid input reached OCR")

    monkeypatch.setattr(api, "identify_cover", unexpected, raising=False)
    response = client.post(
        "/books/identify",
        content=data,
        headers={"Authorization": f"Bearer {issue()}", "Content-Type": kind},
    )
    assert response.status_code == status


def test_declared_oversize_is_rejected_before_reading_the_body(auth, monkeypatch):
    client, issue, _, _ = auth

    def unexpected(_data):
        pytest.fail("oversized upload reached OCR")

    monkeypatch.setattr(api, "identify_cover", unexpected, raising=False)
    response = client.post(
        "/books/identify",
        content=b"x",
        headers={
            "Authorization": f"Bearer {issue()}",
            "Content-Type": "image/png",
            "Content-Length": str(6 * 1024 * 1024 + 1),
        },
    )
    assert response.status_code == 413


def test_reader_errors_are_safe_and_release_capacity(auth, monkeypatch):
    from dogear.application.identify import CoverError

    client, issue, _, _ = auth

    def unavailable(_data):
        raise CoverError(503, "Enter details manually")

    monkeypatch.setattr(api, "identify_cover", unavailable)
    headers = {"Authorization": f"Bearer {issue()}", "Content-Type": "image/png"}
    for _ in range(3):
        result = client.post("/books/identify", content=b"photo", headers=headers)
        assert result.status_code == 503
        assert result.json() == {"detail": "Enter details manually"}


def test_cover_work_has_bounded_capacity(auth, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, Event

    client, issue, _, _ = auth
    entered, release = Barrier(3), Event()

    def identify(_data):
        entered.wait(timeout=5)
        assert release.wait(timeout=5)
        return {"title": "Synthetic", "author": None, "text": "Synthetic"}

    monkeypatch.setattr(api, "identify_cover", identify)
    headers = {"Authorization": f"Bearer {issue()}", "Content-Type": "image/png"}

    def send():
        return client.post("/books/identify", content=b"photo", headers=headers)

    # Warm signing-key retrieval before concurrent calls.
    assert client.get("/me", headers=headers).status_code == 200
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(send) for _ in range(2)]
        try:
            entered.wait(timeout=5)
            assert send().status_code == 429
            assert client.get("/health").json() == {"status": "ok"}
        finally:
            release.set()
        assert all(job.result().status_code == 200 for job in jobs)
