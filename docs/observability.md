# Night-run tracing

Optional, content-free Sentry tracing for `dogear-extract`. It is not wired into
`dogear-night` yet, so the scheduled Render cron run emits no traces; only
`night-job <photo>` smoke runs (which call `dogear-extract`) do.

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
