"""HTTP entrypoint. Extraction stays in the separate CLI and night job."""

import asyncio
from contextlib import asynccontextmanager
from threading import BoundedSemaphore
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from dogear.adapters.auth0_jwt import (
    Auth0Config,
    Auth0TokenVerifier,
    AuthenticationUnavailable,
    InvalidAccessToken,
)
from dogear.adapters.mongo_books import BooksUnavailable, MongoBooks, MongoConfig
from dogear.application.identify import MAX_BYTES, CoverError, identify_cover


class BookInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)
    title: str = Field(min_length=1, max_length=300)
    author: str | None = Field(default=None, min_length=1, max_length=300)


class Book(BookInput):
    id: str


class CoverSuggestion(BaseModel):
    title: str
    author: str | None
    text: str


BOOK_ERRORS = {
    401: {"description": "Invalid or missing access token"},
    503: {"description": "Authentication or book storage unavailable"},
}


async def health() -> dict[str, str]:
    """Report HTTP liveness, not database, storage or model readiness."""
    return {"status": "ok"}


def create_app() -> FastAPI:
    """Build an independent app without opening external connections."""
    mongo_config = MongoConfig.from_environment()
    books = MongoBooks(mongo_config) if mongo_config else None

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            yield
        finally:
            if books is not None:
                await run_in_threadpool(books.close)

    app = FastAPI(title="Dogear API", lifespan=lifespan)
    cover_slots = BoundedSemaphore(2)
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

    def book_store() -> MongoBooks:
        if books is None:
            raise HTTPException(503, "Book storage unavailable")
        return books

    @app.post(
        "/books/identify",
        response_model=CoverSuggestion,
        tags=["books"],
        responses={
            **BOOK_ERRORS,
            413: {"description": "Photo too large"},
            415: {"description": "Unsupported image format"},
            422: {"description": "Unreadable photo"},
            429: {"description": "Cover readers busy"},
        },
        openapi_extra={
            "requestBody": {
                "required": True,
                "content": {
                    kind: {"schema": {"type": "string", "format": "binary"}}
                    for kind in ("image/jpeg", "image/png")
                },
            }
        },
    )
    async def identify_book(
        request: Request, subject: Annotated[str, Depends(current_subject)]
    ):
        """Read a transient cover (6 MiB/20 MP); review suggestions before POST /books."""
        if request.headers.get("content-type", "").split(";")[0] not in {
            "image/jpeg",
            "image/png",
        }:
            raise HTTPException(415, "Choose a JPEG or PNG cover photo")
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > MAX_BYTES:
            raise HTTPException(413, "Use a photo smaller than 6 MiB")
        if not cover_slots.acquire(blocking=False):
            raise HTTPException(429, "Cover readers are busy; try again shortly")
        try:
            data = bytearray()
            async with asyncio.timeout(10):
                async for chunk in request.stream():
                    if len(data) + len(chunk) > MAX_BYTES:
                        raise HTTPException(413, "Use a photo smaller than 6 MiB")
                    data.extend(chunk)
            if not data:
                raise HTTPException(422, "Choose a non-empty cover photo")
            return await run_in_threadpool(identify_cover, bytes(data))
        except CoverError as error:
            raise HTTPException(error.status, error.message) from None
        except TimeoutError:
            raise HTTPException(408, "Photo upload timed out") from None
        finally:
            cover_slots.release()

    @app.post(
        "/books",
        status_code=201,
        response_model=Book,
        tags=["books"],
        responses=BOOK_ERRORS,
    )
    def create_book(book: BookInput, subject: Annotated[str, Depends(current_subject)]):
        """Create a book owned by the verified caller, never by a supplied user ID."""
        try:
            return book_store().create(subject, book.title, book.author)
        except BooksUnavailable:
            raise HTTPException(503, "Book storage unavailable") from None

    @app.get("/books", response_model=list[Book], tags=["books"], responses=BOOK_ERRORS)
    def list_books(
        subject: Annotated[str, Depends(current_subject)],
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        after: Annotated[str | None, Query(pattern="^[0-9a-fA-F]{24}$")] = None,
    ):
        """List own books by ascending ID; continue with the last returned ID as after."""
        try:
            return book_store().list_for_owner(subject, limit, after)
        except BooksUnavailable:
            raise HTTPException(503, "Book storage unavailable") from None

    return app
