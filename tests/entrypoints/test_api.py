from fastapi.testclient import TestClient

from dogear.entrypoints.api import create_app


def test_health_reports_http_liveness_without_credentials():
    with TestClient(create_app()) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"status": "ok"}


def test_health_is_documented_in_openapi_and_interactive_docs():
    with TestClient(create_app()) as client:
        schema_response = client.get("/openapi.json")
        docs_response = client.get("/docs")

    assert schema_response.status_code == 200
    schema = schema_response.json()
    assert schema["info"]["title"] == "Dogear API"
    assert "200" in schema["paths"]["/health"]["get"]["responses"]
    assert docs_response.status_code == 200
    assert "text/html" in docs_response.headers["content-type"]
    assert "/openapi.json" in docs_response.text


def test_factory_creates_independent_apps():
    first, second = create_app(), create_app()

    @first.get("/first-only")
    async def first_only() -> dict[str, str]:
        return {"app": "first"}

    with TestClient(first) as first_client, TestClient(second) as second_client:
        assert first_client.get("/first-only").status_code == 200
        assert second_client.get("/first-only").status_code == 404
        assert second_client.get("/health").json() == {"status": "ok"}
