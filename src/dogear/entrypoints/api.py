"""HTTP entrypoint. Extraction stays in the separate CLI and night job."""

from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Security
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


class BookInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)
    title: str = Field(min_length=1, max_length=300)
    author: str | None = Field(default=None, min_length=1, max_length=300)


class Book(BookInput):
    id: str


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
