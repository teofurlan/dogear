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


def test_a_missing_variable_is_named_so_the_operator_can_fix_it(env):
    env.delenv("DOGEAR_R2_BUCKET")
    assert R2Config.problem() == "missing DOGEAR_R2_BUCKET"
    env.setenv("DOGEAR_R2_BUCKET", "dogear")
    assert R2Config.problem() is None


def test_an_endpoint_that_includes_the_bucket_path_is_rejected_and_explained(env):
    env.setenv("DOGEAR_R2_ENDPOINT", "https://acct.r2.cloudflarestorage.com/dogear")
    assert R2Config.from_environment() is None
    assert "path" in R2Config.problem()


def test_storage_failures_log_their_code_but_not_the_message(env, caplog):
    store, client = photos(env)
    client.error = ClientError({"Error": {"Code": "AccessDenied", "Message": "private"}}, "Put")
    with pytest.raises(PhotosUnavailable):
        store.put("k", b"x")
    assert "AccessDenied" in caplog.text and "private" not in caplog.text


class ProbingS3(FakeS3):
    def __init__(self, head=None, listing=None):
        super().__init__()
        self.head, self.listing = head, listing

    def head_bucket(self, Bucket):
        self.calls.append(("head", Bucket))
        if self.head:
            raise self.head

    def list_objects_v2(self, Bucket, MaxKeys):
        self.calls.append(("list", Bucket, MaxKeys))
        if self.listing:
            raise self.listing
        return {"KeyCount": 0}


def denied(code="AccessDenied"):
    return ClientError({"Error": {"Code": code, "Message": "private"}}, "Op")


def test_a_denied_write_probes_bucket_access_once_and_logs_the_answers(env, caplog):
    client = ProbingS3(head=None, listing=None)
    client.error = denied()
    store = R2Photos(R2Config.from_environment(), client=client)
    for _ in range(2):
        with pytest.raises(PhotosUnavailable):
            store.put("k", b"x")
    assert [c[0] for c in client.calls].count("head") == 1
    assert "R2 diagnosis: head_bucket=ok list_objects=ok put_object=AccessDenied" in caplog.text
    assert "private" not in caplog.text


def test_the_probe_reports_why_the_bucket_is_unreachable(env, caplog):
    client = ProbingS3(head=denied("403"), listing=denied("AccessDenied"))
    client.error = denied()
    store = R2Photos(R2Config.from_environment(), client=client)
    with pytest.raises(PhotosUnavailable):
        store.put("k", b"x")
    assert "head_bucket=403 list_objects=AccessDenied" in caplog.text
