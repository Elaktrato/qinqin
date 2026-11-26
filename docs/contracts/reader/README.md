# Reader display (issues #78, #68)

Rules every client implements identically. Fixtures: `{"version":1,"rule":"reader/<name>",...}`.
Reader only: entry pages, flashcards and study cards always show readings.

## Settings (`display-settings.json`)

Workspace settings key `reader` (`PUT /api/workspaces/{id}` merges `settings` by RFC 7396; partial
updates are fine):

```json
{ "reader": { "version": 1, "bookRuby": true, "readings": "never", "smartThreshold": 80,
              "rubyScale": 0.55, "font": "default", "highlightWords": false } }
```

Parsing is per field; an invalid or missing field takes its default: `bookRuby` boolean (default: the
client's old local furigana pref, else true), `readings` `never|always|smart` (default `never`),
`smartThreshold` a number rounded and clamped to 10..100 (default 80), `rubyScale` snapped to the nearest
of 0.45, 0.55, 0.65, 0.75 (default 0.55), `font` `default|sans|serif|kai` (default `default`), `highlightWords` boolean (default `false`). A client
writing the object keeps every key it does not know. `default` means the app-wide hanzi font (the `appearance` row's
`hanziFont`, docs/contracts/themes/README.md); `sans`, `serif` and `kai` override it in the reader. Each face is an
installed font pack's (docs/contracts/fonts/README.md, "Choosing a face") or else the platform's system fonts.

## Generated readings

`POST /api/segment {lang, text, readings: true}` (signed in) adds `reading: {type, value}` to each match:
the first candidate's reading (Japanese form match: the entry's first reading; reading match: the matched
one), with the caller's own edited readings applied. Without the flag the response is unchanged. Every match may
carry `stem` (only when the first entry matched the stem of a compound lemma, see `docs/contracts/lemma/`); the
lemma of a Japanese match folds kana te-form auxiliaries (食べてしまった → 食べる) and contractions. `value`
is the display form (`nǐ hǎo`, `たべる`). This `reading` object is unrelated to the boolean
`entries[].reading` ("matched by a kana reading").

- zh: the reading is shown over the whole match (matches containing a Han character).
- ja (`furigana-align.json`): `alignFurigana(surface, stem ?? lemma, reading)` — `stem` is the match's optional
  compound stem (勉強 for 勉強しています, lemma 勉強する; `docs/contracts/lemma/`), so べんきょう sits over 勉強 — splits the lemma into kanji runs
  and kana runs, matches the kana-folded reading against that pattern and applies each kanji run's reading
  to the kanji at the start of the surface (inflection only changes the trailing kana). Katakana is folded
  to hiragana; the long-vowel mark `ー` is literal; `々` and `〆` belong to kanji runs. Null (no furigana)
  when the lemma ends in 来る/來る and the surface is inflected, the reading is not kana, the surface or lemma has no kanji, a kanji lies outside the prefix both
  share, or the reading splits in more than one way: no reading rather than a wrong one.
- A match overlapping a book ruby run that is shown gets no generated reading (book ruby wins).

## Smart rule (`smart-readings.json`)

- A word's score is `cardScore(stability)` of its vocab cards (`decks/` rule: `round(100*log2(1+s)/log2(366))`);
  per entry the best card; no reviewed vocab card means no score. Only vocab cards count.
- `smart`: a match is known iff its first candidate entry (the one whose reading is shown) has a score >=
  `smartThreshold`. A mastered homograph further down the candidates never hides a reading.
  A known match keeps its reading in the document but concealed (invisible, not removed).
- A book ruby run is concealed iff it has kanji, every kanji lies inside known matches and the known matches'
  readings (kana-folded, in order) spell the run's ruby exactly; characters outside
  every match are never known.
- `never`: no generated readings; book ruby follows `bookRuby`. `always`: nothing is concealed.
  `bookRuby: false` hides book ruby in every mode.
- Piece offsets are code points of the displayed paragraph text.

## Word states and the manual mark (`word-states.json`)

`Familiarity = new | learning | known` per entry; a match takes the state of its **first candidate** (the
entry whose reading is shown), never of a homograph further down. The shared predicate lives in
`apps/web/src/lib/study/known.ts` (`frequency/` uses it for starter decks):

1. **known**: the entry has a live manual mark, or its best reviewed live vocab card has
   `cardScore(stability) >= threshold`;
