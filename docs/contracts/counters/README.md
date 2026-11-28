# Measure words and counters (#179, three drills)

The rules of the measure-word and counter drills (`drills/README.md`): **measure words** (`measure-words`, Chinese:
一＿书 → 本), **counters** (`counters`, Japanese: 紙 → 枚) and **counter readings** (`counter-readings`, Japanese: 3本 →
さんぼん, the sound changes of number + counter). Plan: `docs/superpowers/plans/2026-11-28-179-counters.md`.

Owner code: `server/internal/counters` (Go). The server derives every answer; a client reads them from the two routes
below, checks a typed answer by `check.json` and never derives a measure word or a reading itself.

| File | Rule | Decoded by |
| --- | --- | --- |
| `items.json` | the three drills' item keys | Go: `server/internal/counters/contract_test.go`; web: `apps/web/src/lib/features/practice/counters/items.test.ts` |
| `measures.json` | Chinese measure words from CC-CEDICT's CL notes, the corrections, the 个 fallback, the pool and the choice rules | Go: `server/internal/counters/contract_test.go`; web: `apps/web/src/lib/features/practice/counters/check.test.ts` (pool, containers) |
| `readings.json` | every counter × number: prompt, kanji form, readings (canonical first), common mistakes; the answer of `GET /api/drills/counters` | Go: `server/internal/counters/readings_test.go`, `server/internal/api/handlers_measurewords_test.go`; web: `check.test.ts`, `CounterDrills.dom.test.ts` |
| `words.json` | the answer of `POST /api/drills/measure-words/words` for a few entries | Go: `server/internal/api/handlers_measurewords_test.go`; web: `check.test.ts`, `nounItems.test.ts`, `CounterDrills.dom.test.ts` |
| `check.json` | how a typed answer is checked | web: `check.test.ts`; Go: `contract_test.go` (its nouns and items exist) |

The data: CC-CEDICT's notes as installed (CC BY-SA 4.0, credited with the dictionary), corrected by
`server/internal/counters/table/measures-zh.json`, and the Japanese counters table
`server/internal/counters/table/counters-ja.json`, both written for the project (CC BY 4.0, `NOTICE`), reviewed by
agents acting as teachers (`REVIEW.md`). No pack type (Ruling in the plan; record 0008).

## Items

| Drill | Item | Example | Modes |
| --- | --- | --- | --- |
| `measure-words` | the noun's entry id | `5678` | `produce` (typed), `choose` (after "Show choices") |
| `counters` | the noun's entry id | `5678` | `produce`, `choose` |
| `counter-readings` | `<counterId>:<number>`: the counter id (the drill-id pattern, ≤ 32 characters), the number 1–99 or `nan` (何) | `hon:3`, `hon:nan`, `nichi:20` | `produce`, `choose` |

An entry id is a positive decimal integer without a leading zero, at most 2^53 − 1. Grades: typed right Good, right
from the choices Hard, the 个 fallback Hard, wrong Again; never Easy.

## Chinese measure words

1. **CL notes.** A gloss `CL:個|个[ge4],位[wei4]`, or a note `(CL:張|张[zhang1])` inside a gloss, lists measure words as
   `traditional|simplified[numbered pinyin]` (or `same[pinyin]`); an item that does not read so is skipped. An entry's
   measure words are those of every sense that is **not minor** (the sense display rule, `senses/`), in order, each
   once (by its simplified form); the pinyin is tone-marked.
