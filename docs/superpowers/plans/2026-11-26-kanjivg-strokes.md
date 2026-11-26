# Plan: KanjiVG stroke order (#62) and the licence decisions of 2026-11-26

Branch `feature/v080-kanjivg-licence` (from `feature/v0.8.0`). Owner decisions this work implements (answered 2026-11-26):

1. **KanjiVG CC BY-SA 3.0 is accepted** (below the usual CC BY-SA 4.0 floor): `kanjivg-components` stays bundled, and #62 is
   built as its own data pack.
2. **Share-alike position confirmed:** every BY-SA pack (OpenMoji, Mulberry, KanjiVG) stays its own server-served data pack,
   never `go:embed`ded, never in the web build or the APK; the MIT code stays MIT.
3. **The script charts and the Starter word lists are CC BY 4.0**, not CC0 (no exception in `LICENSING.md`).

## Tasks

- [x] 1. Licence: `LICENSING.md` (the CC0 exception removed, the KanjiVG section added), the `license` fields of
  `kana.json`/`hangul.json`/`cyrillic.json` and both Starter sets, their attribution text, `NOTICE` files beside them,
  the Sources feature entry, the i18n credit line, the wiki and the superseded rulings in the earlier specs;
  `check-sources` rule i (licence field, credit, notice) with a test.
- [x] 2. The pack builder, test-first (`scripts/prepare-kanjivg-strokes.test.mjs`): KanjiVG centre lines to Hanzi Writer
  outlines and medians; `scripts/fetch-kanjivg-strokes.sh` (pinned commit and licence text); Dockerfile stage `kanjivg`;
  `FETCHED_PACKS` in `check-sources`.
- [x] 3. Server: `strokes.LookupFor(lang)` and `GET /hanzi/U<HEX>.json?lang=` (test-first; fixture
  `docs/contracts/strokes/lookup.json`, Go test); contract 11.
- [x] 4. Web: language through `strokeUrl`/`fetchStrokeData`, the stroke player, the writing card, the study session and
  the offline preparation; the service worker's cache key keeps a well-formed `lang` (test-first).
- [x] 5. The kana **Write** mode in the trainer (`write.ts`, `ScriptsWritePad.svelte`, queue, labels, overview, events
  contract note), test-first for the pure parts.
- [x] 6. Docs: sources, wiki (Admin data packs, Admin deploying, Development, Data and licences, Scripts trainer,
  API reference, Project layout), contracts (`strokes/`, CHANGELOG, overview, README), ROADMAP, this plan.

## Rulings

- Ruling: the KanjiVG pack is served in the stroke-data format the app already reads (Hanzi Writer: filled outlines and
  medians in a 1024 box, y up, baseline 900), converted at build time — the stroke player, the writing pad and the
  writing card then need no new code and no second renderer — cost if wrong: the pack is an adaptation (a
  CC BY-SA obligation we meet by saying so in the notice and keeping the pack separate), and a second format later
  would mean a renderer for centre-line paths.
- Ruling: outlines are the pen centre line widened by 2.75 KanjiVG units on each side (a pen about 5 % of the box,
  bolder than KanjiVG's own 3-unit stroke, close to Make Me a Hanzi's strokes), with round caps and mitred joins capped at
  1/0.6; medians are a Douglas-Peucker simplification (0.7 unit) of the sampled curve — cost if wrong: one constant
  (`HALF_WIDTH`) and a rebuild; the outline is not a calligraphic shape.
- Ruling: only kana, kanji (unified, extension A/B, compatibility) and the iteration marks go in (6,614 characters); the
  variant drawings (`-Kaisho`, `-Insatsu`, …), Latin and symbols stay out — cost if wrong: a rebuild.
- Ruling: `?lang=` on the existing `/hanzi/` route, not a new route, and the pack with the **fewest** languages among
  those that list the language wins (a Japanese-only pack beats the shared zh+ja pack); with no language the order of
  registration decides as before; a character only one pack has is served whatever the language — the same code point is
  drawn differently in Chinese and Japanese, and Chinese keeps working unchanged — cost if wrong: contract 11; a client
  that never passes `lang` sees no change.
- Ruling: the web passes the language of the entry (entry page, writing card, session) or workspace (offline
  preparation), only when it is two or three lower-case letters (a region code such as `zh-TW` is left out) — cost if
  wrong: Chinese-traditional readers get the shared shapes, which they got before.
- Ruling: the service worker's `/hanzi/` cache keys by path and a well-formed `lang` only; every other query parameter is
  dropped — cost if wrong: a stale answer after a pack change, as before (the cache is cache-first).
- Ruling: the Write mode is offered for hiragana and katakana only, single glyphs only (a digraph such as きゃ is two pads),
  and only when the server has the Japanese stroke data (the overview asks for the first kana once) — Hangul and Cyrillic
  have no stroke data in KanjiVG — cost if wrong: a digraph pad later; project-written Hangul/Cyrillic strokes.
- Ruling: a written answer counts as right with at most one wrong stroke, no stroke hint and no reveal
  (`WRITE_MAX_MISTAKES = 1`) — a beginner's hand slips once; a hint or the reveal is help the answer should not be
  credited for — cost if wrong: one constant. The event is the existing `script` event with the new mode `write`
  (older clients ignore an event with an unknown mode).
- Ruling: a letter the server has no strokes for is skipped uncounted (no event) — a missing pack must not read as a
  wrong answer — cost if wrong: none.
- Ruling: the pack is built from a pinned clone (tag, commit and the SHA-256 of `COPYING` already pinned for
  `kanjivg-components`, plus the README licence line) and is never committed: it is about 7 MB and builds in four seconds —
  cost if wrong: committing the 7 MB pack instead (it is derived data, so it could be).
- Ruling: Docker gets its own stage `kanjivg` and seed root `/opt/qinqin/kanjivg`, after `/opt/qinqin/strokes`, so a
  fresh image installs both and `autoInstallStrokes` (which installs the first strokes pack when none is live) still
  prefers the Hanzi Writer pack — cost if wrong: the image build needs network access to GitHub for the clone
  (`--build-arg WITH_KANJIVG=0` skips it).
- Ruling: contract version 11 (an optional query parameter and a new event mode are things a second client must
  know) — cost if wrong: another branch may also claim 11; renumber at merge.

## Not verified

No browser, no phone: the outlines were checked numerically, not drawn. On the fixture characters (あ, 五, 口, 言, 語)
a unit test shows the polygon encloses its median and stays within the pen width of it; over the whole build (6,614
characters, 79,723 strokes) every file parses, every median has at least two points, every outline point lies inside
the 1024 box (x 26 to 1003, y −114 to 886) and the longest line is 6.4 KB against the 64 KiB cap. Not verified: how
the Write mode feels on touch, whether the 2.75-unit pen looks right in the stroke player, the matcher's tolerance
against KanjiVG medians (they are KanjiVG's own centre lines, so the stroke order and direction are the same as in
the Chinese data, but the matcher was tuned on Make Me a Hanzi medians), the Docker `kanjivg` stage (a full image build
was not run), the first-boot seed time with the extra pack, and the clone in CI.
