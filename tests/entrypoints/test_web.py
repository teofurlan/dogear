import pytest
from fastapi.testclient import TestClient

from dogear.entrypoints.web import create_web_app


@pytest.fixture
def dist(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>Dogear</title>")
    (tmp_path / "sw.js").write_text("self.addEventListener('fetch', () => {});")
    (tmp_path / "manifest.webmanifest").write_text("{}")
    (tmp_path / "assets" / "index-abc123.js").write_text("console.log('dogear');")
    return tmp_path


def test_root_serves_the_built_app_without_long_caching(dist):
    with TestClient(create_web_app(dist)) as client:
        response = client.get("/")

    assert response.status_code == 200
    assert "<title>Dogear</title>" in response.text
    assert response.headers["cache-control"] == "no-cache"


def test_api_is_served_under_the_same_origin_prefix(dist):
    with TestClient(create_web_app(dist)) as client:
        assert client.get("/api/health").json() == {"status": "ok"}
        assert client.get("/api/openapi.json").json()["info"]["title"] == "Dogear API"
        assert client.get("/health").status_code == 404


def test_protected_api_routes_keep_requiring_a_token(dist):
    with TestClient(create_web_app(dist)) as client:
        response = client.get("/api/books")

    assert response.status_code == 401


def test_worker_and_manifest_are_revalidated_while_hashed_assets_are_immutable(dist):
    with TestClient(create_web_app(dist)) as client:
        worker = client.get("/sw.js")
        manifest = client.get("/manifest.webmanifest")
        asset = client.get("/assets/index-abc123.js")

    assert worker.headers["cache-control"] == "no-cache"
    assert manifest.headers["cache-control"] == "no-cache"
    assert asset.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_missing_build_fails_at_startup_instead_of_serving_errors(tmp_path):
    with pytest.raises(RuntimeError):
        create_web_app(tmp_path / "missing")
