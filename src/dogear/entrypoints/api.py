"""HTTP entrypoint. Extraction stays in the separate CLI and night job."""

import asyncio
import logging
import contextlib
from contextlib import asynccontextmanager
from threading import BoundedSemaphore
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.concurrency import run_in_threadpool

from dogear.adapters.auth0_jwt import (
    Auth0Config,
    Auth0TokenVerifier,
    AuthenticationUnavailable,
    InvalidAccessToken,
)
from dogear.adapters.mongo_books import BooksUnavailable, MongoBooks, MongoConfig
from dogear.adapters.mongo_captures import MongoCaptures
from dogear.adapters.r2_photos import R2Config, R2Photos
from dogear.application.covers import cover_key, prepare_cover_photo
from dogear.application.identify import MAX_BYTES, CoverError, identify_cover
from dogear.application.pages import page_key, prepare_page_photo
from dogear.ports.captures import CapturesUnavailable, CaptureStore
from dogear.ports.photo_store import PhotosUnavailable, PhotoStore


class BookInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)
    title: str = Field(min_length=1, max_length=300)
    author: str | None = Field(default=None, min_length=1, max_length=300)


class Book(BookInput):
    id: str
    has_cover_photo: bool = False


class CoverSuggestion(BaseModel):
    title: str
    author: str | None
    text: str


class Page(BaseModel):
    id: str
    book_id: str
    status: Literal["pending", "processing", "processed", "failed"]
    created_at: str


class QuoteInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)
    text: str = Field(min_length=1, max_length=5000)


class QuoteEdit(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)
    text: str | None = Field(default=None, min_length=1, max_length=5000)
    status: Literal["kept"] | None = None

    @model_validator(mode="after")
    def something_to_change(self):
        if self.text is None and self.status is None:
            raise ValueError("Provide text or status")
        return self


class Quote(BaseModel):
    id: str
    book_id: str
    page_id: str | None
    text: str
    flags: list[str]
    status: Literal["pending", "kept"]
    has_crop: bool
    created_at: str


BOOK_ERRORS = {
    401: {"description": "Invalid or missing access token"},
    503: {"description": "Authentication or book storage unavailable"},
}


IMAGE_TYPES = {"image/jpeg", "image/png"}
PHOTO_BODY = {
    "requestBody": {
        "required": True,
        "content": {
            kind: {"schema": {"type": "string", "format": "binary"}}
            for kind in sorted(IMAGE_TYPES)
        },
    }
}
PHOTO_ERRORS = {
    413: {"description": "Photo too large"},
    415: {"description": "Unsupported image format"},
    422: {"description": "Unreadable photo"},
    429: {"description": "Photo readers busy"},
}
CAPTURE_ERRORS = {**BOOK_ERRORS, 404: {"description": "Unknown book or quote"}}


def check_photo_headers(request: Request) -> None:
    """Reject by header what never needs its body read."""
    if request.headers.get("content-type", "").split(";")[0] not in IMAGE_TYPES:
        raise HTTPException(415, "Choose a JPEG or PNG photo")
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_BYTES:
        raise HTTPException(413, "Use a photo smaller than 6 MiB")


async def read_photo_body(request: Request, what: str) -> bytes:
    """Read a raw upload under the size cap and the 10-second upload deadline."""
    data = bytearray()
    try:
        async with asyncio.timeout(10):
            async for chunk in request.stream():
                if len(data) + len(chunk) > MAX_BYTES:
                    raise HTTPException(413, "Use a photo smaller than 6 MiB")
                data.extend(chunk)
    except TimeoutError:
        raise HTTPException(408, "Photo upload timed out") from None
    if not data:
        raise HTTPException(422, f"Choose a non-empty {what}")
    return bytes(data)


def book_store(request: Request) -> MongoBooks:
    store = getattr(request.app.state, "books", None)
    if store is None:
        raise HTTPException(503, "Book storage unavailable")
    return store


def capture_store(request: Request) -> CaptureStore:
    """Pages and quotes live in the same MongoDB as books."""
    store = request.app.state.captures
    if store is None:
        raise HTTPException(503, "Book storage unavailable")
    return store


def photo_store(request: Request) -> PhotoStore:
    store = request.app.state.photos
    if store is None:
        raise HTTPException(503, "Photo storage unavailable")
    return store


log = logging.getLogger(__name__)

async def health() -> dict[str, str]:
    """Report HTTP liveness, not database, storage or model readiness."""
    return {"status": "ok"}


