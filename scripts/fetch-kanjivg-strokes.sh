#!/usr/bin/env bash
# Build the Japanese stroke-order pack kanjivg-strokes (type strokes) from
# KanjiVG (https://kanjivg.tagaini.net, © Ulrich Apel, CC BY-SA 3.0, accepted
# by the owner on 2026-11-26) with scripts/prepare-kanjivg-strokes.mjs, and add
# KanjiVG's COPYING as LICENSE. The pack is an adaptation of KanjiVG and stays
# under CC BY-SA 3.0; it is built here (and in the Docker `kanjivg` stage),
# never committed and never compiled into the binary or the web build.
#
#   scripts/fetch-kanjivg-strokes.sh [dest]
#
# dest defaults to plugins/data-strokes (a default seed root). The pack is
# built in a staging directory and replaces <dest>/kanjivg-strokes only once
# everything succeeded. Needs git and node.
#
# The checkout is pinned (tag r20260714, commit d95a976, checked after the
# clone), and so is the licence text: plugins/data/UPSTREAM.sha256 holds the
# SHA-256 of KanjiVG's COPYING (the same file kanjivg-components carries). A
# different COPYING, or a README that no longer says CC BY-SA 3.0, stops the
# build until someone re-reads the licence and updates the pin.
set -euo pipefail

tag="r20260714"
commit="d95a97627fd9fe5b2c8d06ca81e38149609c0c1e"

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="${1:-$root/plugins/data-strokes}"
dir="$dest/kanjivg-strokes"
mkdir -p "$dest"
tmp="$(mktemp -d)"
stage="$(mktemp -d "$dest/.kanjivg-strokes.XXXXXX")"
chmod 755 "$stage"
trap 'rm -rf "$tmp" "$stage"' EXIT

git clone -q --depth 1 --branch "$tag" https://github.com/KanjiVG/kanjivg "$tmp/kanjivg"
head="$(git -C "$tmp/kanjivg" rev-parse HEAD)"
if [ "$head" != "$commit" ]; then
  echo "fetch-kanjivg-strokes: tag $tag is at $head, expected $commit; refusing" >&2
  exit 1
fi
pinned="$(awk '$2 == "kanjivg-components/LICENSE" { print $1 }' "$root/plugins/data/UPSTREAM.sha256")"
actual="$(sha256sum "$tmp/kanjivg/COPYING" | cut -d' ' -f1)"
if [ -z "$pinned" ] || [ "$actual" != "$pinned" ]; then
  echo "fetch-kanjivg-strokes: COPYING sha256 $actual does not match the pin '$pinned' in plugins/data/UPSTREAM.sha256; re-read the licence and update the pin" >&2
  exit 1
fi
grep -q "Attribution-Share Alike 3.0" "$tmp/kanjivg/README.md" || {
  echo "fetch-kanjivg-strokes: README.md no longer states CC BY-SA 3.0; check the licence" >&2
  exit 1
}

node "$root/scripts/prepare-kanjivg-strokes.mjs" "$tmp/kanjivg/kanji" "$stage" --version "$tag" --commit "${commit:0:7}"
cp "$tmp/kanjivg/COPYING" "$stage/LICENSE"

rm -rf "$dir.old"
if [ -e "$dir" ]; then
  mv "$dir" "$dir.old"
fi
if ! mv "$stage" "$dir"; then
  [ -e "$dir.old" ] && mv "$dir.old" "$dir"
  exit 1
fi
rm -rf "$dir.old"
echo "kanjivg-strokes written to $dir"
