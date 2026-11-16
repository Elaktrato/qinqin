# Reader display (issue #78)

Rules every client implements identically. Fixtures: `{"version":1,"rule":"reader/<name>",...}`.
Reader only: entry pages, flashcards and study cards always show readings.

## Settings (`display-settings.json`)

Workspace settings key `reader` (`PUT /api/workspaces/{id}` merges `settings` by RFC 7396; partial
updates are fine):

```json
{ "reader": { "version": 1, "bookRuby": true, "readings": "never", "smartThreshold": 80,
              "rubyScale": 0.55, "font": "default" } }
```

Parsing is per field; an invalid or missing field takes its default: `bookRuby` boolean (default: the
client's old local furigana pref, else true), `readings` `never|always|smart` (default `never`),
`smartThreshold` a number rounded and clamped to 10..100 (default 80), `rubyScale` snapped to the nearest
of 0.45, 0.55, 0.65, 0.75 (default 0.55), `font` `default|sans|serif|kai` (default `default`). A client
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
  when the reading is not kana, the surface or lemma has no kanji, a kanji lies outside the prefix both
  share, or the reading splits in more than one way: no reading rather than a wrong one.
- A match overlapping a book ruby run that is shown gets no generated reading (book ruby wins).

## Smart rule (`smart-readings.json`)

- A word's score is `cardScore(stability)` of its vocab cards (`decks/` rule: `round(100*log2(1+s)/log2(366))`);
  per entry the best card; no reviewed vocab card means no score. Only vocab cards count.
- `smart`: a match is known iff its first candidate entry (the one whose reading is shown) has a score >=
  `smartThreshold`. A mastered homograph further down the candidates never hides a reading.
  A known match keeps its reading in the document but concealed (invisible, not removed).
- A book ruby run is concealed iff it has kanji and every kanji lies inside known matches; characters outside
  every match are never known.
- `never`: no generated readings; book ruby follows `bookRuby`. `always`: nothing is concealed.
  `bookRuby: false` hides book ruby in every mode.
- Piece offsets are code points of the displayed paragraph text.

## Android notes

Read and write the same `reader` object per workspace; use `POST /api/segment` with `readings: true` for the
generated readings; apply the rule above with the same score. Conceal a known reading without removing it
(keep it available to the accessibility layer) and let the user reveal it.
