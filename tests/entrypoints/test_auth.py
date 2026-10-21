import json
from urllib.error import URLError
from urllib.request import OpenerDirector

from fastapi.testclient import TestClient
import jwt
import pytest

from dogear.entrypoints.api import create_app

DOMAIN = "tenant.example.test"
AUDIENCE = "https://api.dogear.test"


def test_valid_access_token_returns_only_verified_subject_and_caches_keys(auth):
    client, issue, calls, _ = auth
    token = issue({"email": "not-returned@example.test"})
    for _ in range(2):
        response = client.get("/me", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        assert response.json() == {"sub": "auth0|reader"}
    assert len(calls) == 1


@pytest.mark.parametrize("header", [None, "Basic abc", "Bearer", "Bearer not-a-jwt"])
def test_missing_or_malformed_credentials_are_rejected(auth, header):
    client, _, calls, _ = auth
    response = client.get("/me", headers={} if header is None else {"Authorization": header})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert calls == []


@pytest.mark.parametrize("changes,missing", [
    ({"exp": 1}, ()),
    ({"iss": "https://other.example.test/"}, ()),
    ({"aud": "https://another-api.test"}, ()),
    ({}, ("exp",)),
    ({}, ("iss",)),
    ({}, ("aud",)),
    ({}, ("sub",)),
    ({"sub": ""}, ()),
    ({"sub": 123}, ()),
])
def test_untrusted_or_incomplete_claims_are_rejected(auth, changes, missing):
    client, issue, _, _ = auth
    token = issue(changes, missing)
    response = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json() == {"detail": "Invalid access token"}


def test_token_signed_by_another_key_is_rejected(auth, keys):
    client, issue, _, _ = auth
    token = issue(key=keys[1])
    response = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("algorithm,key", [("none", None), ("HS256", "x" * 32)])
def test_token_cannot_choose_a_different_algorithm(auth, algorithm, key):
    client, issue, calls, _ = auth
    token = issue(algorithm=algorithm, key=key)
    response = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert calls == []


@pytest.mark.parametrize("kid", [None, "unknown", ["trusted"]])
def test_missing_or_unknown_key_id_is_rejected(auth, kid):
    client, issue, _, _ = auth
    token = issue()
    header, payload, signature = token.split(".")
    header = jwt.utils.base64url_encode(json.dumps({"alg": "RS256", "kid": kid}).encode()).decode()
    response = client.get("/me", headers={"Authorization": f"Bearer {header}.{payload}.{signature}"})
    assert response.status_code == 401


def test_audience_can_contain_multiple_recipients(auth):
    client, issue, _, _ = auth
    token = issue({"aud": [AUDIENCE, "https://userinfo.test"]})
    response = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200


def test_jwks_outage_fails_closed_without_leaking_details(auth, monkeypatch):
    client, issue, _, _ = auth

    def unavailable(*args, **kwargs):
        raise URLError("private upstream diagnostic")

    monkeypatch.setattr(OpenerDirector, "open", unavailable)
    response = client.get("/me", headers={"Authorization": f"Bearer {issue()}"})
    assert response.status_code == 503
    assert response.json() == {"detail": "Authentication unavailable"}
    assert client.get("/health").json() == {"status": "ok"}


def test_invalid_jwks_fails_closed(auth):
    client, issue, _, remote = auth
    remote["keys"] = []
    response = client.get("/me", headers={"Authorization": f"Bearer {issue()}"})
    assert response.status_code == 503


def test_no_configuration_never_enables_an_authentication_bypass():
    with TestClient(create_app()) as client:
        response = client.get("/me", headers={"Authorization": "Bearer some-token"})
        assert response.status_code == 503
        assert response.json() == {"detail": "Authentication unavailable"}
        assert client.get("/health").status_code == 200


def test_openapi_marks_identity_as_bearer_protected(auth):
    client, _, _, _ = auth
    schema = client.get("/openapi.json").json()
    assert schema["paths"]["/me"]["get"]["security"] == [{"HTTPBearer": []}]
    assert schema["components"]["securitySchemes"]["HTTPBearer"]["scheme"] == "bearer"


def test_rotated_key_is_fetched_after_the_refresh_cooldown(auth, keys, monkeypatch):
    from types import SimpleNamespace

    import jwt.jwks_client

    client, issue, calls, remote = auth
    clock = [100.0]
    monkeypatch.setattr(jwt.jwks_client, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    assert client.get("/me", headers={"Authorization": f"Bearer {issue()}"}).status_code == 200
    rotated = jwt.algorithms.RSAAlgorithm.to_jwk(keys[1].public_key(), as_dict=True)
    remote["keys"].append({**rotated, "kid": "rotated", "use": "sig"})
    token = issue(kid="rotated", key=keys[1])
    assert client.get("/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    assert len(calls) == 1
    clock[0] += 31
    assert client.get("/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    assert len(calls) == 2


@pytest.mark.parametrize("domain,audience", [("tenant.example.test", ""), ("", AUDIENCE)])
def test_partial_configuration_fails_closed_without_network(monkeypatch, domain, audience):
    monkeypatch.setenv("DOGEAR_AUTH0_DOMAIN", domain)
    monkeypatch.setenv("DOGEAR_AUTH0_AUDIENCE", audience)
    with TestClient(create_app()) as client:
        assert client.get("/me", headers={"Authorization": "Bearer token"}).status_code == 503
        assert client.get("/health").status_code == 200


def test_domain_must_not_be_a_url(monkeypatch):
    monkeypatch.setenv("DOGEAR_AUTH0_DOMAIN", "https://tenant.example.test/path")
    monkeypatch.setenv("DOGEAR_AUTH0_AUDIENCE", AUDIENCE)
    with pytest.raises(ValueError, match="must be a hostname"):
        create_app()
