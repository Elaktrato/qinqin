# Reader display settings and smart reading hiding — design (#78, v0.3.0 item 6b)

Status: Draft (2026-11-15), written unattended; **Ruling: what — why — cost if wrong** marks every
non-obvious call. Nothing is built. Direction item 6b; owner comment on #78: **reader only** (not entry
pages, flashcards or study cards — study answers always show the reading), **settings per workspace**.
Builds on: the mastery definition of the decks view (`cardScore(stability)`, `MASTERY_THRESHOLD` = 80,
`lib/study/mastery.ts`, exported by item 3), workspace settings (`PUT /api/workspaces/{id}` merges
`settings` with `json_patch`, 64 KiB cap; `lib/workspaces.ts` `setSettings`), `POST /api/segment`.

## What exists (checked on `feature/v0.3.0` b925e17)

- Book text is runs `{text, ruby?}`; ruby comes **only from the book** (EPUB `<ruby>`, Aozora).
  Chinese books have none. `ChapterText.svelte` renders `<ruby data-r>…<rt>` when the per-browser
  toggle `prefs.furigana` (localStorage `qinqin.reader.prefs`, with `variant`) is on. `rt` is 0.55em,
  not selectable. The chapter has `lang`; the font is the app's `system-ui` stack.
- `dom.ts` maps DOM points to runs: each run element `[data-r]`, optional pieces `[data-o]` (UTF-16
  start in the run) as direct children, the run's `<rt>` after them.
- `POST /api/segment {lang, text}` (signed in, ≤ 5 000 code points, 256 KiB) → greedy longest matches
  `{surface, start, end, lemma, reason, entries:[{id, kind, reading?}]}` in code points; no readings.
- Mastery is derived client-side from cards (plugin data) and the review log. The reader today loads
  only raw card rows (`getStudyData`, for "Add to study"); smart mode adds the workspace's event log
  (`loadStudyHistory`, shared 8 s cache with the widgets) once per open — loaded only in `smart`.
- `Segment` runs one lookup per code-point position: a 30 000-character chapter is ~30 000 lookups.

## Settings

Workspace settings key `reader` (coexists with `audioAutoplay`, `audioDeviceVoice`,
`hiddenDictionaries`; partial updates merge by RFC 7396):

```json
{ "reader": { "version": 1, "bookRuby": true, "readings": "never", "smartThreshold": 80,
              "rubyScale": 0.55, "font": "default" } }
```

- `bookRuby` — the book's own ruby on/off ("ruby on/off" of the direction). Default: the existing
  local `furigana` pref, else `true`.
- `readings` — dictionary readings over words: `never` | `always` | `smart`. Pinyin for `zh`, furigana
  over words containing kanji for `ja`. Default `never` (today's look).
- `smartThreshold` — integer 10–100, default 80; a word whose memory score is ≥ it counts as known.
- `rubyScale` — one of 0.45, 0.55, 0.65, 0.75 (UI: Small, Medium, Large, Extra large).
- `font` — `default` | `sans` | `serif` | `kai`, mapped per language by `fontStack(font, lang)` to
  system stacks only (e.g. zh serif: `"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", SimSun,
  serif`; ja serif: `"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif`; kai: `"Kaiti SC",
  STKaiti, KaiTi, "AR PL UKai CN", serif`, for ja `kai` falls back to the serif stack).
- Parsing (`lib/plugins/reader/displaySettings.ts`): unknown or invalid fields fall back to defaults
  per field; unknown keys are kept on write (forward compatible).

Ruling: `bookRuby` and `readings` are two settings — book ruby is the author's annotation (names,
rare readings), dictionary readings are generated; a learner may want the first and not the second —
cost if wrong: one merged control later.
Ruling: smart mode also hides **book** ruby over known words — "hide readings I know" should not
depend on where the reading came from — cost if wrong: one condition.
Ruling: no bundled font; system stacks only — CJK fonts are 10–20 MB per weight (offline cache, page
weight), and an OFL font would also need attribution plumbing; `lang` on the chapter already selects
regional glyph forms — cost if wrong: the look varies per device; bundling an OFL font is a later step.
Ruling: settings live in workspace settings, not plugin data — the direction says per workspace, the
route merges partial objects and the Android client already reads workspace settings — cost if wrong:
none.
Ruling: text size, line spacing and bopomofo are not in this item (the direction lists ruby, ruby size,
font and readings) — cost if wrong: three more fields in the same object.

