import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest

SAMPLER = Path(__file__).parents[2] / "docker" / "memory-sampler.sh"
SH = shutil.which("sh")

pytestmark = pytest.mark.skipif(SH is None, reason="needs a POSIX sh")


def write_cgroup(cgroup: Path, current: int, inactive_file: int, anon: int) -> None:
    (cgroup / "memory.current").write_text(f"{current}\n")
    (cgroup / "memory.stat").write_text(
        f"anon {anon}\nfile {current - anon}\nactive_file 0\ninactive_file {inactive_file}\n"
    )


def wait_for(path: Path, text: str, timeout: float = 5.0) -> str:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        content = path.read_text() if path.exists() else ""
        if text in content:
            return content
        time.sleep(0.05)
    raise AssertionError(f"{text!r} never appeared in {path}: {content!r}")


def test_keeps_the_peak_working_set_and_anon_memory(tmp_path):
    cgroup, out = tmp_path / "cgroup", tmp_path / "peak"
    cgroup.mkdir()
    write_cgroup(cgroup, current=1000, inactive_file=300, anon=500)
    sampler = subprocess.Popen(
        [SH, str(SAMPLER), str(cgroup), str(out)], env={**os.environ, "MEMORY_SAMPLE_SECONDS": "0.05"}
    )
    try:
        wait_for(out, "working_set_peak_bytes=700 ")
        write_cgroup(cgroup, current=5000, inactive_file=1000, anon=3000)
        wait_for(out, "working_set_peak_bytes=4000 ")
        write_cgroup(cgroup, current=2000, inactive_file=1500, anon=100)
        time.sleep(0.3)
    finally:
        sampler.terminate()
        sampler.wait(timeout=5)

    assert out.read_text().strip() == "working_set_peak_bytes=4000 anon_peak_bytes=3000"


def test_reports_unknown_without_a_cgroup(tmp_path):
    out = tmp_path / "peak"
    sampler = subprocess.Popen(
        [SH, str(SAMPLER), str(tmp_path / "missing"), str(out)],
        env={**os.environ, "MEMORY_SAMPLE_SECONDS": "0.05"},
    )
    try:
        wait_for(out, "unknown")
    finally:
        sampler.terminate()
        sampler.wait(timeout=5)

    assert out.read_text().strip() == "working_set_peak_bytes=unknown anon_peak_bytes=unknown"
