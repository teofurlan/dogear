# Dogear

**Photograph the pages you highlighted in a paper book. Overnight, a small open-weight model on a plain CPU types out exactly the highlighted passages. In the morning you review them.**

[Live app](https://dogear-web.onrender.com) · [Demo video](https://youtu.be/X18GtpoFXyM) · [API reference](docs/api.md)

Built for the [DEV Hacktoberfest Open-Source AI Challenge, Week 3: Slow and Steady](https://dev.to/challenges/hacktoberfest-week3-2026-10-19).

## What it does

Reading on paper with a highlighter is great; copying the highlights out afterwards is not. Dogear moves that chore to a night job and keeps you in charge of the result:

1. **Add a book** by typing it or photographing its cover. OCR suggests the title and author; nothing is saved until you confirm. A cover photo is kept as the fallback cover when Open Library has no match.
2. **Photograph each page you highlighted** while the book is still open. The photo goes to a private bucket.
3. **Overnight**, a cron job reads every pending page with Tesseract and Gemma 4 on a CPU, stores each highlighted passage as a quote with a small crop of the page, and deletes the photo.
4. **In the morning**, review each quote next to its crop: keep, edit or delete it, or add a passage the run missed. Quotes where the two readers disagreed are flagged.

The [live app](https://dogear-web.onrender.com) is open: anyone can sign in and start their own library. Page photos are read by the next nightly run (06:00 UTC) and deleted afterwards.

## How extraction works

**The model reads; the code decides.** Given a whole page, Gemma missed passages and once returned an unhighlighted chapter title, so it never decides what is highlighted.

1. **Color decides what is highlighted.** A phone photo barely shows a highlighter, so the code works in the Lab color space and measures how far each pixel drifts from the paper's own tint, whatever the pen color. The tint is fitted as a smooth surface across the page, so uneven light doesn't fool it. The page is the largest paper region with its holes filled, so a thumb or the table never counts.
2. **OCR decides where each word is.** Tesseract returns a box for every word. A word belongs to a quote when at least 25% of the paper under its box is highlighted. Short gaps are merged, and words split by an end-of-line hyphen are joined.
3. **Two readers, compared.** Gemma 4 (`e4b`, through Ollama) transcribes each passage from a crop shaped like a text selection. Its text is kept, and words it dropped or added compared with OCR flag the quote for review.

On the author's test pages this found every highlighted passage with no false quotes, and the quotes it could not confirm were flagged rather than presented as confident. A page takes about a minute and a half on four CPU cores.

Code: [`imaging/highlight.py`](src/dogear/imaging/highlight.py), [`domain/passages.py`](src/dogear/domain/passages.py), [`domain/agreement.py`](src/dogear/domain/agreement.py), [`application/extract.py`](src/dogear/application/extract.py).

## Architecture

| Part | Runs on | Does |
|---|---|---|
| Web app ([`web/`](web/README.md)) | React + Vite PWA | Library, cover and page capture, morning review |
| API ([`entrypoints/api.py`](src/dogear/entrypoints/api.py)) | FastAPI, Render web service | Auth0 token validation, owner-scoped books, pages and quotes |
| Night job ([`entrypoints/night_cli.py`](src/dogear/entrypoints/night_cli.py)) | Render cron job, CPU only | Claims pending pages, extracts quotes, deletes photos |
| Storage | MongoDB Atlas, Cloudflare R2 | Books, pages, quotes and crops; page photos until processed |

The Python package follows a ports-and-adapters layout: [`domain/`](src/dogear/domain) and [`imaging/`](src/dogear/imaging) hold the rules, [`application/`](src/dogear/application) the use cases, [`ports/`](src/dogear/ports) the interfaces, [`adapters/`](src/dogear/adapters) Tesseract, Ollama, MongoDB, R2 and Auth0, and [`entrypoints/`](src/dogear/entrypoints) the API and CLIs. Swapping Gemma for another open model means writing one reader adapter.

## Run it locally

Requirements:

- Python 3.13 with [uv](https://docs.astral.sh/uv/)
- [Tesseract](https://github.com/tesseract-ocr/tesseract) 5 with Spanish data. On Windows the installer ships only English; put `spa.traineddata` from [tessdata_best](https://github.com/tesseract-ocr/tessdata_best) in `models/tessdata/`.
- Optional: [Ollama](https://ollama.com) with `gemma4:e4b`, for the second reader
- For the web app: Node 22.12+

```bash
uv sync --locked
```

### Extract quotes from a photo

No accounts or cloud services needed:

```bash
uv run dogear-extract page.jpg --no-model              # OCR only
uv run dogear-extract page.jpg --cpu-only --threads 4  # with Gemma on CPU
```

### Run the API and web app

Copy `.env.example` to `.env` (don't overwrite an existing one) and fill in the Auth0, MongoDB and R2 values described in [Configuration](#configuration). Then:

```bash
uv run --env-file .env uvicorn dogear.entrypoints.api:create_app --factory --reload --host 127.0.0.1
```

`GET http://127.0.0.1:8000/health` should answer `{"status":"ok"}`, and interactive docs are at [127.0.0.1:8000/docs](http://127.0.0.1:8000/docs). The API starts without credentials; protected routes then fail closed with `503`, and page uploads need R2.

For the web app, copy `web/.env.example` to `web/.env.local`, then:

```bash
npm ci --prefix web --ignore-scripts
npm --prefix web run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to the local API. See [web/README.md](web/README.md) for the Auth0 callback setup and frontend details.

### Run the night job

```bash
uv run --env-file .env dogear-night --cpu-only --threads 4   # add --no-model for OCR only
```

It claims pending pages one at a time. A page stuck in `processing` for over two hours counts as pending, and a `failed` page is retried on later nights up to three attempts. Each page's passages become `pending` quotes with a JPEG crop of at most 800 px wide. **A processed page's photo is deleted from R2**; a failed page keeps its photo and records the error. The run logs one line, for example `dogear-night: pages=5 processed=5 failed=0 quotes=12 seconds=480.2`.

## Configuration

All variables go in the ignored `.env` locally, or in the Render dashboard when deployed. Never commit them or paste tokens and passwords into logs.

| Variable | Needed by | Purpose |
|---|---|---|
| `DOGEAR_AUTH0_DOMAIN` | API | Tenant hostname, no scheme or path |
| `DOGEAR_AUTH0_AUDIENCE` | API | The API's exact identifier |
| `DOGEAR_MONGODB_URI` | API, night job | `mongodb+srv://` URI without credentials |
| `DOGEAR_MONGODB_USERNAME`, `DOGEAR_MONGODB_PASSWORD` | API, night job | Database user; don't URI-encode the password |
| `DOGEAR_MONGODB_DATABASE` | API, night job | Application database (Atlas users authenticate against `admin`) |
| `DOGEAR_R2_ENDPOINT` | API, night job | `https://<account id>.r2.cloudflarestorage.com` |
| `DOGEAR_R2_ACCESS_KEY_ID`, `DOGEAR_R2_SECRET_ACCESS_KEY` | API, night job | An R2 token limited to Object Read & Write on the bucket |
| `DOGEAR_R2_BUCKET` | API, night job | The private page-photo bucket |
| `DOGEAR_TESSERACT_CMD` | OCR | Tesseract binary; defaults to `tesseract` on PATH, or the Windows installer path |
| `DOGEAR_TESSDATA` | OCR | Language data; defaults to `./models/tessdata` when it has `spa.traineddata` |
| `DOGEAR_OLLAMA_URL` | Night job, extract CLI | Ollama server, default `http://localhost:11434` |
| `DOGEAR_SENTRY_DSN` | Extract CLI (optional) | Enables content-free Sentry tracing; needs the `observability` extra, see [docs/observability.md](docs/observability.md) |
| `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE` | Web build | Public Auth0 identifiers embedded in the bundle |

Auth0 values are public identifiers: no client secret or signing key is needed. In Atlas, grant the database user only `readWrite` on the application database and allow only the hosts that run the API and the night job.

## Deploy on Render

Two images, two services:

- **Web service, [`Dockerfile.web`](Dockerfile.web).** FastAPI serves the built PWA and mounts the API under `/api`, so the browser only talks to its own origin. It includes Tesseract for cover photos but not Ollama or Gemma. Set the `VITE_*` variables at build time and the `DOGEAR_AUTH0_*`, `DOGEAR_MONGODB_*` and `DOGEAR_R2_*` variables at runtime. The Auth0 application must list the service URL as an allowed callback, logout URL and web origin. `index.html`, `sw.js` and the manifest are served with `no-cache` so a deploy reaches installed apps; fingerprinted files under `assets/` are cached as immutable.
- **Cron job, [`Dockerfile`](Dockerfile).** Tesseract, Ollama and the Gemma weights baked into the image, so a run downloads nothing. With no Docker Command it runs `night-job`, which starts Ollama and then `dogear-night --model "$DOGEAR_MODEL" --cpu-only --threads 4`. It needs the `DOGEAR_MONGODB_*` and `DOGEAR_R2_*` variables. Gemma peaks near 7.4 GiB, so use a 16 GB instance; on Render that costs a few cents per night.

`night-job /app/sample/page.jpg` runs `dogear-extract` on a bundled public-domain sample page and prints JSON, with no storage involved, which is handy for smoke-testing the image.

## Privacy

- Page photos are read by the night job's own model, not sent to a third-party AI API, and are deleted once processed. Only the small passage crops remain.
- A cover photo is used for OCR and, when you add the book from it, stored privately as a fallback cover (only you can fetch it). Covers shown in the library come from [Open Library](https://openlibrary.org), queried with title and author only, when it has a match.
- Every book, page and quote is scoped to the verified Auth0 subject. The service worker caches only a public offline page, never tokens, API responses or photos.

## Tests

```bash
uv run pytest
npm --prefix web test
```

Tests marked `photos` use real photos of the author's books in `tests/fixtures/private/`, which is not published; they are skipped when the photos are absent and assert counts only. Tests marked `tesseract` need the Tesseract binary with Spanish data.

## Status and roadmap

The full loop works end to end: library, cover and page capture, night run and morning review. Next:

- Search by meaning across your quotes
- Export to Notion
- Deleting a book together with its quotes
- A dedicated in-app camera

The original scope and feasibility evidence are in [docs/requirements.md](docs/requirements.md).

## License

[Apache-2.0](LICENSE)