## Readings from the server

`POST /api/segment` accepts `"readings": true`; each match then carries `"reading": {"type","value"}`
— the first reading of `entries[0]` as the lookup ranks it (for a Japanese form match the first reading
of that entry; for a reading match the matched one), **with the caller's overlay applied** (their
`user_edits.readings` replaces the shared list, as `GET /api/entries/{id}` does). One batched query for
the overlays of all matched ids (new `overlay.Readings(ctx, db, userID, ids)`; only the per-entry
`overlay.Apply` exists today). Without the flag the response is byte-identical to today. The new
field is `Match.reading` (an object, or absent); it is unrelated to the existing boolean
`entries[].reading` ("matched by a kana reading").
Ruling: extend the existing route instead of a new "annotate" route — the reader needs exactly the
tokenizer's matches plus one field — cost if wrong: none.

Client side (`lib/plugins/reader/readings.ts`, pure):

- zh: the reading is shown over the whole match, formatted with `formatReading(type, value)`.
- ja: only matches whose surface contains a Han character get furigana, aligned by
  `alignFurigana(surface, lemma, reading)`: split the **lemma** into kanji and kana runs, match the
  reading against the pattern (kanji run = one or more kana, kana run = itself, katakana/hiragana folded),
  take each kanji run's reading and apply it to the identical kanji runs at the start of the surface
  (inflection only changes trailing kana). Any mismatch → `null` → no furigana for that match.
  Ruling: no reading rather than a wrong one — cost if wrong: some inflected words lack furigana.
- A match overlapping a run that has book ruby gets no generated reading (book ruby wins).

## Smart hiding

`masteryIndex(cards, reviews, now, weights) → Map<entryId, score>`: for each **vocab** card, its
`cardScore(stability)` from the schedule replay; per entry the maximum. Computed once per reader open
for the book's workspace (and after "Add to study"), through `loadStudyHistory` (`lib/study/history.ts`),
the loader the decks view and widgets use.

Rule (contract): with `readings = "smart"`, a match is **known** iff
`max(score(e.id) for e in match.entries) ≥ smartThreshold`. A known match shows no generated reading;
a book-ruby run is hidden iff every Han character of its base text lies inside known matches.
Characters outside any match are never known. With `always`, nothing is hidden; with `never`, no
generated readings exist and book ruby follows `bookRuby` alone.
Ruling (revised in the build): only the FIRST candidate entry of the match counts — it is the entry whose
reading is shown, and smart mode must never hide a reading the learner has not mastered; a mastered
homograph further down does not hide it — cost if wrong: a reading stays visible although a homograph is
mastered.
Ruling: only vocab cards count, exactly as the decks view's "mastered" — cost if wrong: one filter.

**Revealing** (all reveal, never re-layout): a hidden reading is rendered as `<rt class="concealed">`
with `visibility: hidden`, so it keeps its space and showing it never moves the text.
- Pointer hover over the word shows it while hovered (CSS).
- Tap/click (a `pointerup` on the container within 6 px of its `pointerdown`) shows it for 4 s. The
  listener is passive and never stops propagation, so the lookup's own container `pointerdown` and
  window `pointerup` handlers (`useLookup.svelte.ts`) run unchanged and the popup still opens.
- Keyboard: the display panel has **Show all readings** (`aria-pressed`, also key `R` when focus is in
  the reader and not in a field), lasting until toggled off or the chapter changes; the keyboard
  selection lookup popup already shows the reading of the selected word.
- Screen readers (revised in the build): concealed readings stay in the accessibility tree (transparent
  colour, not `visibility: hidden`), so no content disappears for assistive technology; the cost is that a
  screen-reader user also hears readings of known words. Forced-colors mode shows them. Words are not made focusable.
