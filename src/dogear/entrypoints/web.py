"""Production entrypoint: the API under /api and the built PWA, from one origin.

The browser only ever calls same-origin /api/..., exactly like the Vite dev proxy,
so tokens never cross origins and no CORS policy is needed.
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from starlette.staticfiles import StaticFiles

from dogear.entrypoints.api import create_app

# Vite fingerprints everything under assets/, so a new build gets new names.
IMMUTABLE = "public, max-age=31536000, immutable"


class BuiltApp(StaticFiles):
    """Serve the PWA build; entry points revalidate so a deploy reaches every phone."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        # Starlette passes an OS-specific relative path.
        if Path(path).parts[:1] == ("assets",) and response.status_code == 200:
            response.headers["cache-control"] = IMMUTABLE
        else:
            response.headers["cache-control"] = "no-cache"
        return response


def create_web_app(dist: Path | None = None) -> FastAPI:
    """Build the deployable app; fails at startup when the frontend was not built."""
    dist = dist or Path(os.getenv("DOGEAR_WEB_DIST", "web/dist"))
    static = BuiltApp(directory=dist, html=True)
    api = create_app()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        # A mounted app's own lifespan never runs; keep closing its storage on shutdown.
        async with api.router.lifespan_context(api):
            yield

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.mount("/api", api)
    app.mount("/", static)
    return app
