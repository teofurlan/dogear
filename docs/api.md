# Dogear HTTP API

The FastAPI app lives in [`entrypoints/api.py`](../src/dogear/entrypoints/api.py). Locally it
serves these routes at the root (`http://127.0.0.1:8000`); the deployed web image mounts the
same app under `/api`, which is also the path the Vite dev proxy uses.

Interactive documentation is at `/docs` and the OpenAPI schema at `/openapi.json`.

## Health

`GET /health` returns `200` with `{"status":"ok"}`. It only checks that HTTP requests can be
served: it does not check MongoDB, R2, Auth0 or the night job, and needs no credentials. The
app factory does not load OCR or Gemma.

## Authentication

Every route except `/health` and the docs requires `Authorization: Bearer <access-token>`,
an Auth0 **API access token** (not an ID token).

- Validation uses fixed RS256, the configured issuer and audience, and the required claims
  `exp`, `iss`, `aud` and `sub`. The token cannot select another issuer, key URL or algorithm.
- Missing, expired or invalid tokens return `401` with `WWW-Authenticate: Bearer`. Missing
  configuration or unavailable/malformed signing keys fail closed with `503`.
- Public signing keys are fetched from the tenant's HTTPS JWKS endpoint only when needed, with
  a 3-second timeout and a 5-minute cache. Unknown key IDs can refresh the cache after a
  30-second cooldown, so a newly rotated key can be rejected during that cooldown. Key
  retrieval runs in a worker thread.
- Ownership comes from the verified `sub`, never from a request field, and is not exposed in
  responses. A book, page or quote that is not yours answers `404`.

`GET /me` returns only the verified subject, for example `{"sub":"auth0|reader"}`.

## Books

| Route | Request | Result |
|---|---|---|
| `POST /books` | `{"title":"A quiet morning","author":"Ada Reed"}` | `201`, with `id`, `title`, `author` |
| `GET /books` | Optional `limit`, `after`, and `q` query parameters | `200`, an array containing only your books |
| `GET /books/{book_id}` | | `200`, the book payload (including `has_cover_photo`); `404` when nonexistent or owned by another reader |
| `PATCH /books/{book_id}` | `{"title":"...","author":"..."}`, same rules as `POST /books` | `200`, the updated book; leaving `author` out clears it; `404` for an unknown or other-owner book |
| `DELETE /books/{book_id}` | | `204`; also deletes its quotes (with crops), pages and stored photos; `404` for an unknown or other-owner book; `503` when book or photo storage is unavailable |
| `POST /books/identify` | Raw `image/jpeg` or `image/png` cover photo | `200`, `{"title":"...","author":null,"text":"..."}`; creates nothing |
| `PUT /books/{book_id}/cover` | Raw `image/jpeg` or `image/png` cover photo | `200`, the book with `has_cover_photo: true`; `404` for an unknown or other-owner book; `503` when storage is unavailable |
| `GET /books/{book_id}/cover` | | `image/jpeg` with `Cache-Control: private, no-store`; `404` without a stored photo |

- Title is required; author may be omitted or `null`. Strings are trimmed and must contain
  1-300 characters. Extra fields, including any owner or ID, are rejected with `422`.
- Listing defaults to 50 books, with a maximum `limit` of 100, in ascending MongoDB ID order.
  To continue, pass the last returned `id` as `after` (24 hexadecimal characters). An empty
  array ends the traversal. An optional `q` query parameter filters books whose title or author
  matches the query string, case- and accent-insensitively, while preserving `limit` and `after`
  pagination. This is not a snapshot across concurrent inserts.
- Deleting removes the photos first (waiting page photos and the cover photo), then the book,
  its pages and its quotes, so no photo is ever left without a record. If storage fails the
  request answers `503` and the book stays, possibly without some of those photos; deleting
  again finishes the job. It therefore needs R2 configured. A night run that was reading one of
  the book's pages discards what it found once it sees the book is gone.

Book payloads include `has_cover_photo` (`true` once a cover photo is stored). Book creation
never depends on the photo: the web app sends it with `PUT /books/{book_id}/cover` after the book
is saved, and reports it if that upload fails.

### Cover identification

`POST /books/identify` takes the raw image bytes, not multipart or JSON. Local Tesseract OCR
suggests a title and author from text size and layout; it is not catalog verification, and the
web app always lets the reader correct the suggestion before saving. This route does not store
the photo.
It needs Tesseract with Spanish data, but no Ollama or external catalog service.

Image limits, shared with page uploads: 6 MiB, 20 megapixels, 10,000 pixels per side, a
10-second upload deadline, a 15-second OCR deadline and two readers per API process.

Errors: `401` authentication, `408` upload deadline, `413` size, `415` format, `422`
unreadable image, `429` busy readers, `503` unavailable auth or OCR.

### Cover photo

`PUT /books/{book_id}/cover` takes the raw image bytes (6 MiB, 20 megapixels, same limits as page
uploads), re-encodes them as an upright JPEG and stores them in the private R2 bucket. Only the
book's owner can fetch it with `GET /books/{book_id}/cover`, and the web app shows it when Open
Library finds no cover match. Replacing a photo overwrites the previous one.

## Pages and quotes

These routes need the MongoDB variables; only the page upload also needs R2.

| Route | Request | Result |
|---|---|---|
| `POST /books/{book_id}/pages` | Raw `image/jpeg` or `image/png` body, same limits and errors as `/books/identify` | `201` `{"id","book_id","status":"pending","created_at"}`; `503` without R2 |
| `GET /books/{book_id}/pages` | | `200`, your pages of the book, newest first (no photo bytes) |
| `GET /quotes` | Optional `book_id`, `status` (`pending` or `kept`) | `200`, `[{"id","book_id","page_id","text","flags","status","has_crop","created_at"}]`, oldest first |
| `GET /quotes/export` | Optional `book_id`, `format` (`markdown` [default] or `csv`) | `200`, `text/markdown; charset=utf-8` or `text/csv; charset=utf-8` file with `Content-Disposition: attachment`; `404` for unknown or other-owner `book_id`; `422` for invalid format |
| `GET /quotes/{id}/crop` | | `image/jpeg` with `Cache-Control: private, no-store`; `404` when absent |
| `PATCH /quotes/{id}` | `{"text"?, "status"?: "kept"}`, text 1-5000 characters | `200`, the quote |
| `DELETE /quotes/{id}` | | `204` |
| `POST /books/{book_id}/quotes` | `{"text"}` for a passage the run missed | `201`, a `kept` quote without crop or page |

An upload is validated, re-encoded as an upright JPEG without metadata, and stored in a
private Cloudflare R2 bucket under `pages/<sha256 of the subject>/<page id>.jpg`. The browser
never reads that bucket and the API never returns a photo.

## Failure behavior

- Incomplete MongoDB configuration and driver failures return a generic `503` without database
  or credential details. Health, docs and `/me` stay independent of MongoDB.
- A failed write can have an unknown outcome; there is no idempotency key yet, so refresh
  before retrying.
- The synchronous MongoDB client runs in worker-thread handlers. It is created lazily on the
  first authenticated data request, reused within the app and closed at shutdown. Operations
  have a 5-second driver timeout with 3-second server-selection and connection limits; TLS
  verification is never bypassed.

## Tests

HTTP tests keep real JWT verification and replace only the JWKS and MongoDB transports, using
local RSA signatures. They cover per-user isolation, rejected input, pagination, failure
behavior and connection lifecycle. They do not contact Auth0 or prove a live tenant login.