Ruling: no tab stop per hidden word — a chapter has thousands; the toggle and the lookup popup are the
keyboard paths — cost if wrong: keyboard users reveal per paragraph via selection only.

## Rendering and performance

- Segmentation runs only when needed: `readings` is `always` or `smart` (book ruby alone needs none).
- Per chapter: paragraphs grouped into requests of ≤ 4 000 code points of displayed text (after the
  `variant` conversion; a longer paragraph is split at sentence punctuation `。！？!?`, else hard
  split); order: the paragraph in view first, then onward, then backward; concurrency 2;
  `AbortController` on chapter or variant change; results kept in an LRU of 6 chapters keyed
  `bookId:chapter:variant`. Paragraphs render plain first and gain readings when their batch arrives.
- Per paragraph, `annotate(runs, matches, masteryIndex, settings)` → pieces `{start, end, rt?, concealed}`
  in paragraph code points. `ChapterText` cuts runs by highlight segments **and** these pieces; a
  generated-ruby piece is `<ruby data-o=k class="gen">base<rt>…</rt></ruby>`; a piece crossed by a
  highlight edge or a run boundary renders without its reading. `dom.ts` learns that a `[data-o]` piece
  may contain an `<rt>` (offsets count only the first text node; points in an `<rt>` set `inRt`).
- `rubyScale` sets `--reader-rt-size`; `font` sets `--reader-font` on `.chapter-text`.
- Cost bound: a 30 000-code-point chapter is 8 requests (~30 000 server lookups); `masteryIndex` is
  one replay per card per open. Ruling: no server cache or extra limiter for now — the requests are
  per user, authenticated, ≤ 2 in flight per tab, and only in always/smart; the real-app check measures
  one 4 000-character chunk and the report states it — cost if wrong: a per-user segment bucket or a
  server-side chapter cache later.

## UI

The reader toolbar's "Furigana" checkbox becomes a **Display** button opening a non-modal panel
(disclosure, `aria-expanded`, Escape closes, focus returns): Book ruby (only when the book has ruby),
Readings (Never / Always / Smart), threshold slider (Smart only; 10–100, step 5, text "Hide readings of
words with a memory score of 80 or more", with a link to Stats → Characters for what the score means),
Ruby size, Font, Show all readings. Changes apply at once and are saved with
`setSettings(workspaceId, {reader: {...}})`, debounced 400 ms; a failed save keeps the local state and
shows the existing notice. The `variant` toggle stays per browser.

## Tests

- Unit: `displaySettings` parse/defaults/keep-unknown; `fontStack`; `alignFurigana` (fixture);
  `masteryIndex` (vocab only, max per entry); `known`/`annotate` (fixture: always/never/smart, book
  ruby wins, Han coverage rule, highlight split); `chunkParagraphs` (limits, punctuation split,
  order from the visible paragraph); LRU and abort.
- jsdom: `ChapterText` with generated and concealed ruby keeps `dom.ts` round trips (selection offsets
  identical with and without readings); tap reveals for 4 s (fake timers); `R` toggles; the Display
  panel writes the right patch and restores focus.
- Go: `segment` with `readings` (zh pinyin, ja kana, overlay of the caller only, omitted without the
  flag, authorization unchanged).

## Contract

`docs/contracts/reader/`: `display-settings.json` (parse cases), `furigana-align.json`,
`smart-readings.json` (cards + reviews + threshold + matches → shown/hidden; it references the decks
view's `cardScore` fixture so both clients use one score). Android: honour the same `reader` settings
object and rule; the segment `readings` flag is the server API to use.

## Execution record (build)

- Known = first candidate only; concealed readings use `color: transparent` (a11y), not `visibility: hidden`.
- A book ruby run is concealed only if every kanji is in known matches AND the known matches' readings
  (kana-folded) spell the run's ruby (明日 with あす stays visible for a learner who knows あした).
- `alignFurigana` returns null for an inflected lemma ending in 来る/來る (き/こ/く change under inflection).
- A highlighted word and a word crossing a run boundary draw no generated reading.
- Without a workspace the book ruby toggle is kept in the browser (legacy `furigana` pref).
