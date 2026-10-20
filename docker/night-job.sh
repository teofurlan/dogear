#!/bin/sh
# Starts Ollama, runs dogear-extract on the given photos (CPU only), and reports the
# container's peak memory so the Render instance size can be chosen from evidence.
set -eu

ollama serve >/tmp/ollama.log 2>&1 &
for i in $(seq 1 60); do
    curl -sf http://127.0.0.1:11434/api/tags >/dev/null && break
    sleep 1
done

started=$(date +%s)
status=0
/app/.venv/bin/dogear-extract "$@" --model "${DOGEAR_MODEL}" --cpu-only --threads "${DOGEAR_THREADS:-4}" || status=$?
elapsed=$(( $(date +%s) - started ))

peak=$(cat /sys/fs/cgroup/memory.peak 2>/dev/null || echo unknown)
echo "night-job: exit=${status} seconds=${elapsed} memory_peak_bytes=${peak}" >&2
exit "${status}"