2. **Corrections** (`measures-zh.json`, by the entry's simplified form): a noun in `exclude` is not drilled; `measures`
   replaces the list, `add` appends to it (both written as CL notes), `gloss` replaces the shown gloss.
3. **Rules:** when the first measure word is one of `asPeople` (位, 名), 个 is right too (appended); when one of an
   `equivalents` set is right (支, 枝), the others are appended. A noun without measure words is not drilled.
4. **The shown gloss:** a correction's gloss, else the sense display rule's one gloss (`lexicon.DisplayGloss`) over the
   glosses the notes count: in each non-minor sense with a note, the glosses before the note (CC-CEDICT writes it after
   the meanings it counts), nouns before verbs (a gloss reading "to …" after its leading notes); without one, over every
   gloss. CL notes, CC-CEDICT cross-references (a parenthesis with `[…]`) and the notes "(coll.)", "(informal)",
   "(loanword)" are taken out.
5. **The 个 fallback** ("acceptable but not idiomatic", graded Hard): 个 is not among the measure words, the first is in
   `fallbackAfter` (single, countable things: 只, 张, 件, 辆, 把, 位 …; not 条, 根, 匹, 头, 块, containers or pairs) and
   the noun is not in `fallbackNot` (纸, 课, clothing, tickets …).
6. **Readings:** pinyin (tone-marked) and bopomofo; `altPinyin` adds accepted readings after them (场 cháng and chǎng,
   个 toneless, 匹 pī). A client shows the first reading of a type.
7. **Script:** a noun shown in its traditional form (its written form after the learner's patch is a `trad` form that
   differs from the simplified one) gets its measure words in traditional characters (`traditional: true`); the
   simplified forms stay accepted.
8. **Wrong choices** come from `pool` (common measure words, not 个): never a right one, never the fallback, never a
   character of the noun itself, and, when the noun's measure words hold a word of `containers`, never one of
   `containerAvoid` (一瓶茶 is right too).

## Japanese counters and readings

- **Nouns:** a Japanese word entry is a noun of the table when the table noun's written form is one of the entry's
  spellings (not search-only) or kana readings and its reading one of the entry's kana readings; the first such noun
  wins. Its counters are the noun's, canonical first, each right. The shown gloss is the sense display rule's, pinned to
  the noun's reading. Wrong choices: the counters of the table that count a noun.
- **Readings** (`readings.json`, generated by `counters.AllReadings`): number readings いち に さん よん ご ろく なな はち
  きゅう じゅう (11 じゅういち, 12 じゅうに, 14 じゅうよん, 20 にじゅう, 24 にじゅうよん, 何 なん), joined to the counter's
  base reading by its **sound class**:
  - `h` (は-row): 1, 6, 8, 10, 20 geminate (いっ, ろっ, はっ, じゅっ) with the p sound (いっぽん); 3 and 何 voiced (さんぼん);
  - `k` (か-row): 1, 6, 8, 10, 20 geminate (いっこ); `s` and `t`: 1, 8, 10, 20 geminate (いっさつ, ろくさつ);
  - `voiced3`: 3 and 何 voiced (さんがい, さんげん, さんぞく);
  - `plain`, `irregular`: no change; `native` (つ): the table's readings only.

  Then: the table's `readings` replace the rule's for a number (一人 ひとり, 二十日 はつか); a じゅっ/にじゅっ form also
  accepts じっ/にじっ; a geminated 8 also accepts はち + the plain counter (はちほん); a `voiced3` counter also accepts the
  unvoiced 3 and 何 (さんかい); then the table's `also`.
- **Common mistakes** (wrong choices; never an accepted reading): the full number with the plain counter, the voiced
  counter (`voicedMistakes`: `all`, `3` for 3 and 何 only, `none`; `k` defaults to `3`), and for `h` the p sound; before
  a k, s or t counter the geminated number with the plain counter (ろっさつ), before an h counter only with the p sound;
  then the table's `mistakes`, less its `neither`. A client fills up to three wrong choices with other numbers' readings
  of the same counter, never an accepted one.
- **Prompt:** the number in Arabic numerals and the written counter (3本), 何 for `nan` (何本), with the counter's
  `counts` text; the answer shows the kanji form (三本). Romaji comes from the Japanese pack's rule.

## Checking an answer (`check.json`)

- **Normalise:** NFKC, no white space, lower case, no final 。 . 、 , ! ? (and their full-width forms); katakana as
  hiragana for kana comparisons.
- **A noun drill:** a leading number (digits, 〇一二两三…十百千, 几, 何) is ignored (一本, 三枚); nothing left is
  `unread` (not graded). The answer matches a measure word or counter by a spelling (written or a variant), its kana,
  its romaji (compared without separators, macrons as double vowels, m before b/p/m as n), or its pinyin: each typed
  syllable with a tone digit (0 and 5 neutral) or mark, or none for the neutral tone; toneless `ben` is not `ben3`. The
  first measure word is `canonical`, another `accepted`, the noun's fallback `fallback`, else `wrong`.
- **A reading:** kana (katakana as hiragana) or romaji against the answers; text with a kanji, 々 or a digit is `kana`
  (not graded: the IME converted it; the learner is asked for kana); empty is `unread`. The first answer is
  `canonical`, another `accepted`, else `wrong`.

## The routes

- `POST /api/drills/measure-words/words {"ids": [...]}` (1 to 500 entry ids; signed in, no access token): `{words:
  [{id, language, written, readings, gloss, measures: [{written, variants, readings, counter?, counts?}], fallback,
  traditional}], pools: {<language>: [measure...]}}` for the Chinese nouns (word and one-hanzi character entries:
  CC-CEDICT stores 书 as a character) with measure words and the Japanese word entries of the table, in first-occurrence
  order; other entries are absent. The caller's own entry patch applies to the written form and readings.
- `GET /api/drills/counters` (signed in, no access token): `{counters: [...]}`, exactly `readings.json`'s `counters`.

Neither is cached by the service worker.
