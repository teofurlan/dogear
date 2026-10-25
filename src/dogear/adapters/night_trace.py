"""Best-effort, content-free tracing at the extraction and night-run CLI boundaries only."""
import os
from contextlib import contextmanager
from functools import partial


def _attempt(call, *args, **kwargs):
    try:
        return call(*args, **kwargs)
    except Exception:
        # Telemetry must not change extraction, print secrets, or mask its errors.
        return None


def _sanitize(event, hint, name):
    """Rebuild the event; stripping known sensitive fields alone is not sufficient."""
    hint.clear()  # Attachments travel outside the event JSON, including inherited ones.
    def fields(value, keys):
        return {key: value[key] for key in keys if key in value}

    span_keys = ("trace_id", "span_id", "parent_span_id", "op", "status", "start_timestamp", "timestamp")
    return {
        **fields(event, ("event_id", "type", "start_timestamp", "timestamp")),
        "transaction": name,
        "contexts": {"trace": fields(event["contexts"]["trace"], span_keys)},
        "spans": [fields(span, span_keys) for span in event.get("spans", [])],
    }


class NightTrace:
    """Own an isolated client and explicit spans; never install global integrations."""

    def __init__(self, name="dogear.extract", op="extract.run"):
        self.name, self.op = name, op
        self.client = self.transaction = None
        self.scope_manager = None

    def __enter__(self):
        dsn = os.environ.get("DOGEAR_SENTRY_DSN")
        if dsn:
            _attempt(self._start, dsn)
        return self

    def _start(self, dsn):
        import sentry_sdk

        self.client = sentry_sdk.Client(
            dsn=dsn, default_integrations=False, auto_enabling_integrations=False,
            auto_session_tracking=False, send_client_reports=False,
            data_collection={"user_info": False, "http_bodies": [],
                             "stack_frame_variables": False, "frame_context_lines": 0},
            enable_logs=False, enable_metrics=False, profiles_sample_rate=0,
            traces_sample_rate=1.0, release="dogear", environment="night-job", server_name="dogear",
            before_send=lambda event, hint: None, before_send_transaction=partial(_sanitize, name=self.name),
            shutdown_timeout=2.0, enable_backpressure_handling=False, spotlight=False,
            trace_lifecycle="static", transport_queue_size=32,
        )
        self.scope_manager = sentry_sdk.isolation_scope()
        scope = self.scope_manager.__enter__()
        scope.set_client(self.client)
        self.transaction = sentry_sdk.start_transaction(name=self.name, op=self.op)

    def status(self, value):
        if self.transaction is not None:
            _attempt(self.transaction.set_status, value)

    @contextmanager
    def stage(self, operation):
        span = None
        if self.transaction is not None:
            span = _attempt(self.transaction.start_child, op=operation)
        try:
            yield
        except BaseException:
            if span is not None:
                _attempt(span.set_status, "internal_error")
            raise
        else:
            if span is not None:
                _attempt(span.set_status, "ok")
        finally:
            if span is not None:
                _attempt(span.finish)

    def __exit__(self, error_type, error, traceback):
        if error_type is not None:
            self.status("internal_error")
        if self.transaction is not None:
            _attempt(self.transaction.finish)
        if self.client is not None:
            _attempt(self.client.close, timeout=2.0)
        if self.scope_manager is not None:
            _attempt(self.scope_manager.__exit__, None, None, None)

    def ocr(self, engine):
        return TracedOcr(self, engine)

    def reader(self, reader):
        return TracedReader(self, reader) if reader is not None else None

    def photos(self, store):
        return TracedPhotos(self, store)


class TracedOcr:
    def __init__(self, trace, engine):
        self.trace, self.engine = trace, engine

    def read_words(self, image):
        with self.trace.stage("ocr.read"):
            return self.engine.read_words(image)


class TracedReader:
    def __init__(self, trace, reader):
        self.trace, self.engine = trace, reader

    def read(self, image):
        with self.trace.stage("model.read"):
            return self.engine.read(image)


class TracedPhotos:
    def __init__(self, trace, store):
        self.trace, self.store = trace, store

    def put(self, key, data):
        return self.store.put(key, data)

    def get(self, key):
        with self.trace.stage("photo.load"):
            return self.store.get(key)

    def delete(self, key):
        return self.store.delete(key)
