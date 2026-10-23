"""MongoDB book storage. Ownership always comes from a verified token subject."""

import os
from dataclasses import dataclass, field
from threading import Lock
from typing import Any
from urllib.parse import urlsplit

import pymongo
from bson import ObjectId
from pymongo.errors import PyMongoError


class BooksUnavailable(Exception):
    """Storage cannot safely complete the requested operation."""


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


def _public_book(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(document["_id"]),
        "title": document["title"],
        "author": document["author"],
    }


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

    def create(self, subject: str, title: str, author: str | None) -> dict[str, Any]:
        document = {"owner_sub": subject, "title": title, "author": author}
        try:
            result = self._collection().insert_one(document)
        except (PyMongoError, OSError, ValueError):
            raise BooksUnavailable() from None
        return _public_book({**document, "_id": result.inserted_id})

    def list_for_owner(
        self, subject: str, limit: int, after: str | None
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"owner_sub": subject}
        if after is not None:
            query["_id"] = {"$gt": ObjectId(after)}
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
