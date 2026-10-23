"""MongoDB pages and quotes. Every API call is scoped to a verified token subject."""

from datetime import datetime, timedelta, timezone
from functools import wraps
from threading import Lock
from typing import Any, Collection

from bson import Binary, ObjectId
from pymongo import ReturnDocument
from pymongo.errors import PyMongoError

from dogear.adapters.mongo_books import MongoConfig, make_client
from dogear.ports.captures import CapturesUnavailable

STALE_AFTER = timedelta(hours=2)
MAX_ATTEMPTS = 3
NO_CROP = {"crop": 0}  # list queries never pull the image bytes


def _unavailable_on_failure(method):
    @wraps(method)
    def guarded(*args, **kwargs):
        try:
            return method(*args, **kwargs)
        except (PyMongoError, OSError, ValueError):
            raise CapturesUnavailable() from None

    return guarded


def _object_id(value: str) -> ObjectId | None:
    return ObjectId(value) if ObjectId.is_valid(value) else None


def _iso(moment: datetime) -> str:
    # MongoDB hands back naive UTC datetimes.
    return (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).isoformat()


def _public_page(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": document["_id"],
        "book_id": document["book_id"],
        "status": document["status"],
        "created_at": _iso(document["created_at"]),
    }


def _public_quote(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(document["_id"]),
        "book_id": document["book_id"],
        "page_id": document["page_id"],
        "text": document["text"],
        "flags": list(document["flags"]),
        "status": document["status"],
        "has_crop": document["has_crop"],
        "created_at": _iso(document["created_at"]),
    }


class MongoCaptures:
    """Implements both CaptureStore (HTTP) and NightStore (batch)."""

    def __init__(self, config: MongoConfig, database=None):
        self.config = config
        self._database = database
        self._client = None
        self._lock = Lock()

    def _db(self):
        # Even connect=False may resolve an SRV URI. Defer the constructor itself.
        with self._lock:
            if self._database is None:
                self._client = make_client(self.config)
                self._database = self._client[self.config.database]
            return self._database

    def close(self) -> None:
        with self._lock:
            if self._client is not None:
                self._client.close()
                self._client = self._database = None

    # CaptureStore
    @_unavailable_on_failure
    def owns_book(self, owner: str, book_id: str) -> bool:
        oid = _object_id(book_id)
        if oid is None:
            return False
        return self._db()["books"].find_one({"_id": oid, "owner_sub": owner}) is not None

    @_unavailable_on_failure
    def create_page(self, owner: str, book_id: str, page_id: str, key: str):
        page = {
            "_id": page_id,
            "owner": owner,
            "book_id": book_id,
            "key": key,
            "status": "pending",
            "attempts": 0,
            "error": None,
            "created_at": datetime.now(timezone.utc),
            "processed_at": None,
        }
        self._db()["pages"].insert_one(page)
        return _public_page(page)

    @_unavailable_on_failure
    def list_pages(self, owner: str, book_id: str):
        query = {"owner": owner, "book_id": book_id}
        order = [("created_at", -1), ("_id", -1)]
        with self._db()["pages"].find(query).sort(order) as cursor:
            return [_public_page(document) for document in cursor]

    @_unavailable_on_failure
    def list_quotes(self, owner: str, book_id: str | None, status: str | None):
        query: dict[str, Any] = {"owner": owner}
        if book_id is not None:
            query["book_id"] = book_id
        if status is not None:
            query["status"] = status
        order = [("created_at", 1), ("_id", 1)]
        with self._db()["quotes"].find(query, NO_CROP).sort(order) as cursor:
            return [_public_quote(document) for document in cursor]

    @_unavailable_on_failure
    def quote_crop(self, owner: str, quote_id: str) -> bytes | None:
        oid = _object_id(quote_id)
        if oid is None:
            return None
        document = self._db()["quotes"].find_one({"_id": oid, "owner": owner})
        return bytes(document["crop"]) if document and "crop" in document else None

    @_unavailable_on_failure
    def update_quote(self, owner: str, quote_id: str, text: str | None, status: str | None):
        oid = _object_id(quote_id)
        if oid is None:
            return None
        changes: dict[str, Any] = {"updated_at": datetime.now(timezone.utc)}
        if text is not None:
            changes["text"] = text
        if status is not None:
            changes["status"] = status
        document = self._db()["quotes"].find_one_and_update(
            {"_id": oid, "owner": owner},
            {"$set": changes},
            return_document=ReturnDocument.AFTER,
        )
        return _public_quote(document) if document else None

    @_unavailable_on_failure
    def delete_quote(self, owner: str, quote_id: str) -> bool:
        oid = _object_id(quote_id)
        if oid is None:
            return False
        result = self._db()["quotes"].delete_one({"_id": oid, "owner": owner})
        return result.deleted_count == 1

    @_unavailable_on_failure
    def add_quote(self, owner: str, book_id: str, text: str):
        document = self._quote_document(
            owner, book_id, None, text, text, [], "kept", None, datetime.now(timezone.utc)
        )
        document["_id"] = self._db()["quotes"].insert_one(document).inserted_id
        return _public_quote(document)

    @staticmethod
    def _quote_document(
        owner, book_id, page_id, text, ocr_text, flags, status, crop, now
    ) -> dict[str, Any]:
        document = {
            "owner": owner,
            "book_id": book_id,
            "page_id": page_id,
            "text": text,
            "ocr_text": ocr_text,
            "flags": list(flags),
            "status": status,
            "has_crop": crop is not None,
            "created_at": now,
            "updated_at": now,
        }
        if crop is not None:
            document["crop"] = Binary(crop)
        return document

    # NightStore
    @_unavailable_on_failure
    def claim_page(self, now: datetime, exclude: Collection[str]):
        eligible = [
            {"status": "pending"},
            {"status": "failed", "attempts": {"$lt": MAX_ATTEMPTS}},
            {
                "status": "processing",
                "attempts": {"$lt": MAX_ATTEMPTS},
                "claimed_at": {"$lt": now - STALE_AFTER},
            },
        ]
        page = self._db()["pages"].find_one_and_update(
            {"$or": eligible, "_id": {"$nin": list(exclude)}},
            {
                "$set": {"status": "processing", "claimed_at": now, "error": None},
                "$inc": {"attempts": 1},
            },
            sort=[("created_at", 1), ("_id", 1)],
            return_document=ReturnDocument.AFTER,
        )
        if page is None:
            return None
        return {
            "id": page["_id"],
            "owner": page["owner"],
            "book_id": page["book_id"],
            "key": page["key"],
            "attempts": page["attempts"],
        }

    @_unavailable_on_failure
    def replace_page_quotes(self, page: dict[str, Any], quotes: list[dict[str, Any]], now: datetime):
        collection = self._db()["quotes"]
        # A retried page must not duplicate what an earlier attempt already inserted.
        collection.delete_many({"page_id": page["id"], "status": "pending"})
        documents = [
            self._quote_document(
                page["owner"],
                page["book_id"],
                page["id"],
                quote["text"],
                quote["ocr_text"],
                quote["flags"],
                "pending",
                quote["crop"],
                now,
            )
            for quote in quotes
        ]
        if documents:
            collection.insert_many(documents)

    @_unavailable_on_failure
    def finish_page(self, page_id: str, now: datetime) -> None:
        self._db()["pages"].update_one(
            {"_id": page_id}, {"$set": {"status": "processed", "processed_at": now}}
        )

    @_unavailable_on_failure
    def fail_page(self, page_id: str, error: str) -> None:
        self._db()["pages"].update_one(
            {"_id": page_id}, {"$set": {"status": "failed", "error": error[:500]}}
        )