def create_app() -> FastAPI:
    """Build an independent app without opening external connections."""
    mongo_config = MongoConfig.from_environment()
    books = MongoBooks(mongo_config) if mongo_config else None
    captures = MongoCaptures(mongo_config) if mongo_config else None
    r2_config = R2Config.from_environment()
    photos = R2Photos(r2_config) if r2_config else None
    if photos is None:
        log.warning("page photo storage disabled: %s", R2Config.problem())

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            yield
        finally:
            for closable in (books, captures):
                if closable is not None:
                    await run_in_threadpool(closable.close)

    app = FastAPI(title="Dogear API", lifespan=lifespan)
    app.state.books, app.state.captures, app.state.photos = books, captures, photos
    cover_slots = BoundedSemaphore(2)
    page_slots = BoundedSemaphore(2)
    app.add_api_route("/health", health, methods=["GET"], tags=["health"])
    config = Auth0Config.from_environment()
    verifier = Auth0TokenVerifier(config) if config else None

    def current_subject(
        credentials: Annotated[
            HTTPAuthorizationCredentials | None, Security(HTTPBearer(auto_error=False))
        ],
    ) -> str:
        if credentials is None:
            raise HTTPException(
                401, "Bearer token required", headers={"WWW-Authenticate": "Bearer"}
            )
        if verifier is None:
            raise HTTPException(503, "Authentication unavailable")
        try:
            return verifier.verify(credentials.credentials)
        except InvalidAccessToken:
            raise HTTPException(
                401, "Invalid access token", headers={"WWW-Authenticate": "Bearer"}
            ) from None
        except AuthenticationUnavailable:
            raise HTTPException(503, "Authentication unavailable") from None

    @app.get(
        "/me",
        tags=["identity"],
        responses={
            401: {"description": "Invalid or missing access token"},
            503: {"description": "Authentication unavailable"},
        },
    )
    async def me(subject: Annotated[str, Depends(current_subject)]) -> dict[str, str]:
        """Return only the verified token subject, not a database user profile."""
        return {"sub": subject}

    @app.post(
        "/books/identify",
        response_model=CoverSuggestion,
        tags=["books"],
        responses={**BOOK_ERRORS, **PHOTO_ERRORS},
        openapi_extra=PHOTO_BODY,
    )
    async def identify_book(
        request: Request, subject: Annotated[str, Depends(current_subject)]
    ):
        """Read a transient cover (6 MiB/20 MP); review suggestions before POST /books."""
        check_photo_headers(request)
        if not cover_slots.acquire(blocking=False):
            raise HTTPException(429, "Cover readers are busy; try again shortly")
        try:
            data = await read_photo_body(request, "cover photo")
            return await run_in_threadpool(identify_cover, data)
        except CoverError as error:
            raise HTTPException(error.status, error.message) from None
        finally:
            cover_slots.release()

    @app.post(
        "/books",
        status_code=201,
        response_model=Book,
        tags=["books"],
        responses=BOOK_ERRORS,
    )
    def create_book(
        book: BookInput,
        subject: Annotated[str, Depends(current_subject)],
        books: Annotated[MongoBooks, Depends(book_store)],
    ):
        """Create a book owned by the verified caller, never by a supplied user ID."""
        try:
            return books.create(subject, book.title, book.author)
        except BooksUnavailable:
            raise HTTPException(503, "Book storage unavailable") from None

    @app.get("/books", response_model=list[Book], tags=["books"], responses=BOOK_ERRORS)
    def list_books(
        subject: Annotated[str, Depends(current_subject)],
        books: Annotated[MongoBooks, Depends(book_store)],
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        after: Annotated[str | None, Query(pattern="^[0-9a-fA-F]{24}$")] = None,
    ):
        """List own books by ascending ID; continue with the last returned ID as after."""
        try:
            return books.list_for_owner(subject, limit, after)
        except BooksUnavailable:
            raise HTTPException(503, "Book storage unavailable") from None

    @app.get(
        "/books/{book_id}",
        response_model=Book,
        tags=["books"],
        responses={**BOOK_ERRORS, 404: {"description": "Unknown book"}},
    )
    def get_book(
        book_id: str,
        subject: Annotated[str, Depends(current_subject)],
        books: Annotated[MongoBooks, Depends(book_store)],
    ):
        """Get a single book by ID, only if owned by the caller."""
        try:
            book = books.get_for_owner(subject, book_id)
        except BooksUnavailable:
            raise HTTPException(503, "Book storage unavailable") from None
        if book is None:
            raise HTTPException(404, "Book not found")
        return book

    @app.put(
        "/books/{book_id}/cover",
        response_model=Book,
        tags=["books"],
        responses={**BOOK_ERRORS, **PHOTO_ERRORS, 404: {"description": "Unknown book"}},
        openapi_extra=PHOTO_BODY,
    )
    async def upload_cover(
        book_id: str,
        request: Request,
        subject: Annotated[str, Depends(current_subject)],
        books: Annotated[MongoBooks, Depends(book_store)],
        photos: Annotated[PhotoStore, Depends(photo_store)],
    ):
        """Store a book's cover photo (6 MiB/20 MP) for the fallback display."""
        check_photo_headers(request)
        try:
            if not await run_in_threadpool(books.owns_book, subject, book_id):
                raise HTTPException(404, "Book not found")
        except BooksUnavailable:
            raise HTTPException(503, "Book storage unavailable") from None
        if not cover_slots.acquire(blocking=False):
            raise HTTPException(429, "Cover readers are busy; try again shortly")
        try:
            data = await read_photo_body(request, "cover photo")
            jpeg = await run_in_threadpool(prepare_cover_photo, data)
            key = cover_key(subject, book_id)
            await run_in_threadpool(photos.put, key, jpeg)
            try:
                updated = await run_in_threadpool(
                    books.set_cover_photo, subject, book_id, True
                )
                if updated is None:
                    raise HTTPException(404, "Book not found")
                return updated
            except BooksUnavailable:
                with contextlib.suppress(PhotosUnavailable):
                    await run_in_threadpool(photos.delete, key)
                raise HTTPException(503, "Book storage unavailable") from None
        except CoverError as error:
            raise HTTPException(error.status, error.message) from None
        except PhotosUnavailable:
            raise HTTPException(503, "Photo storage unavailable") from None
        finally:
            cover_slots.release()

    @app.get(
        "/books/{book_id}/cover",
        tags=["books"],
        response_class=Response,
        responses={
            **BOOK_ERRORS,
            404: {"description": "Unknown book or cover photo"},
            200: {"content": {"image/jpeg": {}}},
        },
    )
    async def get_cover(
        book_id: str,
        subject: Annotated[str, Depends(current_subject)],
        books: Annotated[MongoBooks, Depends(book_store)],
        photos: Annotated[PhotoStore, Depends(photo_store)],
    ):
        """The stored cover photo, returned only to the book's owner."""
        try:
            book = await run_in_threadpool(books.get_for_owner, subject, book_id)
        except BooksUnavailable:
            raise HTTPException(503, "Book storage unavailable") from None
        if book is None or not book.get("has_cover_photo"):
            raise HTTPException(404, "Cover photo not found")
        key = cover_key(subject, book_id)
        try:
            data = await run_in_threadpool(photos.get, key)
        except PhotosUnavailable:
            raise HTTPException(503, "Photo storage unavailable") from None
        return Response(
            data,
            media_type="image/jpeg",
            headers={"Cache-Control": "private, no-store"},
        )

    @app.post(
        "/books/{book_id}/pages",
        status_code=201,
        response_model=Page,
        tags=["pages"],
        responses={**CAPTURE_ERRORS, **PHOTO_ERRORS},
        openapi_extra=PHOTO_BODY,
    )
    async def upload_page(
        book_id: str,
        request: Request,
        subject: Annotated[str, Depends(current_subject)],
        captures: Annotated[CaptureStore, Depends(capture_store)],
        photos: Annotated[PhotoStore, Depends(photo_store)],
    ):
        """Store a highlighted page photo (6 MiB/20 MP) for tonight's extraction run."""
        check_photo_headers(request)
        try:
            if not await run_in_threadpool(captures.owns_book, subject, book_id):
                raise HTTPException(404, "Book not found")
        except CapturesUnavailable:
            raise HTTPException(503, "Book storage unavailable") from None
        if not page_slots.acquire(blocking=False):
            raise HTTPException(429, "Page readers are busy; try again shortly")
        try:
            data = await read_photo_body(request, "page photo")
            jpeg = await run_in_threadpool(prepare_page_photo, data)
            page_id = uuid4().hex
            key = page_key(subject, page_id)
            await run_in_threadpool(photos.put, key, jpeg)
            try:
                return await run_in_threadpool(
                    captures.create_page, subject, book_id, page_id, key
                )
            except CapturesUnavailable:
                with contextlib.suppress(PhotosUnavailable):
                    await run_in_threadpool(photos.delete, key)
                raise HTTPException(503, "Book storage unavailable") from None
        except CoverError as error:
            raise HTTPException(error.status, error.message) from None
        except PhotosUnavailable:
            raise HTTPException(503, "Photo storage unavailable") from None
        finally:
            page_slots.release()

    @app.get(
        "/books/{book_id}/pages",
        response_model=list[Page],
        tags=["pages"],
        responses=CAPTURE_ERRORS,
    )
    def list_pages(
        book_id: str,
        subject: Annotated[str, Depends(current_subject)],
        captures: Annotated[CaptureStore, Depends(capture_store)],
    ):
        """List own pages of a book, newest first; photos are never returned."""
        try:
            if not captures.owns_book(subject, book_id):
                raise HTTPException(404, "Book not found")
            return captures.list_pages(subject, book_id)
        except CapturesUnavailable:
            raise HTTPException(503, "Book storage unavailable") from None

    @app.get(
        "/quotes",
        response_model=list[Quote],
        tags=["quotes"],
        responses=CAPTURE_ERRORS,
    )
    def list_quotes(
        subject: Annotated[str, Depends(current_subject)],
        captures: Annotated[CaptureStore, Depends(capture_store)],
        book_id: str | None = None,
        status: Literal["pending", "kept"] | None = None,
    ):
        """List own quotes, oldest first, optionally for one book or one status."""
        try:
            return captures.list_quotes(subject, book_id, status)
        except CapturesUnavailable:
            raise HTTPException(503, "Book storage unavailable") from None

    @app.get(
        "/quotes/{quote_id}/crop",
        tags=["quotes"],
        response_class=Response,
        responses={**CAPTURE_ERRORS, 200: {"content": {"image/jpeg": {}}}},
    )
    def quote_crop(
        quote_id: str,
        subject: Annotated[str, Depends(current_subject)],
        captures: Annotated[CaptureStore, Depends(capture_store)],
    ):
        """The photo crop of a quote's passage, for the reviewer's eyes only."""
        try:
            crop = captures.quote_crop(subject, quote_id)
        except CapturesUnavailable:
            raise HTTPException(503, "Book storage unavailable") from None
        if crop is None:
            raise HTTPException(404, "Crop not found")
        return Response(
            crop, media_type="image/jpeg", headers={"Cache-Control": "private, no-store"}
        )

    @app.patch(
        "/quotes/{quote_id}",
        response_model=Quote,
        tags=["quotes"],
        responses=CAPTURE_ERRORS,
    )
    def edit_quote(
        quote_id: str,
        edit: QuoteEdit,
        subject: Annotated[str, Depends(current_subject)],
        captures: Annotated[CaptureStore, Depends(capture_store)],
    ):
        """Edit the text and/or keep a quote."""
        try:
            quote = captures.update_quote(subject, quote_id, edit.text, edit.status)
        except CapturesUnavailable:
            raise HTTPException(503, "Book storage unavailable") from None
        if quote is None:
            raise HTTPException(404, "Quote not found")
        return quote

    @app.delete(
        "/quotes/{quote_id}",
        status_code=204,
        response_class=Response,
        tags=["quotes"],
        responses=CAPTURE_ERRORS,
    )
    def delete_quote(
        quote_id: str,
        subject: Annotated[str, Depends(current_subject)],
        captures: Annotated[CaptureStore, Depends(capture_store)],
    ):
        try:
            deleted = captures.delete_quote(subject, quote_id)
        except CapturesUnavailable:
            raise HTTPException(503, "Book storage unavailable") from None
        if not deleted:
            raise HTTPException(404, "Quote not found")
        return Response(status_code=204)

    @app.post(
        "/books/{book_id}/quotes",
        status_code=201,
        response_model=Quote,
        tags=["quotes"],
        responses=CAPTURE_ERRORS,
    )
    def add_quote(
        book_id: str,
        quote: QuoteInput,
        subject: Annotated[str, Depends(current_subject)],
        captures: Annotated[CaptureStore, Depends(capture_store)],
    ):
        """Add a passage the extraction missed, already kept."""
        try:
            if not captures.owns_book(subject, book_id):
                raise HTTPException(404, "Book not found")
            return captures.add_quote(subject, book_id, quote.text)
        except CapturesUnavailable:
            raise HTTPException(503, "Book storage unavailable") from None

    return app
