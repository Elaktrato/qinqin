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
writing the object keeps every key it does not know. Fonts are the platform's system fonts: no font is
bundled by the server.

## Generated readings

`POST /api/segment {lang, text, readings: true}` (signed in) adds `reading: {type, value}` to each match:
the first candidate's reading (Japanese form match: the entry's first reading; reading match: the matched
one), with the caller's own edited readings applied. Without the flag the response is unchanged. `value`
is the display form (`nǐ hǎo`, `たべる`). This `reading` object is unrelated to the boolean
`entries[].reading` ("matched by a kana reading").

- zh: the reading is shown over the whole match (matches containing a Han character).
- ja (`furigana-align.json`): `alignFurigana(surface, lemma, reading)` splits the lemma into kanji runs
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

The mark is row `known:<entryId>` of plugin `qinqin-flashcards`, workspace-scoped (the book's workspace),
data `{version: 1, entryId, createdAt}`. Valid only when the key is `known:` + a canonical positive decimal
(no sign, no leading zero) equal to `data.entryId` (a JSON integer) and `version` is 1; `createdAt` is
informational; anything else is ignored. Unmarking tombstones the row; marking again revives it under the
same key. The mark creates no card. Backup: `backup/README.md`.

Setting `reader.highlightWords` (boolean, default `false`) draws **new** words with a solid underline and
**learning** words with a dotted one (each with a light tint); known words are plain. Inside a user
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

## Android notes

Read and write the same `reader` object per workspace (with `highlightWords`); use `POST /api/segment` with `readings: true` for the
generated readings; apply the rule above with the same score. Conceal a known reading without removing it
(keep it available to the accessibility layer) and let the user reveal it. Word states and coverage: the
same `known:` row and parse rule, the same predicate with the reader's threshold, the same token rule and
floor, first candidate only.
