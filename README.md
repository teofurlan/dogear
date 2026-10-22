# Dogear

Photograph the pages you highlighted in a paper book. Overnight, a small open-weight model on a CPU extracts exactly the highlighted passages. In the morning you review them, and they go to your book log (and to Notion, if you want).

Built for the [DEV Hacktoberfest Open-Source AI Challenge, Week 3: Slow and Steady](https://dev.to/devteam/join-the-hacktoberfest-open-source-ai-challenge-slow-and-steady-2850-in-prizes-across-21-3iee).

**Status:** work in progress. The extraction pipeline runs locally from the command line; the app (API, phone PWA, review) is next.

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

## Tests

### Optional night-run tracing

Install `uv sync --locked --extra observability` and explicitly provide
`DOGEAR_SENTRY_DSN` in the process environment to enable Sentry tracing for
`dogear-extract`. The night-job image installs this extra; the default local
installation does not. The CLI does not load `.env` automatically: use
`uv run --env-file .env --extra observability dogear-extract page.jpg --no-model`
only after configuring an authorized Sentry project. Empty/unset DSN disables it.

Each CLI run emits one `dogear.extract` transaction with timed `photo.load`,
`photo.extract`, `ocr.read`, and (unless `--no-model`) `model.read` spans.
These are boundary timings, not every internal image-processing step. Model
unavailability marks its span failed while preserving the successful OCR fallback.
Unreadable photos retain exit 2; extraction exceptions still propagate.

Only operation names, generated trace IDs, timestamps and status are retained.
No photos/attachments, paths, quote text, account data, exception messages,
stack frames or hostnames are exported. Automatic integrations, logs, metrics and
profiling are disabled; inherited event fields and attachments are discarded.
The isolated client does not install a global client. Missing SDK, invalid
configuration and telemetry failures never change extraction output/status;
shutdown waits at most two seconds for its bounded send queue.
Delivery is best effort, so a missing trace does not prove a successful run.
See the [Sentry Python SDK](https://github.com/getsentry/sentry-python) for SDK details.

Run the offline tracing/privacy/failure checks with
`uv run --locked --extra observability pytest tests/application/test_night_observability.py`.
They use synthetic inputs and an in-memory transport, never the configured project.
This source change alone does not prove a deployed container or live Sentry delivery.

### Full suite

```bash
uv run pytest
```

Tests marked `photos` use real photos of the author's books in `tests/fixtures/private/`, which is not published; they are skipped when the photos are absent and assert counts only.

## License

[Apache-2.0](LICENSE)
