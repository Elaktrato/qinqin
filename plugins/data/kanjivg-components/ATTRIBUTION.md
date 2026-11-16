# KanjiVG components

A character component index for the radical and part lookup, derived from
KanjiVG (https://kanjivg.tagaini.net), copyright Ulrich Apel, tag r20260714,
commit d95a97627fd9fe5b2c8d06ca81e38149609c0c1e (https://github.com/KanjiVG/kanjivg), cloned 2026-11-16.

Licence as stated by KanjiVG (checked 2026-11-16): README.md
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
