#!/bin/sh
# Starts Ollama, then runs on CPU only: with no arguments, `dogear-night` extracts quotes
# from every pending page photo in R2/MongoDB; with arguments, `dogear-extract` runs on
# those photo files (smoke tests). Reports the container's peak working set, anon memory
# and OOM kills, so the Render instance size can be chosen from evidence.
set -eu

memory-sampler /sys/fs/cgroup /tmp/memory-peak &
sampler=$!

ollama serve >/tmp/ollama.log 2>&1 &
for i in $(seq 1 60); do
    curl -sf http://127.0.0.1:11434/api/tags >/dev/null && break
    sleep 1
done

started=$(date +%s)
status=0
if [ "$#" -eq 0 ]; then
    /app/.venv/bin/dogear-night --model "${DOGEAR_MODEL}" --cpu-only --threads "${DOGEAR_THREADS:-4}" || status=$?
else
    /app/.venv/bin/dogear-extract "$@" --model "${DOGEAR_MODEL}" --cpu-only --threads "${DOGEAR_THREADS:-4}" || status=$?
fi
elapsed=$(( $(date +%s) - started ))

sleep 1  # one last sample after the run
kill "$sampler" 2>/dev/null || true
memory=$(cat /tmp/memory-peak 2>/dev/null || echo "working_set_peak_bytes=unknown anon_peak_bytes=unknown")
oom_kills=$(awk '$1 == "oom_kill" { print $2 }' /sys/fs/cgroup/memory.events 2>/dev/null || true)
echo "night-job: exit=${status} seconds=${elapsed} ${memory} oom_kills=${oom_kills:-unknown}" >&2
exit "${status}"
