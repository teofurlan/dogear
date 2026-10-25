"""MongoDB book storage. Ownership always comes from a verified token subject."""

import os
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Any
from urllib.parse import urlsplit

import pymongo
from bson import ObjectId
from pymongo.errors import PyMongoError


class BooksUnavailable(Exception):
    """Storage cannot safely complete the requested operation."""


class BookChanged(Exception):
    """The book exists for the owner but title or author no longer match."""


@dataclass(frozen=True)
class MongoConfig:
    uri: str = field(repr=False)
    username: str = field(repr=False)
    password: str = field(repr=False)
    database: str

    @classmethod
    def from_environment(cls) -> "MongoConfig | None":
        values = [
            os.getenv(f"DOGEAR_MONGODB_{name}", "")
            for name in ("URI", "USERNAME", "PASSWORD", "DATABASE")
        ]
        if not all(value.strip() for value in values):
            return None
        try:
            uri = urlsplit(values[0])
            if (
                uri.scheme != "mongodb+srv"
                or not uri.hostname
                or uri.username is not None
            ):
                return None
        except ValueError:
            return None
        return cls(*values)


def _object_id(value: str) -> ObjectId | None:
    return ObjectId(value) if ObjectId.is_valid(value) else None


def _iso(moment: datetime | str | None) -> str | None:
    if moment is None:
        return None
    if isinstance(moment, str):
        return moment
    return (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).isoformat()


def _public_book(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(document["_id"]),
        "title": document["title"],
        "author": document["author"],
        "has_cover_photo": bool(document.get("has_cover_photo", False)),
        "catalog_cover_id": document.get("catalog_cover_id"),
        "catalog_checked_at": _iso(document.get("catalog_checked_at")),
    }


_DIACRITIC_MAP = {
    "a": "[aáàâäãåāăą]",
    "c": "[cçćĉċč]",
    "e": "[eéèêëēĕėęě]",
    "i": "[iíìîïīĭįı]",
    "n": "[nñńņň]",
    "o": "[oóòôöõōŏőø]",
    "s": "[sśŝşš]",
    "u": "[uúùûüũūŭůűų]",
    "y": "[yýÿŷ]",
    "z": "[zźżž]",
}


def _accent_insensitive_regex(query: str) -> str:
    parts = []
    for char in query:
        decomposed = unicodedata.normalize("NFD", char)
        base = decomposed[0].lower()
        if base in _DIACRITIC_MAP:
            parts.append(_DIACRITIC_MAP[base])
        else:
            parts.append(re.escape(char))
    return "".join(parts)


def make_client(config: MongoConfig) -> pymongo.MongoClient:
    return pymongo.MongoClient(
        config.uri,
        username=config.username,
        password=config.password,
        authSource="admin",
        connect=False,
        tls=True,
        tlsAllowInvalidCertificates=False,
        tlsAllowInvalidHostnames=False,
        timeoutMS=5000,
        serverSelectionTimeoutMS=3000,
        connectTimeoutMS=3000,
        w="majority",
    )


