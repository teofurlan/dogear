# Dogear

Photograph the pages you highlighted in a paper book. Overnight, a small open-weight model on a CPU extracts exactly the highlighted passages. In the morning you review them, and they go to your book log (and to Notion, if you want).

Built for the [DEV Hacktoberfest Open-Source AI Challenge, Week 3: Slow and Steady](https://dev.to/devteam/join-the-hacktoberfest-open-source-ai-challenge-slow-and-steady-2850-in-prizes-across-21-3iee).

**Status:** work in progress. The extraction pipeline runs from the command line and in a Render cron job. The FastAPI foundation runs locally; authentication, data, the phone PWA and review are still pending.

- [Requirements and feasibility evidence](docs/requirements.md)
- [Build log (DEV post draft)](docs/post-draft.md)

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
R2, Auth0 or the night job. No credentials are needed for this foundation, and no
user-data endpoints exist yet. The API has not been deployed; the existing Docker
image still runs the night job. `--reload` is for local development only.

## Tests

```bash
uv run pytest
```

Tests marked `photos` use real photos of the author's books in `tests/fixtures/private/`, which is not published; they are skipped when the photos are absent and assert counts only.

## License

[Apache-2.0](LICENSE)
