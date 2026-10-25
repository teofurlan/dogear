from io import BytesIO

import pytest
from PIL import Image

from dogear.application.covers import cover_key, prepare_cover_photo
from dogear.application.identify import CoverError


def encoded(fmt, size=(80, 120), color="white"):
    data = BytesIO()
    Image.new("RGB", size, color).save(data, format=fmt)
    return data.getvalue()


def test_png_covers_are_stored_as_jpeg():
    stored = prepare_cover_photo(encoded("PNG"))
    with Image.open(BytesIO(stored)) as image:
        assert image.format == "JPEG"
        assert image.size == (80, 120)


def test_jpeg_orientation_is_applied_and_metadata_dropped():
    source = BytesIO()
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90 degrees clockwise to display
    Image.new("RGB", (80, 120), "white").save(source, format="JPEG", exif=exif)
    with Image.open(BytesIO(prepare_cover_photo(source.getvalue()))) as image:
        assert image.size == (120, 80)
        assert not image.getexif()


@pytest.mark.parametrize(
    "data,status",
    [
        (b"", 422),
        (b"not an image", 422),
        (encoded("GIF"), 415),
        (encoded("JPEG", (10001, 4)), 413),
        (encoded("PNG", (5001, 4001)), 413),
    ],
    ids=["empty", "garbage", "gif", "too-wide", "too-many-pixels"],
)
def test_invalid_cover_photos_are_rejected(data, status):
    with pytest.raises(CoverError) as error:
        prepare_cover_photo(data)
    assert error.value.status == status


def test_cover_keys_never_contain_the_subject():
    key = cover_key("auth0|reader", "book123")
    assert key.startswith("covers/") and key.endswith("/book123.jpg")
    assert "reader" not in key and "auth0" not in key
    assert key == cover_key("auth0|reader", "book123")
    assert key != cover_key("auth0|other", "book123")
