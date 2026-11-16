#!/usr/bin/env bash
# Build the bundled ja components pack kanjivg-components from KanjiVG
# (https://kanjivg.tagaini.net, © Ulrich Apel, CC BY-SA 3.0): a component
# index derived from the stroke-order drawings by
# scripts/prepare-kanjivg-components.mjs, with KanjiVG's COPYING as LICENSE
# and an ATTRIBUTION.md. The derived index is shared under CC BY-SA 3.0.
#
# The checkout is pinned: tag r20260714, commit d95a976 (checked after the
# clone). Refreshing the pack is a one-off manual maintainer action, never
# run in CI or by the app. Before it, re-read KanjiVG's README and COPYING
# and confirm the licence is still CC BY-SA 3.0; then pass the date of that
# check:
#
#   KANJIVG_LICENCE_CHECKED=2026-11-16 scripts/fetch-kanjivg-components.sh [dest]
#
# dest defaults to plugins/data. The pack is built in a staging directory
# and replaces <dest>/kanjivg-components only once everything succeeded.
# Needs git and node.
set -euo pipefail

tag="r20260714"
commit="d95a97627fd9fe5b2c8d06ca81e38149609c0c1e"

if [[ ! "${KANJIVG_LICENCE_CHECKED:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  cat >&2 <<'MSG'
fetch-kanjivg-components: set KANJIVG_LICENCE_CHECKED=<YYYY-MM-DD>.
Before rebuilding the pack, re-read KanjiVG's README.md and COPYING
(https://github.com/KanjiVG/kanjivg): KanjiVG must still be licensed
Creative Commons Attribution-Share Alike 3.0. Pass the date of that check.
MSG
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="${1:-$root/plugins/data}"
dir="$dest/kanjivg-components"
mkdir -p "$dest"
tmp="$(mktemp -d)"
stage="$(mktemp -d "$dest/.kanjivg-components.XXXXXX")"
chmod 755 "$stage"
trap 'rm -rf "$tmp" "$stage"' EXIT

git clone -q --depth 1 --branch "$tag" https://github.com/KanjiVG/kanjivg "$tmp/kanjivg"
head="$(git -C "$tmp/kanjivg" rev-parse HEAD)"
if [ "$head" != "$commit" ]; then
  echo "fetch-kanjivg-components: tag $tag is at $head, expected $commit; refusing" >&2
  exit 1
fi
# The licence text is pinned: plugins/data/UPSTREAM.sha256 holds the SHA-256
# of KanjiVG's COPYING as committed (kanjivg-components/LICENSE). A different
# text upstream stops the refresh until someone re-reads it and updates the pin.
pinned="$(awk '$2 == "kanjivg-components/LICENSE" { print $1 }' "$root/plugins/data/UPSTREAM.sha256")"
actual="$(sha256sum "$tmp/kanjivg/COPYING" | cut -d' ' -f1)"
if [ -z "$pinned" ] || [ "$actual" != "$pinned" ]; then
  echo "fetch-kanjivg-components: COPYING sha256 $actual does not match the pin '$pinned' in plugins/data/UPSTREAM.sha256; re-read the licence and update the pin" >&2
  exit 1
fi
grep -q "Attribution-Share Alike 3.0" "$tmp/kanjivg/README.md" || {
  echo "fetch-kanjivg-components: README.md no longer states CC BY-SA 3.0; check the licence" >&2
  exit 1
}

node "$root/scripts/prepare-kanjivg-components.mjs" "$tmp/kanjivg" "$stage" --version "$tag" --commit "${commit:0:7}"
cp "$tmp/kanjivg/COPYING" "$stage/LICENSE"

cat >"$stage/ATTRIBUTION.md" <<MD
# KanjiVG components

A character component index for the radical and part lookup, derived from
KanjiVG (https://kanjivg.tagaini.net), copyright Ulrich Apel, tag $tag,
commit $commit (https://github.com/KanjiVG/kanjivg), cloned $(date -u +%Y-%m-%d).

Licence as stated by KanjiVG (checked $KANJIVG_LICENCE_CHECKED): README.md
"KanjiVG is copyright Ulrich Apel and released under the Creative Commons
Attribution-Share Alike 3.0 licence", the full licence text in COPYING
(this directory's LICENSE) and the header of every SVG file.

What was derived: for each kanji file kanji/<hex>.svg (variant files and
non-ideographs skipped), every nested kvg:element group except the kanji
itself, deduplicated in document order (at most 32) — components.tsv; and
for each part the number of strokes of its own KanjiVG drawing, else the
most common stroke count of its groups — parts.tsv. No drawing or stroke
data is copied. scripts/prepare-kanjivg-components.mjs reproduces the
derivation. This derived index is shared under the same licence,
CC BY-SA 3.0.
MD

rm -rf "$dir.old"
if [ -e "$dir" ]; then
  mv "$dir" "$dir.old"
fi
if ! mv "$stage" "$dir"; then
  [ -e "$dir.old" ] && mv "$dir.old" "$dir"
  exit 1
fi
rm -rf "$dir.old"
echo "kanjivg-components written to $dir"
