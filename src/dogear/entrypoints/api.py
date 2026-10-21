"""HTTP entrypoint. Extraction stays in the separate CLI and night job."""

from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from dogear.adapters.auth0_jwt import (
    Auth0Config,
    Auth0TokenVerifier,
    AuthenticationUnavailable,
    InvalidAccessToken,
)


async def health() -> dict[str, str]:
    """Report HTTP liveness, not database, storage or model readiness."""
    return {"status": "ok"}


def create_app() -> FastAPI:
    """Build an independent app without opening external connections."""
    app = FastAPI(title="Dogear API")
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

    return app
