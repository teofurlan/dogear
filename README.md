# Dogear

Photograph the pages you highlighted in a paper book. Overnight, a small open-weight model on a CPU extracts exactly the highlighted passages. In the morning you review them, and they go to your book log (and to Notion, if you want).

Built for the [DEV Hacktoberfest Open-Source AI Challenge, Week 3: Slow and Steady](https://dev.to/devteam/join-the-hacktoberfest-open-source-ai-challenge-slow-and-steady-2850-in-prizes-across-21-3iee).

**Status:** work in progress. The extraction pipeline runs from the command line and in a Render cron job. FastAPI runs locally with Auth0 token validation and MongoDB-backed, owner-scoped book creation/listing. The React/Vite library uses the selected Small-press catalog design, Auth0 sign-in and representative covers. The real local browser login, callback and authenticated book-list request have passed; the current account correctly shows an empty library. The API stores page photos in R2 and the night job turns them into quotes to review (see below). Installable/offline PWA behavior remains pending. See [web setup and boundaries](web/README.md).

- [Requirements and feasibility evidence](docs/requirements.md)
- [Build log (DEV post draft)](docs/post-draft.md)

## Add books from a cover

The local library supports manual book entry and JPEG/PNG cover-photo suggestions.
Review and correct the proposed title/author, then explicitly save the book. OCR is
not catalog verification; unreadable covers still allow manual entry. Photos are
transient and are not stored as book covers. No cloud resources are changed.

`POST /books/identify` requires the same Bearer token as `/books`. Send raw
`image/jpeg` or `image/png` bytes, not multipart or JSON. It returns
`{"title":"...","author":null,"text":"..."}` without creating a book.
Limits: 6 MiB, 20 megapixels, 10,000 pixels per side, a 10-second upload deadline,
15-second OCR deadline and two readers per API process. Errors: `401` authentication,
`408` upload deadline, `413` size, `415` format, `422` unreadable image,
`429` busy readers, `503` unavailable auth/OCR. Details remain editable on failure.
Install Tesseract with Spanish data as described below; recognition needs no Ollama
or external book-catalog service. The API is still not deployed.

## How extraction works

The model reads; the code decides.

1. **Highlights, any pen color.** In the Lab color space, each pixel is compared with the paper's own tint, fitted as a smooth surface across the photo so that uneven light doesn't fool it. The page is the largest paper region with its holes filled, so a thumb on the edge or the table never counts.
2. **Word boundaries.** Tesseract returns a box for every word. A word belongs to a quote when at least 25% of the paper under its box is highlighted. Short gaps are merged, and words split by an end-of-line hyphen are joined.
3. **Two readers.** A local vision model (Gemma 4 through Ollama) transcribes each passage from a crop that shows only the passage's own words. Its text is kept, and words it dropped or added compared with OCR flag the quote for review.

Code: [`imaging/highlight.py`](src/dogear/imaging/highlight.py), [`domain/passages.py`](src/dogear/domain/passages.py), [`domain/agreement.py`](src/dogear/domain/agreement.py), [`application/extract.py`](src/dogear/application/extract.py).

## Run it locally

Requires Python 3.13 with [uv](https://docs.astral.sh/uv/), [Tesseract](https://github.com/tesseract-ocr/tesseract) 5 with Spanish data, and optionally [Ollama](https://ollama.com) with `gemma4:e4b`.

```bash
uv sync
uv run dogear-extract page.jpg --no-model          # OCR only
uv run dogear-extract page.jpg --cpu-only --threads 4  # with Gemma on CPU
```

| Variable | Default | Purpose |
|---|---|---|
| `DOGEAR_TESSERACT_CMD` | `tesseract` on PATH, or the Windows installer path | Tesseract binary |
| `DOGEAR_TESSDATA` | `./models/tessdata` when it has `spa.traineddata` | Tesseract language data |
| `DOGEAR_OLLAMA_URL` | `http://localhost:11434` | Ollama server |

On Windows the installer ships only English; put `spa.traineddata` from [tessdata_best](https://github.com/tesseract-ocr/tessdata_best) in `models/tessdata/`.

## Run the API locally

```bash
uv sync --locked
uv run uvicorn dogear.entrypoints.api:create_app --factory --reload --host 127.0.0.1
```

Check `GET http://127.0.0.1:8000/health`: it returns `200` with `{"status":"ok"}`.
Interactive documentation is at [localhost:8000/docs](http://127.0.0.1:8000/docs),
and its OpenAPI schema is at `/openapi.json`.

The app factory creates a separate HTTP entrypoint without loading OCR or Gemma.
`/health` checks only that HTTP requests can be served: it does not check MongoDB,
R2, Auth0 or the night job. No credentials are needed for this liveness route;
credentials are needed for protected identity/book requests. The API has not been deployed; the existing Docker
image still runs the night job. `--reload` is for local development only.

### Protect an identity request with Auth0

Copy `.env.example` to `.env`, set `DOGEAR_AUTH0_DOMAIN` to the tenant hostname
(no scheme or path), and set `DOGEAR_AUTH0_AUDIENCE` to the API's exact identifier.
These are public identifiers; no client secret or signing private key is needed.
Load that file explicitly:

```bash
uv run --env-file .env uvicorn dogear.entrypoints.api:create_app --factory --reload --host 127.0.0.1
```

`GET /me` requires `Authorization: Bearer <access-token>`. It returns only the
verified subject, for example `{"sub":"auth0|reader"}`, not a database profile.
Validation uses fixed RS256, the configured issuer/audience, and required
`exp`, `iss`, `aud`, `sub` claims. Missing, expired or invalid tokens return `401`
with `WWW-Authenticate: Bearer`. Missing configuration or unavailable/malformed
signing keys fail closed with `503`; `/health` remains public.

Public signing keys are fetched from the configured tenant's HTTPS JWKS endpoint
only when needed, with a 3-second request timeout and a 5-minute cache. Unknown
key IDs can refresh the cache after a 30-second cooldown; a newly rotated key can
be rejected during that cooldown. Blocking key retrieval runs in a worker thread.
The token cannot select another issuer, key URL or algorithm.

Tests use local RSA signatures and mocked JWKS transport: they do not contact Auth0.
The web interface uses the Auth0 React SDK for browser login and access-token
acquisition. Use an API access token, not an ID token. Book ownership is enforced using the verified subject below;
FGA and Token Vault integrations remain future work.

### Create and list your books

Set the four `DOGEAR_MONGODB_*` variables in the ignored local `.env`, using
`.env.example` as a template. Do not overwrite an existing `.env` with the template.
The URI must use `mongodb+srv://` without credentials. Put the database user's
username and password in their separate variables; do not URI-encode that password.
Atlas users authenticate against `admin`; `DOGEAR_MONGODB_DATABASE` selects the
application database. Grant only `readWrite` on that database and allow only the
application host's IP in Atlas. Never commit this file or paste tokens/passwords into logs.

Both routes require the same Bearer access token as `/me`:

| Route | Request | Result |
|---|---|---|
| `POST /books` | `{"title":"A quiet morning","author":"Ada Reed"}` | `201`, with `id`, `title`, `author` |
| `GET /books` | Optional `limit` and `after` query parameters | `200`, an array containing only your books |

Title is required; author may be omitted or `null`. Supplied strings are trimmed
and must contain 1-300 characters. Extra input fields, including any owner or ID,
are rejected with `422`. The server assigns ownership from the verified token's
`sub`, never from a request field, and does not expose it in book responses.

Listing defaults to 50 books, with a maximum `limit` of 100. Results use ascending
MongoDB ID order. To continue, pass the last returned `id` as `after`, a 24-character
hexadecimal ID. An empty array ends the traversal. This is not a snapshot across
concurrent inserts. There are no edit/delete, cover/ISBN lookup or reading-state
operations in this slice.

Incomplete MongoDB configuration and driver failures return a generic `503` without
database/credential details. A failed write can have an unknown outcome; this API
does not yet offer an idempotency key. Health/docs and identity remain independent
of MongoDB availability. The synchronous SDK runs in worker-thread handlers; its
client is created lazily for an authenticated book request, reused within the app,
and closed at shutdown. Operations have a 5-second driver timeout, with 3-second
server-selection/connection limits; no TLS verification bypass is enabled.

HTTP tests keep real JWT verification and replace only JWKS and MongoDB transports.
They cover per-user isolation, rejected input, pagination, failure behavior and
connection lifecycle. They do not prove a live Auth0 tenant login. The cron Docker
image remains separate from this local API.

A local HTTP smoke check also created and listed two clearly marked synthetic
books in Atlas, using local RSA/JWKS test identities. Those records were retained
for explicit cleanup; no existing records were changed or deleted. This checks
MongoDB persistence, not the real Auth0 login or PWA flow.

## Capture pages and review quotes

Photograph the highlighted pages of a book; the nightly job turns them into quotes and
you review them in the morning. Every route needs the same Bearer token as `/books`,
is scoped to the token's subject, and answers `404` for a book or quote that is not
yours. All of these need the MongoDB variables; only the upload also needs R2.

| Route | Request | Result |
|---|---|---|
| `POST /books/{book_id}/pages` | Raw `image/jpeg` or `image/png` body, same limits and errors as `/books/identify` | `201` `{"id","book_id","status":"pending","created_at"}`; `503` without R2 |
| `GET /books/{book_id}/pages` | | `200`, your pages of the book, newest first (no photo bytes) |
| `GET /quotes` | Optional `book_id`, `status` (`pending` or `kept`) | `200`, `[{"id","book_id","page_id","text","flags","status","has_crop","created_at"}]`, oldest first |
| `GET /quotes/{id}/crop` | | `image/jpeg` with `Cache-Control: private, no-store`; `404` when absent |
| `PATCH /quotes/{id}` | `{"text"?, "status"?: "kept"}`, text 1-5000 characters | `200`, the quote |
| `DELETE /quotes/{id}` | | `204` |
| `POST /books/{book_id}/quotes` | `{"text"}` for a passage the run missed | `201`, a `kept` quote without crop or page |

The upload is validated, re-encoded as an upright JPEG without metadata, and stored in
a private [Cloudflare R2](https://developers.cloudflare.com/r2/) bucket under
`pages/<sha256 of the subject>/<page id>.jpg`. The browser never reads that bucket and
no photo is ever returned by the API.

| Variable | Purpose |
|---|---|
| `DOGEAR_R2_ENDPOINT` | `https://<account id>.r2.cloudflarestorage.com` |
| `DOGEAR_R2_ACCESS_KEY_ID`, `DOGEAR_R2_SECRET_ACCESS_KEY` | An R2 API token limited to Object Read & Write on that bucket |
| `DOGEAR_R2_BUCKET` | The bucket name |

Set all four on the web service (uploads) and on the night cron job (downloads and
deletes). Without them the API still works and page uploads answer `503`.

### The night run

`dogear-night` claims pending pages one at a time (a page stuck in `processing` for
over two hours counts as pending; a `failed` page is retried on later nights up to
three attempts), downloads each photo, extracts the highlighted passages with
Tesseract and Gemma, and stores one `pending` quote per passage with a small JPEG crop
of the passage (at most 800 px wide) in MongoDB. **A processed page's photo is deleted
from R2**; only the crops stay. If a page fails, its photo is kept and the error is
recorded on the page. It logs one line, for example
`dogear-night: pages=5 processed=5 failed=0 quotes=12 seconds=480.2`.

The cron job uses the `Dockerfile` image and needs the `DOGEAR_MONGODB_*` and
`DOGEAR_R2_*` variables. With no Docker Command the image runs `night-job`, which starts
Ollama and then:

```bash
dogear-night --model "$DOGEAR_MODEL" --cpu-only --threads 4
```

`night-job` with arguments keeps the old behavior: `night-job /app/sample/page.jpg`
runs `dogear-extract` on those files and prints JSON, with no storage involved.
Locally: `uv run dogear-night --cpu-only --threads 4` (add `--no-model` for OCR only).

## Deploy the web app

`Dockerfile.web` builds one image for a Render web service: FastAPI serves the built
PWA and mounts the API under `/api`, the same path the Vite dev proxy uses, so the
browser only talks to its own origin. It installs Tesseract for cover photos but not
Ollama or Gemma; the night job keeps its own image (`Dockerfile`).

Service environment variables:

| Variable | Used | Value |
|---|---|---|
| `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE` | build | Public Auth0 identifiers, embedded in the bundle |
| `DOGEAR_AUTH0_DOMAIN`, `DOGEAR_AUTH0_AUDIENCE` | runtime | Token validation, as in local development |
| `DOGEAR_MONGODB_URI`, `DOGEAR_MONGODB_USERNAME`, `DOGEAR_MONGODB_DATABASE` | runtime | Atlas connection |
| `DOGEAR_MONGODB_PASSWORD` | runtime | Secret; set it in the Render dashboard |
| `DOGEAR_R2_ENDPOINT`, `DOGEAR_R2_BUCKET` | runtime | Page photo bucket (see above) |
| `DOGEAR_R2_ACCESS_KEY_ID`, `DOGEAR_R2_SECRET_ACCESS_KEY` | runtime | Secrets; set them in the Render dashboard |

The Auth0 application must list the service URL as an allowed callback, logout URL
and web origin, and Atlas must accept connections from Render's outbound addresses.
`index.html`, `sw.js` and the manifest are served with `no-cache` so a deploy reaches
installed apps; fingerprinted files under `assets/` are cached as immutable. The
service starts only when the frontend build exists.

## Tests

```bash
uv run pytest
```

Tests marked `photos` use real photos of the author's books in `tests/fixtures/private/`, which is not published; they are skipped when the photos are absent and assert counts only.

## License

[Apache-2.0](LICENSE)
