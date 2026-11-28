# Look-alike characters (#228, the `look-alikes` drill)

The rules of the look-alike drill (`drills/README.md`): sets of characters learners confuse because they look alike
(未/末, 己/已/巳, ソ/ン, シ/ツ), each set a drill item with its own schedule. Plan:
`docs/superpowers/plans/2026-11-28-228-look-alikes.md`.

Owner code: the web app, `apps/web/src/lib/features/practice/lookAlikes/` (`sets.ts`). The sets are bundled in the web
app (`lookAlikes/data/look-alikes-zh.json`, `look-alikes-ja.json`), written for the project and released under CC BY
4.0 (`NOTICE`), reviewed by agents acting as teachers (`REVIEW.md`). The server stores the drill's answers like any
drill's and never reads the sets; it checks them in a test.

| File | Rule | Decoded by |
| --- | --- | --- |
| `sets.json` | set keys (`keys`), the set file format and its first problem (`files`, `fileOf`), which sets a learner practises (`candidates`) | web: `apps/web/src/lib/features/practice/lookAlikes/sets.test.ts`; Go: `server/internal/drills/lookalikes_contract_test.go` (`keys`, and the committed files: keys, bopomofo) |
| `check.json` | the mode of a question (`modes`), the word with a gap (`prompts`), an answer's grade and payload (`answers`) | web: `sets.test.ts` |

## Items

The drill id is `look-alikes`; an item is **one set**, its key the members in the set's order (`未末`, `己已巳`, `ソン`,
`カ力`): **2 to 5 distinct members**, each one code point, a Han character (Unicode script Han) or a kana letter
(U+3041–U+3096, U+30A1–U+30FA; not the prolonged sound mark ー, not the iteration marks). A set key is always a drill item
key. Changing a set's members makes a new item (the old key's answers stay in the log and count nowhere).

## The set files

```json
{ "version": 1, "language": "zh", "license": "CC-BY-4.0",
  "attribution": "qinqin contributors, CC BY 4.0 — https://github.com/Elaktrato/qinqin", "review": "…",
  "characters": {
    "未": { "pinyin": ["wèi"], "bopomofo": ["ㄨㄟˋ"], "meaning": "not yet", "strokes": 5,
           "example": { "word": "未来", "hant": "未來", "pinyin": "wèi lái", "bopomofo": "ㄨㄟˋ ㄌㄞˊ", "meaning": "future" } } },
  "sets": [ { "members": ["未", "末"], "script": "Hans",
              "notes": { "未": "The upper horizontal is the shorter one.", "末": "…" },
              "marks": { "未": [0, 1], "末": [0, 1] } } ] }
```

- `language` is `zh` or `ja`; `license` exactly `CC-BY-4.0`; `attribution` carries `qinqin contributors, CC BY 4.0`.
- `characters`: every member once. A **Chinese** character has `pinyin` and `bopomofo` (non-empty lists of the same
  length, tone-marked pinyin with its bopomofo as the server's converter writes it), `meaning`, `strokes` (1–64) and
  an `example` (`word`, optional `hant` the traditional spelling, `pinyin`, `bopomofo`, `meaning`). A **kanji** has
  `readings` (kana: on in katakana, kun in hiragana, okurigana in parentheses), `meaning`, `strokes` and an `example`
  (`word`, `reading` in kana, `meaning`). A **kana** (Japanese only) has `script` (`hiragana`/`katakana`, its own),
  `romaji` (Latin letters, macrons allowed), `pair` (the same sound in the other script) and an `example` (`word`,
  `romaji`, `meaning`). An example word (and its `hant`) contains the character exactly once. Texts are non-empty,
  trimmed, at most 200 code points.
- `sets`: non-empty. Each has `members` (a valid key), optional `script` (Chinese only: `Hans` or `Hant`; absent, both
  scripts), a `note` per member (exactly the members) and `marks`: per member (a subset of the members) the 0-based
  strokes that make the difference, ascending, distinct, below the character's `strokes`; a kana has none. No two sets
  have the same members in any order.
- Every character is used by a set.

`setsProblem` reports the **first** problem as `{code, path}`, checked in this order: `not-an-object`; `bad-version`,
`bad-language`, `bad-license`, `bad-attribution`, `no-characters`, `no-sets`; then each character in file order
(`characters.<ch>`): `bad-character` (not one Han character or kana letter, or a kana in a Chinese file), `bad-kana`,
`bad-reading`, `bad-meaning`, `bad-strokes`, `bad-example`; then each set (`sets.<i>`): `bad-members`,
`unknown-character`, `duplicate-set`, `bad-script`, `bad-note`, `bad-marks`; then `unused-character`. A client never
uses a file with a problem.

## Candidates

The sets a learner practises, in the order new ones are introduced (`candidates`):

1. only the file of the workspace's primary language (`zh-Hant` reads `zh`);
2. a Chinese set only in the workspace's script: `zh-Hant`, `zh-TW`, `zh-HK`, `zh-MO` read `Hant`, every other Chinese
   workspace `Hans`; an unmarked set in both;
3. Japanese: every set with a kana member, always, first, in file order;
4. then, for each studied written form in the order of its first review, each character in turn, every set with that
   member (file order), each set once.

A **studied written form** is the written snapshot of a workspace card with at least one review (a word or a
character card); a card without a snapshot gives none.

## Questions and answers

- **Mode** (`modes`): `recognise` when the item has an even number of answers (0 first), else `choose`.
- **recognise:** the member asked (chosen at random) is shown large; the learner taps its meaning among every
  member's, in set order. A meaning shows with the readings the romanisation settings show (`settings/README.md`,
  `romanisation`): Chinese pinyin and bopomofo, kanji their kana readings (always), a kana its `pair` and its romaji
  where shown.
- **choose** (`prompts`): the member's example word (its `hant` in a `Hant` workspace where there is one) with every
  occurrence of the member replaced by `＿` (U+FF3F), and the example's meaning; **no reading**. The learner taps the
  member among the set's, in set order.
- **Answer** (`answers`): right (the member asked) is Good (3), any other member Again (1). The event is
  `drill.look-alikes` with the payload `{item, mode, grade, asked, given}` in this member order (`asked`, `given`: the
  characters; `given` equals `asked` when right). A mode outside `recognise`/`choose` or a character outside the set
  is no answer.
- After the answer every member is shown with its readings (romanisation settings), meaning, example word, note and
  its `marks` highlighted on the stroke data (`strokes/`) when the served data has the character's stroke count; the
  font's glyph otherwise.