class MongoBooks:
    def __init__(self, config: MongoConfig):
        self.config = config
        self._client = None
        self._lock = Lock()

    def _collection(self):
        # Even connect=False may resolve an SRV URI. Defer the constructor itself.
        with self._lock:
            if self._client is None:
                self._client = make_client(self.config)
            return self._client[self.config.database]["books"]

    def create(
        self, subject: str, title: str, author: str | None, has_cover_photo: bool = False
    ) -> dict[str, Any]:
        document = {
            "owner_sub": subject,
            "title": title,
            "author": author,
            "has_cover_photo": has_cover_photo,
            "catalog_cover_id": None,
            "catalog_checked_at": None,
        }
        try:
            result = self._collection().insert_one(document)
        except (PyMongoError, OSError, ValueError):
            raise BooksUnavailable() from None
        return _public_book({**document, "_id": result.inserted_id})

    def get_for_owner(self, subject: str, book_id: str) -> dict[str, Any] | None:
        oid = _object_id(book_id)
        if oid is None:
            return None
        try:
            doc = self._collection().find_one({"_id": oid, "owner_sub": subject})
            return _public_book(doc) if doc else None
        except (PyMongoError, OSError, ValueError):
            raise BooksUnavailable() from None

    def set_cover_photo(
        self, subject: str, book_id: str, has_cover_photo: bool = True
    ) -> dict[str, Any] | None:
        oid = _object_id(book_id)
        if oid is None:
            return None
        try:
            doc = self._collection().find_one_and_update(
                {"_id": oid, "owner_sub": subject},
                {"$set": {"has_cover_photo": has_cover_photo}},
                return_document=pymongo.ReturnDocument.AFTER,
            )
            return _public_book(doc) if doc else None
        except (PyMongoError, OSError, ValueError):
            raise BooksUnavailable() from None

    def set_catalog_cover(
        self,
        subject: str,
        book_id: str,
        cover_id: int | None,
        title: str,
        author: str | None,
    ) -> dict[str, Any] | None:
        oid = _object_id(book_id)
        if oid is None:
            return None
        now = datetime.now(timezone.utc)
        try:
            doc = self._collection().find_one_and_update(
                {"_id": oid, "owner_sub": subject, "title": title, "author": author},
                {
                    "$set": {
                        "catalog_cover_id": cover_id,
                        "catalog_checked_at": now,
                    }
                },
                return_document=pymongo.ReturnDocument.AFTER,
            )
            if doc:
                return _public_book(doc)
            if self._collection().find_one(
                {"_id": oid, "owner_sub": subject}, {"_id": 1}
            ):
                raise BookChanged()
            return None
        except (PyMongoError, OSError, ValueError):
            raise BooksUnavailable() from None

    def update(
        self, subject: str, book_id: str, title: str, author: str | None
    ) -> dict[str, Any] | None:
        oid = _object_id(book_id)
        if oid is None:
            return None
        try:
            doc = self._collection().find_one_and_update(
                {"_id": oid, "owner_sub": subject, "title": title, "author": author},
                {"$set": {"title": title, "author": author}},
                return_document=pymongo.ReturnDocument.AFTER,
            )
            if doc:
                return _public_book(doc)
            doc = self._collection().find_one_and_update(
                {"_id": oid, "owner_sub": subject},
                {
                    "$set": {
                        "title": title,
                        "author": author,
                        "catalog_cover_id": None,
                        "catalog_checked_at": None,
                    }
                },
                return_document=pymongo.ReturnDocument.AFTER,
            )
            return _public_book(doc) if doc else None
        except (PyMongoError, OSError, ValueError):
            raise BooksUnavailable() from None

    def owns_book(self, subject: str, book_id: str) -> bool:
        oid = _object_id(book_id)
        if oid is None:
            return False
        try:
            return (
                self._collection().find_one({"_id": oid, "owner_sub": subject})
                is not None
            )
        except (PyMongoError, OSError, ValueError):
            raise BooksUnavailable() from None

    def list_for_owner(
        self, subject: str, limit: int, after: str | None, q: str | None = None
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"owner_sub": subject}
        if after is not None:
            query["_id"] = {"$gt": ObjectId(after)}
        if q is not None and q.strip():
            pattern = _accent_insensitive_regex(q.strip())
            query["$or"] = [
                {"title": {"$regex": pattern, "$options": "i"}},
                {"author": {"$regex": pattern, "$options": "i"}},
            ]
        try:
            with self._collection().find(query).sort("_id", 1).limit(limit) as cursor:
                return [_public_book(document) for document in cursor]
        except (PyMongoError, OSError, ValueError):
            raise BooksUnavailable() from None

    def close(self) -> None:
        with self._lock:
            if self._client is not None:
                self._client.close()
                self._client = None
