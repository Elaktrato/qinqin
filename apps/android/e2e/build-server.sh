#!/usr/bin/env bash
# Builds the qinqin binary with the built SPA embedded (as the Dockerfile and scripts/smoke-embed.sh do), for the
# emulator job (#35). Needs apps/web/build (npm run build in apps/web) and go. The worktree is not modified.
#
#   apps/android/e2e/build-server.sh <output-binary>
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
out="$(realpath -m "${1:?usage: build-server.sh <output-binary>}")"
[ -f "$root/apps/web/build/index.html" ] || { echo "apps/web/build is missing: run npm run build in apps/web" >&2; exit 1; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -r "$root/server/." "$work/"
rm -rf "$work/internal/webdist/dist" "$work/data"
cp -r "$root/apps/web/build" "$work/internal/webdist/dist"
(cd "$work" && CGO_ENABLED=0 GOFLAGS=-buildvcs=false go build -trimpath -o "$out" ./cmd/qinqin)
echo "built $out"
