# Writing matcher fixtures

Shared cases of the writing matcher (`../matcher.ts`), run by the web tests and meant for the Kotlin port. The
format of each file is stated in its `format` field.

- `strokes.json` — Chinese stroke data (Hanzi Writer, derived from Make Me a Hanzi, Arphic Public License) and
  hand-model cases; made by `apps/web/scripts/make-writing-fixtures.mjs`.
- `joins.json` — joined strokes on Japanese stroke data (#292): the medians of 18 kana and kanji, which consecutive
  pairs the matcher joins (`links`), and cases; made by `apps/web/scripts/make-join-fixtures.mjs` from a KanjiVG
  checkout. **Licence:** the medians come from [KanjiVG](https://kanjivg.tagaini.net) (tag r20260714, commit
  d95a976), © Ulrich Apel, licensed [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). They were
  changed (each stroke's centre line reduced to a polyline in the stroke-data box, as the `kanjivg-strokes` pack
  does), so this file is an adaptation and is shared under the same licence. It is test data: no app code imports
  it, so it is in neither the web build nor the Android app.
