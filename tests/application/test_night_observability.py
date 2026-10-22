"""Exercise the public CLI with synthetic input and a real, offline Sentry transport."""
import json
from types import SimpleNamespace

import numpy as np
import pytest
sentry_sdk = pytest.importorskip("sentry_sdk")
from sentry_sdk.transport import Transport

from dogear.application.extract import Candidate, extract_quotes
from dogear.domain.passages import Box
from dogear.entrypoints import extract_cli
from dogear.ports.reader import ReaderUnavailable

PRIVATE = "private-photo-quote-token"


@pytest.fixture
def run(monkeypatch, capsys):
    envelopes, flushes, options, ocr_options, reader_options = [], [], [], [], []
    client_type = sentry_sdk.Client

    class OfflineTransport(Transport):
        def capture_envelope(self, envelope):
            envelopes.append(envelope)

        def flush(self, timeout, callback=None):
            flushes.append(timeout)

    def client(**kwargs):
        options.append(kwargs)
        kwargs["transport"] = OfflineTransport()
        return client_type(**kwargs)

    monkeypatch.setattr(sentry_sdk, "Client", client)
    monkeypatch.setenv("DOGEAR_SENTRY_DSN", "https://public@example.invalid/1")
    monkeypatch.setattr(extract_cli.cv2, "imread", lambda path: np.zeros((2, 2, 3), dtype=np.uint8))
    def ocr(**kwargs):
        ocr_options.append(kwargs)
        return SimpleNamespace(read_words=lambda img: [])

    def reader(**kwargs):
        reader_options.append(kwargs)
        return SimpleNamespace(read=lambda img: PRIVATE)

    monkeypatch.setattr(extract_cli, "TesseractOcr", ocr)
    monkeypatch.setattr(extract_cli, "OllamaReader", reader)

    def extract(img, ocr, reader):
        ocr.read_words(img)
        if reader is not None:
            reader.read(img)
        return [Candidate(PRIVATE, PRIVATE, Box(0, 0, 1, 1))]

    monkeypatch.setattr(extract_cli, "extract_quotes", extract)
    return SimpleNamespace(envelopes=envelopes, flushes=flushes, options=options, output=capsys,
                           transport=OfflineTransport, ocr_options=ocr_options, reader_options=reader_options)


def transaction(run):
    items = [item for envelope in run.envelopes for item in envelope.items]
    assert [item.headers["type"] for item in items] == ["transaction"]
    return json.loads(items[0].get_bytes())


@pytest.mark.parametrize("flags,operations", [
    (["--no-model", "--lang", "eng"], ["photo.load", "photo.extract", "ocr.read"]),
    (["--cpu-only", "--threads", "2", "--model", PRIVATE, "--ollama-url", "http://private.invalid"],
     ["photo.load", "photo.extract", "ocr.read", "model.read"]),
])
def test_traces_stages_without_changing_json_or_exporting_content(run, flags, operations):
    assert extract_cli.main([PRIVATE + ".png", *flags]) == 0
    output = run.output.readouterr()
    assert output.err == ""
    (result,) = json.loads(output.out)
    assert result["photo"] == PRIVATE + ".png"
    assert result["quotes"][0]["text"] == PRIVATE
    event = transaction(run)
    assert event["transaction"] == "dogear.extract"
    assert sorted(span["op"] for span in event["spans"]) == sorted(operations)
    assert event["contexts"]["trace"]["status"] == "ok"
    assert set(event) == {"event_id", "type", "start_timestamp", "timestamp", "transaction", "contexts", "spans"}
    assert run.ocr_options[0]["lang"] == ("eng" if "--no-model" in flags else "spa")
    assert run.reader_options == ([] if "--no-model" in flags else [
        {"model": PRIVATE, "url": "http://private.invalid", "cpu_only": True, "threads": 2}
    ])
    assert all(span["timestamp"] >= span["start_timestamp"] for span in event["spans"])
    wire = b"".join(envelope.serialize() for envelope in run.envelopes)
    assert PRIVATE.encode() not in wire
    assert b"private.invalid" not in wire
    assert run.flushes == [2.0]


