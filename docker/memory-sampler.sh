#!/bin/sh
# Samples the container's memory every MEMORY_SAMPLE_SECONDS and keeps the peaks in $2.
#
#   memory-sampler /sys/fs/cgroup /tmp/memory-peak &
#
# The working set is memory.current minus inactive_file, as Kubernetes and cAdvisor count
# it. cgroup's own memory.peak is not used: it also counts reclaimable page cache, such as
# the model file read from disk, so on Render it simply reports the instance limit.
cgroup=$1
out=$2
interval=${MEMORY_SAMPLE_SECONDS:-1}
ws_peak=0
anon_peak=0
while :; do
    if [ -r "$cgroup/memory.current" ] && [ -r "$cgroup/memory.stat" ]; then
        current=$(cat "$cgroup/memory.current")
        set -- $(awk '$1 == "inactive_file" { i = $2 } $1 == "anon" { a = $2 } END { print i + 0, a + 0 }' "$cgroup/memory.stat")
        ws=$((current - $1))
        [ "$ws" -gt "$ws_peak" ] && ws_peak=$ws
        [ "$2" -gt "$anon_peak" ] && anon_peak=$2
        echo "working_set_peak_bytes=$ws_peak anon_peak_bytes=$anon_peak" >"$out.tmp" && mv "$out.tmp" "$out"
    else
        echo "working_set_peak_bytes=unknown anon_peak_bytes=unknown" >"$out"
    fi
    sleep "$interval"
done
