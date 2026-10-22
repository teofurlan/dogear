# Dogear library

The first mobile-first interface: Auth0 sign-in and a cover-led list of the reader's own books. The selected Small-press catalog direction uses compact cover cells, readable bibliographic labels and restrained red on a cool neutral ground.

## Run locally

Requires Node 22.12+ and the existing Python environment. Install frontend packages with `npm ci --prefix web --ignore-scripts`.

1. Copy `web/.env.example` to `web/.env.local` if the latter does not exist. These are public Auth0 identifiers, never a client secret or database password.
2. Start the existing API from the repository root:

   ```powershell
   uv run --no-sync --env-file .env uvicorn dogear.entrypoints.api:create_app --factory --host 127.0.0.1 --port 8000
   ```

3. In another terminal, run `npm --prefix web run dev` and open `http://localhost:5173`.

Vite proxies `/api` to the loopback API. The existing Auth0 application must allow exactly `http://localhost:5173` as callback, logout URL and web origin. Do not substitute `127.0.0.1` in the browser or widen callbacks with a wildcard. No tenant configuration change was needed for this setup.

The dev server is loopback-only and refuses another port when 5173 is occupied. This is not a production deployment configuration. `vite preview` serves only the static build; it is not a production API proxy. A later deployment must route `/api` to the backend at the same origin or explicitly design a constrained alternative.

## Identity and data

- The official Auth0 React SDK handles Authorization Code with PKCE and callback verification. After successful processing, the callback URL is replaced with `/`; arbitrary return destinations are not followed.
- Access tokens are cached in memory, not local/session storage; refresh tokens and `offline_access` are not requested. Only `openid` identity scope is requested.
- The frontend sends a bearer access token only to the same-origin `/api/books` route. Ownership remains a backend decision derived from the verified subject, never a browser-supplied owner.
- Each account gets a fresh library component. Pending book/cover requests are cancelled when that account leaves. No books or account data are stored in persistent browser storage.
- Lists load 24 books at a time; “Load more books” continues from the last returned ID. Empty libraries remain empty: no demo entries are inserted.

## Add a book

Sign in, choose **Add book**, enter a title and optional author, then **Save book**.
Alternatively choose **Cover photo** to take/select a JPEG or PNG (up to 6 MiB,
20 megapixels). Local Tesseract OCR suggests title/author from text size and layout;
it is not a verified catalog identity and may mistake subtitles/publishers for an author.
Review/edit both fields before saving. Unreadable or unavailable OCR never blocks manual entry.

The photo is transient: it goes only to the authenticated local `/api/books/identify`
endpoint, not to Open Library, MongoDB or object storage. Saving uses the existing
owner-scoped API. Displayed covers still follow the representative-cover lookup below.
JPEG/PNG only: export HEIC/AVIF first. Cancel discards suggestions; switching accounts
aborts pending work. A failed save can have an uncertain outcome: refresh the library
before retrying rather than automatically repeating a write.

## Representative covers

Cover search sends only each book's title and optional author to Open Library, not tokens, user IDs or the rest of a book record. The anonymous search queue allows at most one request every 1.1 seconds and bounds each request to four seconds. Cover results are cached only within the mounted account library. Book listing does not wait for covers.

Title and author must match normalized metadata. An authorless book needs a single unambiguous match. Missing, ambiguous or unavailable results use a neutral cover treatment; image failures do not remove the title or author. A representative cover is not a guarantee of the exact edition. Images come directly from `covers.openlibrary.org`, with no referrer.

Sources: [Auth0 React SDK](https://auth0.github.io/auth0-react/), [Open Library API usage](https://openlibrary.org/developers/api), [cover API](https://openlibrary.org/dev/docs/api/covers).

## Checks and boundaries

```powershell
npm --prefix web test
npm --prefix web run build
```

The tests replace Auth0 hooks and transport calls to check rendering, login/logout actions, cross-account state disposal, pagination, request boundaries and cover fallback. They are deterministic local checks, not proof of a live Auth0/Atlas browser session.

A separate live check completed Auth0 consent, returned to a clean local URL and received `200` from the authenticated book-list endpoint. The actual account had zero books; no demonstration records were inserted. Desktop/mobile screenshots cover the real empty and signed-out states. Populated visual examples are mock references, not evidence of a populated live account. Fourteen frontend tests and a production build pass; independent backend verification reports 107 passes and two existing platform skips.

The interface intentionally has no page-photo upload, reading state, existing-book edit/delete, installable/offline caching or quote-review controls. The separate local comparison demos under `.impeccable/previews` use fixtures and never supply data to this app. Self-hosted Public Sans and Barlow Condensed font files include their OFL notices in `public/fonts/`.
