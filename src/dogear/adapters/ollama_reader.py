"""Ollama adapter for the Reader port: a local open-weight vision model transcribes a crop."""
import base64
import json
import urllib.request
from typing import Any, Callable

import cv2
import numpy as np

from dogear.ports.reader import ReaderUnavailable

PROMPT = (
    "Transcribe ALL the text in this crop of a printed book page, word for word, in its "
    "original language. Join words split by a hyphen at the end of a line. Do not add, "
    'drop or correct words. Answer only with JSON: {"text": "..."}'
)

Transport = Callable[[str, dict[str, Any], float], dict[str, Any]]


def _http_post(url: str, body: dict[str, Any], timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


class OllamaReader:
    def __init__(
        self,
        model: str = "gemma4:e4b",
        url: str = "http://localhost:11434",
        timeout: float = 300.0,
        cpu_only: bool = False,
        threads: int | None = None,
        transport: Transport = _http_post,
    ):
        self.model, self.url, self.timeout = model, url.rstrip("/"), timeout
        self.options: dict[str, Any] = {"temperature": 0}
        if cpu_only:
            self.options["num_gpu"] = 0
        if threads:
            self.options["num_thread"] = threads
        self.transport = transport

    def read(self, crop_bgr: np.ndarray) -> str:
        ok, png = cv2.imencode(".png", crop_bgr)
        if not ok:
            raise ReaderUnavailable("could not encode the crop")
        body = {
            "model": self.model,
            "stream": False,
            "think": False,
            "format": "json",
            "options": self.options,
            "messages": [
                {"role": "user", "content": PROMPT, "images": [base64.b64encode(png.tobytes()).decode()]}
            ],
        }
        try:
            reply = self.transport(f"{self.url}/api/chat", body, self.timeout)
            text = json.loads(reply["message"]["content"])["text"]
        except (OSError, ValueError, KeyError, TypeError) as error:
            raise ReaderUnavailable(str(error)) from error
        if not isinstance(text, str):
            raise ReaderUnavailable("the model answered without a text field")
        return text
