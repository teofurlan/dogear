"""HTTP entrypoint. Extraction stays in the separate CLI and night job."""

from fastapi import FastAPI


async def health() -> dict[str, str]:
    """Report HTTP liveness, not database, storage or model readiness."""
    return {"status": "ok"}


def create_app() -> FastAPI:
    """Build an independent app without opening external connections."""
    app = FastAPI(title="Dogear API")
    app.add_api_route("/health", health, methods=["GET"], tags=["health"])
    return app
