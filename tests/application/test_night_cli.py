import pytest

from dogear.application.night import NightSummary
from dogear.entrypoints import night_cli

ENV = {
    "DOGEAR_MONGODB_URI": "mongodb+srv://db.example.test/",
    "DOGEAR_MONGODB_USERNAME": "user",
    "DOGEAR_MONGODB_PASSWORD": "secret",
    "DOGEAR_MONGODB_DATABASE": "dogear",
    "DOGEAR_R2_ENDPOINT": "https://acct.r2.cloudflarestorage.com",
    "DOGEAR_R2_ACCESS_KEY_ID": "key",
    "DOGEAR_R2_SECRET_ACCESS_KEY": "secret",
    "DOGEAR_R2_BUCKET": "dogear",
}


@pytest.fixture
def configured(monkeypatch):
    for name, value in ENV.items():
        monkeypatch.setenv(name, value)


@pytest.fixture
def recorded(monkeypatch, configured):
    calls = {}

    class Store:
        closed = False

        def __init__(self, config):
            calls["store"] = self

        def close(self):
            self.closed = True

    class Reader:
        def __init__(self, **options):
            calls["reader"] = options

    def run(store, photos, extract, **_):
        calls["extract"] = extract
        return calls.get("summary", NightSummary(2, 2, 0, 3))

    monkeypatch.setattr(night_cli, "MongoCaptures", Store)
    monkeypatch.setattr(night_cli, "R2Photos", lambda config: object())
    monkeypatch.setattr(night_cli, "OllamaReader", Reader)
    monkeypatch.setattr(night_cli, "TesseractOcr", lambda **options: object())
    monkeypatch.setattr(night_cli, "run_night", run)
    return calls


def test_the_run_uses_the_same_model_options_as_dogear_extract(recorded, capsys):
    argv = ["--model", "gemma4:e2b", "--cpu-only", "--threads", "3"]
    assert night_cli.main(argv) == 0
    assert recorded["reader"]["model"] == "gemma4:e2b"
    assert recorded["reader"]["cpu_only"] is True and recorded["reader"]["threads"] == 3
    assert recorded["store"].closed
    assert "dogear-night: pages=2 processed=2 failed=0 quotes=3" in capsys.readouterr().err


def test_a_failed_page_makes_the_run_exit_nonzero_so_render_reports_it(recorded, capsys):
    recorded["summary"] = NightSummary(2, 1, 1, 3)
    assert night_cli.main([]) == 1
    assert "failed=1" in capsys.readouterr().err


def test_no_model_runs_ocr_only(recorded):
    assert night_cli.main(["--no-model"]) == 0
    assert "reader" not in recorded


@pytest.mark.parametrize("missing", sorted(ENV))
def test_missing_storage_configuration_is_a_setup_error(
    configured, monkeypatch, capsys, missing
):
    monkeypatch.delenv(missing)
    assert night_cli.main([]) == 2
    err = capsys.readouterr().err
    assert "dogear-night:" in err and "secret" not in err
