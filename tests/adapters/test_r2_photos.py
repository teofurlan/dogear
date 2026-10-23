from io import BytesIO

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from dogear.adapters.r2_photos import R2Config, R2Photos
from dogear.ports.photo_store import PhotosUnavailable

NAMES = ("ENDPOINT", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "BUCKET")


@pytest.fixture
def env(monkeypatch):
    for name, value in zip(
        NAMES, ("https://acct.r2.cloudflarestorage.com", "key", "secret", "dogear")
    ):
        monkeypatch.setenv(f"DOGEAR_R2_{name}", value)
    return monkeypatch


def test_configuration_comes_from_the_environment_without_leaking_secrets(env):
    config = R2Config.from_environment()
    assert config.bucket == "dogear"
    assert "secret" not in repr(config) and "key" not in repr(config).replace("bucket", "")


@pytest.mark.parametrize("missing", NAMES)
def test_incomplete_configuration_means_no_photo_storage(env, missing):
    env.setenv(f"DOGEAR_R2_{missing}", "  ")
    assert R2Config.from_environment() is None


def test_the_endpoint_must_be_https(env):
    env.setenv("DOGEAR_R2_ENDPOINT", "http://acct.r2.cloudflarestorage.com")
    assert R2Config.from_environment() is None


class FakeS3:
    def __init__(self):
        self.objects, self.calls, self.error = {}, [], None

    def _go(self, call):
        self.calls.append(call)
        if self.error:
            raise self.error

    def put_object(self, Bucket, Key, Body, ContentType):
        self._go(("put", Bucket, Key, ContentType))
        self.objects[Key] = Body

    def get_object(self, Bucket, Key):
        self._go(("get", Bucket, Key))
        return {"Body": BytesIO(self.objects[Key])}

    def delete_object(self, Bucket, Key):
        self._go(("delete", Bucket, Key))
        self.objects.pop(Key, None)


def photos(env):
    client = FakeS3()
    return R2Photos(R2Config.from_environment(), client=client), client


def test_photos_round_trip_through_the_configured_bucket(env):
    store, client = photos(env)
    store.put("pages/a/b.jpg", b"jpeg")
    assert store.get("pages/a/b.jpg") == b"jpeg"
    store.delete("pages/a/b.jpg")
    assert client.objects == {}
    assert client.calls[0] == ("put", "dogear", "pages/a/b.jpg", "image/jpeg")


@pytest.mark.parametrize(
    "error",
    [
        EndpointConnectionError(endpoint_url="https://private"),
        ClientError({"Error": {"Code": "AccessDenied", "Message": "private"}}, "Put"),
        OSError("private"),
    ],
)
def test_storage_failures_are_sanitized(env, error):
    store, client = photos(env)
    client.error = error
    for call in (
        lambda: store.put("k", b"x"),
        lambda: store.get("k"),
        lambda: store.delete("k"),
    ):
        with pytest.raises(PhotosUnavailable) as raised:
            call()
        assert "private" not in str(raised.value)
