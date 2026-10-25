import json

import cv2
import pytest

from dogear.adapters.tesseract_ocr import default_tesseract_cmd
from dogear.entrypoints import extract_cli

from tests.imaging.test_highlight import HIGHLIGHTERS, page_photo


@pytest.mark.tesseract
def test_no_model_prints_json_per_photo(tmp_path, capsys):
    cmd = default_tesseract_cmd()
    if cmd is None:
        pytest.skip("Tesseract is not installed")
    import subprocess
    from pathlib import Path

    langs = subprocess.run([cmd, "--list-langs"], capture_output=True, text=True).stdout
    if "spa" not in langs and not Path("models/tessdata/spa.traineddata").exists():
        pytest.skip("local Spanish Tesseract data unavailable")
    photo = tmp_path / "page.png"
    cv2.imwrite(str(photo), page_photo(HIGHLIGHTERS["pink"]))

    assert extract_cli.main([str(photo), "--no-model"]) == 0

    (result,) = json.loads(capsys.readouterr().out)
    assert result["photo"] == str(photo)
    assert isinstance(result["quotes"], list)
    assert result["seconds"] >= 0


def test_an_unreadable_photo_is_an_error(tmp_path, capsys):
    missing = tmp_path / "nope.jpg"

    assert extract_cli.main([str(missing), "--no-model"]) == 2
    assert "cannot read" in capsys.readouterr().err
