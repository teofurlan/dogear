import asyncio
import json
import os
import time
from io import BytesIO
from urllib.request import OpenerDirector

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from dogear.entrypoints.api import create_app


@pytest.fixture(autouse=True)
def no_ambient_auth(monkeypatch):
    for name in list(os.environ):
        if name.startswith(("DOGEAR_AUTH0_", "DOGEAR_MONGODB_")):
            monkeypatch.delenv(name, raising=False)


@pytest.fixture(scope="module")
def keys():
    return [
        rsa.generate_private_key(public_exponent=65537, key_size=2048) for _ in range(2)
    ]


@pytest.fixture
def auth(monkeypatch, keys):
    domain, audience = "tenant.example.test", "https://api.dogear.test"
    monkeypatch.setenv("DOGEAR_AUTH0_DOMAIN", domain)
    monkeypatch.setenv("DOGEAR_AUTH0_AUDIENCE", audience)
    jwk = jwt.algorithms.RSAAlgorithm.to_jwk(keys[0].public_key(), as_dict=True)
    remote = {"keys": [{**jwk, "kid": "trusted", "use": "sig"}]}
    calls = []

    def fetch(_opener, request, *, timeout):
        assert request.full_url == f"https://{domain}/.well-known/jwks.json"
        assert timeout == 3
        with pytest.raises(RuntimeError):
            asyncio.get_running_loop()
        calls.append(request.full_url)
        return BytesIO(json.dumps(remote).encode())

    monkeypatch.setattr(OpenerDirector, "open", fetch)

    def issue(changes=None, missing=(), *, kid="trusted", key=None, algorithm="RS256"):
        claims = {
            "iss": f"https://{domain}/",
            "aud": audience,
            "exp": int(time.time()) + 300,
            "sub": "auth0|reader",
        }
        claims.update(changes or {})
        for name in missing:
            claims.pop(name)
        signing_key = keys[0] if key is None and algorithm == "RS256" else key
        return jwt.encode(
            claims, signing_key, algorithm=algorithm, headers={"kid": kid}
        )

    with TestClient(create_app()) as client:
        yield client, issue, calls, remote
