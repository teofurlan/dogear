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
- The signed-out screen samples four distinct public-catalog covers from twelve selections across Dune, A Song of Ice and Fire, Jules Verne and George Orwell. All four are fixed in place, with no horizontal scrolling: one row on desktop and a readable two-by-two layout on phones. Selection is renewed on returning to sign-in after an authenticated session (or reloading the page), not during ordinary rerenders. These labeled examples never query the book API or become account records, and disappear when signed in. Their images use the same no-referrer cover host and neutral failure treatment as library covers. Both example and account-library portrait slots reserve their dimensions while a centered rectangular catalog mark with a red scan line indicates loading. The full title remains below the cover; the duplicate title inside the slot is removed to avoid overlap. In the library the indicator covers both catalog lookup and image download; a missing match or failed image stops it and leaves the neutral fallback. Reduced-motion users get the same static mark. There is no bottom loading text bar.
- The header shows the complete `dogear.` wordmark; the compact `d.` is reserved for the favicon and icon-sized contexts. The product/accessibility name remains Dogear. The SVG favicon outlines the bundled Barlow Condensed glyphs, so it does not depend on browser font loading.
- Sign-in copy explains the book-and-photo-to-quote purpose while explicitly labeling photo capture as forthcoming. A scoped height-aware layout spreads entry content vertically and enlarges covers/headings in tall desktop windows, while remaining compact in shorter windows without hiding overflow. Authenticated libraries keep their normal scrolling layout. At increased zoom, small phone sizes or with extra error text, content remains scrollable instead of being clipped.

## Add a book

Sign in, choose **Add book**, enter a title and optional author, then **Save book**.
Alternatively drop one photo into the **Cover photo** area or click anywhere in it
(or focus it and activate it with the keyboard) to take/select a JPEG or PNG (up to 6 MiB,
20 megapixels). On narrow layouts (up to 820px) or coarse-pointer devices such as phones/tablets,
the same area instead shows **Take a cover photo** with a camera icon. Wider fine-pointer
layouts retain the drag/drop prompt. This is still the native input with a rear-camera hint:
the device/browser decides whether it opens a camera or photo picker, not an in-app camera.
Local Tesseract OCR suggests title/author from text size and layout;
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

## Web app manifest and icons

The installable PWA foundation provides the static web app manifest (`manifest.webmanifest`), vector branding (`icon.svg`), and standard/maskable PNG icons (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`) using the catalog ground (`#e9e9e5`) and outlined `d.` glyph. The production client registers `/sw.js` only in a secure context with service-worker support; registration failure does not affect startup or Auth0 callback handling.

The manifest specifies `display: standalone`, `start_url: /`, `theme_color: #e9e9e5`, and `background_color: #e9e9e5`. Tokens, API responses, book records, photos and authentication callbacks are strictly excluded from client caching.

## Offline fallback and service worker

The offline contingency document (`web/public/offline.html`) is a self-contained page in the catalog palette (`#e9e9e5`, `#191919`, `#c8302d`) that explains Dogear needs a connection to load the library, authenticate, or save books. It explicitly clarifies that offline book entry and photo quote capture are not implemented.

The service worker manages only `dogear-offline-v2`, containing exactly the public `/offline.html` document. Activation removes superseded Dogear offline caches while preserving unrelated caches. Only same-origin, query-free root GET navigations without an Authorization header are network-first (`no-store`); a network failure falls back to the named offline document. Other requests—including API, callback, assets, photos, and non-GET requests—bypass the worker entirely. Navigation responses are never cached. Registration is production-only, secure-context-only and failure-tolerant.

Reproduce the isolated Chrome smoke after building with `PLAYWRIGHT_MODULE` pointing to an existing Playwright module and `CHROME_PATH` to Chrome:

```powershell
node web/scripts/check-pwa.mjs
```

The smoke uses a random loopback HTTP server, an in-memory isolated browser context, and blocks external requests; it does not sign in or install the app into the operating system.

## Checks and boundaries

```powershell
npm --prefix web test
npm --prefix web run build
```

The tests replace Auth0 hooks and transport calls to check rendering, login/logout actions, cross-account state disposal, pagination, request boundaries and cover fallback. They are deterministic local checks, not proof of a live Auth0/Atlas browser session.

A separate live check completed Auth0 consent, returned to a clean local URL and received `200` from the authenticated book-list endpoint. The actual account had zero books; no demonstration records were inserted. Desktop/mobile screenshots cover the real empty and signed-out states. Public gallery examples are not evidence of a populated live account. Twenty-three frontend tests and a production build pass; independent backend verification reports 107 passes and two existing platform skips.

The interface intentionally has no page-photo upload, reading state, existing-book edit/delete or quote-review controls. When the root page is offline, only the public contingency page is available; offline library use, book entry and quote capture are not implemented. The separate local comparison demos under `.impeccable/previews` use fixtures and never supply data to this app. Self-hosted Public Sans and Barlow Condensed font files include their OFL notices in `public/fonts/`.

## Book view, page capture and morning review

- Opening a book shows its view (`#book=<id>`, synced with browser history, so reload and back work; no router dependency). The library shows a banner when quotes are waiting for review.
- "Photograph a page" uses a native camera-first file input (`accept="image/*"`, `capture="environment"`, multiple). Each photo is re-encoded client-side to JPEG (quality 0.85, long side at most 2400 px) in `downscale.js`, then uploaded one at a time as a raw `image/jpeg` body to `POST /api/books/{id}/pages`. `GET /api/books/{id}/pages` supplies the "waiting for tonight's run" count.
- The morning review lists pending quotes (`GET /api/quotes?book_id=&status=pending`) with their crop (`GET /api/quotes/{id}/crop`, fetched with the bearer token into an object URL that is revoked on unmount), editable text, Keep (`PATCH` text + status `kept`) and Delete (`DELETE`). Kept quotes can be edited or deleted, and a missed passage can be added with `POST /api/books/{id}/quotes`.
- API responses, tokens and photos are never cached: requests use `cache: 'no-store'` and `public/sw.js` is unchanged.