def test_unreadable_photo_keeps_exit_code_and_marks_failure(run, monkeypatch):
    monkeypatch.setattr(extract_cli.cv2, "imread", lambda path: None)
    assert extract_cli.main([PRIVATE, "--no-model"]) == 2
    output = run.output.readouterr()
    assert output.out == ""
    assert output.err == f"dogear-extract: cannot read {PRIVATE}\n"
    assert transaction(run)["contexts"]["trace"]["status"] == "invalid_argument"


@pytest.mark.parametrize("failure", ["disabled", "sdk_missing", "invalid_dsn", "init", "span", "send", "flush"])
def test_telemetry_unavailability_does_not_change_extraction(run, monkeypatch, failure):
    def broken(*args, **kwargs):
        raise RuntimeError(PRIVATE)

    if failure == "disabled":
        monkeypatch.delenv("DOGEAR_SENTRY_DSN")
        monkeypatch.setattr(sentry_sdk, "Client", broken)
    elif failure == "sdk_missing":
        monkeypatch.setitem(__import__("sys").modules, "sentry_sdk", None)
    elif failure == "invalid_dsn":
        monkeypatch.setenv("DOGEAR_SENTRY_DSN", PRIVATE)
    elif failure == "init":
        monkeypatch.setattr(sentry_sdk, "Client", broken)
    elif failure == "span":
        monkeypatch.setattr(sentry_sdk.tracing.Transaction, "start_child", broken)
    elif failure == "send":
        monkeypatch.setattr(run.transport, "capture_envelope", broken)
    else:
        original = sentry_sdk.Client

        def failing_flush(**kwargs):
            client = original(**kwargs)
            client.flush = broken
            return client

        monkeypatch.setattr(sentry_sdk, "Client", failing_flush)
    assert extract_cli.main([PRIVATE, "--no-model"]) == 0
    output = run.output.readouterr()
    assert output.err == ""
    assert json.loads(output.out)[0]["quotes"][0]["text"] == PRIVATE


def test_extraction_exception_is_not_swallowed_or_sent(run, monkeypatch):
    def broken(img, ocr, reader):
        raise ValueError(PRIVATE)

    monkeypatch.setattr(extract_cli, "extract_quotes", broken)
    with pytest.raises(ValueError, match=PRIVATE):
        extract_cli.main([PRIVATE, "--no-model"])
    assert transaction(run)["contexts"]["trace"]["status"] == "internal_error"
    assert PRIVATE.encode() not in b"".join(e.serialize() for e in run.envelopes)


def test_ambient_sdk_context_and_attachments_cannot_leak(run):
    previous_scope = sentry_sdk.get_isolation_scope()
    with sentry_sdk.isolation_scope() as scope:
        scope.set_user({"id": PRIVATE})
        scope.set_extra("secret", PRIVATE)
        scope.add_attachment(bytes=PRIVATE.encode(), filename=PRIVATE, add_to_transactions=True)
        assert extract_cli.main([PRIVATE, "--no-model"]) == 0
    transaction(run)
    wire = b"".join(e.serialize() for e in run.envelopes)
    assert PRIVATE.encode() not in wire
    assert sentry_sdk.get_isolation_scope() is previous_scope


def test_real_extraction_keeps_model_unavailable_fallback(run, monkeypatch):
    from tests.application.test_extract import FakeOcr, FakeReader, photo

    monkeypatch.setattr(extract_cli, "extract_quotes", extract_quotes)
    monkeypatch.setattr(extract_cli.cv2, "imread", lambda path: photo())
    monkeypatch.setattr(extract_cli, "TesseractOcr", lambda **kw: FakeOcr())
    monkeypatch.setattr(extract_cli, "OllamaReader", lambda **kw: FakeReader(ReaderUnavailable(PRIVATE)))
    assert extract_cli.main([PRIVATE]) == 0
    quote = json.loads(run.output.readouterr().out)[0]["quotes"][0]
    assert quote["text"] == "one two three four five"
    assert quote["flags"] == ["model_unavailable"]
    event = transaction(run)
    assert next(s for s in event["spans"] if s["op"] == "model.read")["status"] == "internal_error"
    assert event["contexts"]["trace"]["status"] == "ok"
    assert PRIVATE.encode() not in b"".join(e.serialize() for e in run.envelopes)
