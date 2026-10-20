from typing import Protocol

import numpy as np


class ReaderUnavailable(Exception):
    """The model could not be reached, timed out or answered something unusable."""


class Reader(Protocol):
    def read(self, crop_bgr: np.ndarray) -> str:
        """Transcribe all the text in the crop, word for word."""
        ...
