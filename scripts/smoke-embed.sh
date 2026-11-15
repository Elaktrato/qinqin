#!/usr/bin/env bash
# End-to-end check of the real go:embed: take the built SPA (apps/web/build),
# put it where the Dockerfile does (server/internal/webdist/dist) in a
# throw-away copy of server/, build the real binary, start it on a free
# loopback port and assert through HTTP what the unit tests cannot (they use
# fstest.MapFS): the index, an SPA deep link, a hashed _app/immutable asset,
# stroke data (/hanzi/U597D.json) and the licence text, plus the cache and
# sniffing headers. Also runs scripts/check-archives.sh.
#
#   scripts/smoke-embed.sh [--build-web]
#
# --build-web runs `npm run build` first (the default reuses apps/web/build,
# and builds it when missing). Needs node/npm for that, curl, and either go
# (>= the version in server/go.mod) or docker (golang:1.26 is used as the
# current user). The worktree is not modified.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
pid=""
cleanup() { [ -z "$pid" ] || kill "$pid" 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT
fail=0
ok()  { echo "ok   $*"; }
bad() { echo "FAIL $*" >&2; fail=1; }

"$root/scripts/check-archives.sh"

if [ "${1:-}" = "--build-web" ] || [ ! -f "$root/apps/web/build/index.html" ]; then
  npm --prefix "$root/apps/web" run build >"$work/web-build.log" 2>&1 \
    || { cat "$work/web-build.log" >&2; exit 1; }
fi
web="$root/apps/web/build"

# Stage exactly what the Dockerfile's build stage does.
mkdir -p "$work/src"
cp -r "$root/server/." "$work/src/"
rm -rf "$work/src/internal/webdist/dist"
cp -r "$web" "$work/src/internal/webdist/dist"
if command -v go >/dev/null 2>&1; then
  (cd "$work/src" && CGO_ENABLED=0 go build -trimpath -o "$work/qinqin" ./cmd/qinqin)
else
  # Module and build caches default to throw-away dirs; set GOPATH/GOCACHE to
  # reuse warm ones (they must exist and be writable by you).
  gp="${GOPATH:-$work/gopath}"; gc="${GOCACHE:-$work/gocache}"
  mkdir -p "$gp" "$gc"
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e GOCACHE="$gc" -e GOPATH="$gp" \
    -e GOTOOLCHAIN=auto -e GOFLAGS=-buildvcs=false -e CGO_ENABLED=0 \
    -v "$work:$work" -v "$gp:$gp" -v "$gc:$gc" -w "$work/src" golang:1.26 \
    go build -trimpath -o "$work/qinqin" ./cmd/qinqin
fi

port="${SMOKE_PORT:-$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')}"
"$work/qinqin" serve --addr "127.0.0.1:$port" --data "$work/data" >"$work/server.log" 2>&1 &
pid=$!
base="http://127.0.0.1:$port"
for _ in $(seq 1 50); do curl -fs "$base/healthz" >/dev/null 2>&1 && break; sleep 0.2; done
curl -fs "$base/healthz" >/dev/null || { cat "$work/server.log" >&2; echo "server did not come up" >&2; exit 1; }

# probe <path>: status, content type, cache control, nosniff, body file.
probe() {
  curl -s -o "$work/body" -D "$work/hdr" -w '%{http_code}' "$base$1"
}
hdr() { grep -i "^$1:" "$work/hdr" | head -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//'; }
expect() { # label path status ctype-substring cache body-substring
  local code
  code="$(probe "$2")"
  [ "$code" = "$3" ] || { bad "$1: $2 -> $code, want $3"; return; }
  case "$(hdr content-type)" in *"$4"*) ;; *) bad "$1: $2 content-type '$(hdr content-type)', want *$4*"; return;; esac
  [ "$(hdr cache-control)" = "$5" ] || { bad "$1: $2 cache-control '$(hdr cache-control)', want '$5'"; return; }
  [ "$(hdr x-content-type-options)" = "nosniff" ] || { bad "$1: $2 lacks nosniff"; return; }
  grep -q -- "$6" "$work/body" || { bad "$1: $2 body lacks '$6'"; return; }
  ok "$1: $2"
}

asset="$(cd "$web" && find _app/immutable/entry -name 'start.*.js' | sort | head -1)"
[ -n "$asset" ] || bad "no hashed _app/immutable asset in the build"
expect "index" / 200 text/html no-store "<!doctype html>"
expect "deep link" /entry/5 200 text/html no-store "<!doctype html>"
expect "hashed asset" "/$asset" 200 javascript "public, max-age=31536000, immutable" "import"
expect "stroke data" /hanzi/U597D.json 200 json "" "strokes"
expect "licence text" /ARPHICPL.TXT 200 text/plain "" "Arphic"
expect "missing asset falls back to index" /_app/immutable/nope.js 200 text/html no-store "<!doctype html>"

[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/healthz")" = 200 ] && ok "healthz" || bad "healthz"
code="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$base/healthz/")"
[ "$code" = "308 $base/healthz" ] && ok "healthz/ redirects" || bad "healthz/ -> $code"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/api/does-not-exist")" != "200" ] && ok "unknown api path is not the SPA" || bad "api path served the SPA"

[ "$fail" = 0 ] || { echo "smoke-embed: FAILED" >&2; exit 1; }
echo "smoke-embed: all checks passed"
