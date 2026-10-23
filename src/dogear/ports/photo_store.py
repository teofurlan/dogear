from typing import Protocol


class PhotosUnavailable(Exception):
    """The photo store cannot safely complete the requested operation."""


class PhotoStore(Protocol):
    def put(self, key: str, data: bytes) -> None:
        """Store a JPEG under the key, replacing any previous object."""
        ...

    def get(self, key: str) -> bytes:
        """The object's bytes; raises PhotosUnavailable when it cannot be read."""
        ...

    def delete(self, key: str) -> None:
        """Remove the object; deleting a missing key is not an error."""
        ...