2. **learning**: otherwise, the entry has a live vocab card (reviewed or not);
3. **new**: otherwise.

Only vocab cards enter the scores and the carded set (a writing or reverse card alone leaves a word new).
The reader passes its `smartThreshold` (a word is coloured known exactly when smart mode hides its reading);
every other caller passes 80. The mark wins over every card and threshold. Level lists never make a word
known or learning.

The mark is the keyed row `known:<entryId>` (`keyed/`), workspace-scoped (the book's workspace),
data `{version: 1, entryId, createdAt}`. Valid only when the key is `known:` + a canonical positive decimal
(no sign, no leading zero) equal to `data.entryId` (a JSON integer) and `version` is 1; `createdAt` is
informational; anything else is ignored. Unmarking tombstones the row; marking again revives it under the
same key. The mark creates no card. Backup: `backup/README.md`.

**Declarations (#74).** A mark may carry `batch` (a non-empty string, a ULID), `source` (`range` or
`placement`) and `scope` (a label, at most 120 code points; empty when absent). A mark with a valid `batch` and
`source` belongs to that declaration; anything else is a mark made by hand. A declaration ("I already know
everything up to HSK 3", an accepted placement result) writes marks only for entries without a live mark, so a
mark made by hand keeps its origin, all with the one `batch`. Undo tombstones exactly the live marks that still
carry the batch; marking an entry by hand afterwards replaces the row without the batch, which takes it out of
the declaration. A declared mark is known for the reader, coverage, smart readings, stats and starter decks
exactly like any mark; it is not mastery: no card, no review, no map colour changes. Fixture: `word-states.json`
`batchCases`.

Setting `reader.highlightWords` (boolean, default `false`) draws **new** words with a thin solid underline and
**learning** words with a thin dotted one (no tint: the line style alone carries the state); known words are plain. Inside a user
highlight no state is drawn. The text and its offsets are unchanged.

## Coverage (`coverage.json`)

- **Token**: a match whose surface holds at least one word character: Han, `々`, `〆` (zh); also hiragana
  and katakana, but not the lone `ー` (ja). Punctuation, digits (ASCII or full width), Latin and symbols
  never form tokens; Han numerals do.
- **Type**: the first candidate's entry id (inflected forms share their lemma's entry).
- **Unmatched**: maximal runs of word characters outside every match, counted ("3 passages are not in the
  dictionary") but never in the percentage.
- **Coverage** = `floor(100 * known tokens / tokens)`; `null` without tokens. A book's coverage sums the
  token counts of its chapters (never a mean of chapter percentages).
- **Unknown list**: types not known, by token count descending, then first occurrence (chapter,
  paragraph, start).

Offsets are code points of the displayed paragraph text, as for readings.

## Real-app check (#68, 2026-11-16, API only)

Built server (scratch copy, `cedict` + `hsk-words` + `jmdict` seeded), two users, a zh workspace, a
30 082-code-point text of CC-CEDICT headwords (100 paragraphs, 8 chunks of at most 4 000 code points):
`known:` rows for 3 entries pushed through `POST /api/sync/push`, one tombstoned: the pull shows 2 live
marks; the second user sees none and gets 404 pushing or PUTting into the first user's workspace; the
export lists the 2 live marks in `rows/` and their entries in `refs/entries.json` (the tombstoned
mark is not exported); a restore on the same server brings back exactly the 2 marks. The real matches
gave 12 617 tokens and 5 245 types; tally, coverage and list took 13 ms in vitest. Timings of the
segment route on the shared, loaded build machine are in the plan's execution record.

## Android notes

Read and write the same `reader` object per workspace (with `highlightWords`); use `POST /api/segment` with `readings: true` for the
generated readings; apply the rule above with the same score. Conceal a known reading without removing it
(keep it available to the accessibility layer) and let the user reveal it. Word states and coverage: the
same `known:` row and parse rule, the same predicate with the reader's threshold, the same token rule and
floor, first candidate only.

## Popup snapshot (`popup-written.json`)

A card added from the lookup popup snapshots `written = displayForm(result) || result.term`: the display form
rule of `frequency/display-form.json` over the result's `forms`, `readings` (with `flags`) and `senses`
(`tags`), without a list form — の for 1469800 (not the search-only 乃), こと for the usually-kana 事, and the
entry's display form, not the text's spelling, for a form match (解る in a text snapshots 分かる). The popup's
headword is the server's `term`: the matched written form unless it is search-only, else the display form.
