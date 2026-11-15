#!/usr/bin/env bash
# Integrity of the committed seed bundle: every .gz/.zip under plugins/data is
# readable (gzip -t / unzip -t) and the upstream files match the committed
# SHA-256 manifest (plugins/data/UPSTREAM.sha256, written by fetch-seeds.sh).
# Fast (about 25 MB of archives), no network. Run from anywhere:
#   scripts/check-archives.sh [data-dir]      # default plugins/data
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
data="${1:-$root/plugins/data}"
fail=0
count=0
while IFS= read -r -d '' f; do
  count=$((count + 1))
  case "$f" in
    *.gz)  gzip -t "$f"  || { echo "CORRUPT gzip: $f" >&2; fail=1; } ;;
    *.zip) unzip -tqq "$f" >/dev/null || { echo "CORRUPT zip: $f" >&2; fail=1; } ;;
  esac
done < <(find "$data" -type f \( -name '*.gz' -o -name '*.zip' \) -print0)
[ "$count" -gt 0 ] || { echo "check-archives: no archives under $data" >&2; exit 1; }
(cd "$data" && sha256sum --check --quiet UPSTREAM.sha256) || fail=1
[ "$fail" = 0 ] || exit 1
echo "check-archives: $count archives readable, checksums match"
