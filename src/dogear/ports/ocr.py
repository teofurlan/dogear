from typing import Protocol

import numpy as np

from dogear.domain.passages import Word


class OcrEngine(Protocol):
    def read_words(self, img_bgr: np.ndarray) -> list[Word]:
        """Every word on the image, in reading order, with its box in image pixels."""
        ...
