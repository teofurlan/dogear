import base64
import json

import cv2
import numpy as np
import pytest

from dogear.adapters.ollama_reader import OllamaReader
from dogear.ports.reader import ReaderUnavailable

CROP = np.full((20, 40, 3), 255, np.uint8)


class FakeTransport:
    def __init__(self, reply=None, error=None):
        self.reply, self.error, self.calls = reply, error, []

    def __call__(self, url, body, timeout):
        self.calls.append((url, body, timeout))
        if self.error:
            raise self.error
        return self.reply


def chat_reply(content):
    return {"message": {"content": content}}


def test_the_transcription_is_returned():
    reader = OllamaReader(transport=FakeTransport(chat_reply(json.dumps({"text": "Hola mundo."}))))

    assert reader.read(CROP) == "Hola mundo."


def test_the_request_is_deterministic_and_carries_the_crop_as_png():
    transport = FakeTransport(chat_reply('{"text": "x"}'))

    OllamaReader(model="gemma4:e4b", transport=transport, cpu_only=True).read(CROP)

    url, body, _ = transport.calls[0]
    assert url.endswith("/api/chat")
    assert body["model"] == "gemma4:e4b"
    assert body["options"]["temperature"] == 0
    assert body["options"]["num_gpu"] == 0
    image = base64.b64decode(body["messages"][0]["images"][0])
    assert cv2.imdecode(np.frombuffer(image, np.uint8), cv2.IMREAD_COLOR).shape == CROP.shape


def test_the_context_window_is_small_by_default():
    # A crop prompt needs a few hundred tokens; the model's default context reserves
    # gigabytes of memory for a cache that is never used.
    transport = FakeTransport(chat_reply('{"text": "x"}'))

    OllamaReader(transport=transport).read(CROP)

    assert transport.calls[0][1]["options"]["num_ctx"] == 4096


def test_gpu_use_is_left_to_ollama_by_default():
    transport = FakeTransport(chat_reply('{"text": "x"}'))

    OllamaReader(transport=transport).read(CROP)

    assert "num_gpu" not in transport.calls[0][1]["options"]


@pytest.mark.parametrize("content", ["not json", '{"other": 1}', '{"text": 3}'])
def test_unusable_answers_raise_reader_unavailable(content):
    reader = OllamaReader(transport=FakeTransport(chat_reply(content)))

    with pytest.raises(ReaderUnavailable):
        reader.read(CROP)


def test_transport_failures_raise_reader_unavailable():
    reader = OllamaReader(transport=FakeTransport(error=OSError("connection refused")))

    with pytest.raises(ReaderUnavailable):
        reader.read(CROP)
