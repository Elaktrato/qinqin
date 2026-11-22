# Lemmatizer rule tables (issue #165)

One language-neutral engine turns an inflected surface into its possible dictionary forms by chained
suffix rewrites, driven by a **rule table** per language. Every language fact lives in the table; a client
(the Go server today, Android #36) implements the engine below once and runs any table. Design:
`docs/superpowers/specs/2026-11-22-ja-lemmatizer-design.md`.

Owner code: `server/internal/lemma` (engine, `tables/<lang>.json` embedded in the binary),
`server/internal/lang` (the `Deinflector` seam: `Ja` runs `ja.json`; a language with a table but no code
pack gets a generic pack with its table), `server/internal/lookup` (probes, word-class check, compounds,
ranking keys), `server/internal/segment` (the boundary rule). The web app does not run the engine: it reads
`/api/segment` and `/api/lookup` (`reader/` contract).

Fixtures:

- `ja.rules.json` — the Japanese table, byte-identical to `server/internal/lemma/tables/ja.json`.
- `deinflect.json` — Japanese table cases: each `expect` candidate (`form`, `class`, `reasons` in
  application order) must be among `Deinflect(surface)`, no candidate may have a form in `reject`, and
  `none: true` means no candidate at all.
- `segment.json` — a small lexicon and texts with the tokens the server must produce (boundaries, lemma,
  reason chain, first entry).

Go: `server/internal/lemma/contract_test.go`, `server/internal/segment/contract_lemma_test.go`.

## Table format (`format: 1`)

```jsonc
{ "format": 1,                 // engine format; a new field, match mode or predicate bumps it
  "language": "ja",            // language code; the file is tables/<language>.json
  "version": "2026-11-22",     // table version (informational)
  "maxDepth": 5,               // rules chained on one surface, 1..8
  "classes": {                 // word classes, by name
    "v1": {"tags": ["v1", "v1-s"]},   // matches a sense POS tag exactly
    "v5": {"prefixes": ["v5"]},       // or by prefix (v5r, v5k-s, ...)
    "w":  {"any": true},              // every entry (dictionaries without POS); not with tags/prefixes
    "masu": {}                        // intermediate: no POS ever matches
  },
  "compounds": [{"suffix": "する", "class": "vs", "stem": {"anyOf": [{"minRunes": 2}, {"notOnly": "kana"}]}}],
  "hints": {"expressionPos": ["exp"], "particlePos": ["prt"]},
  "rules": [{"from": "ました", "to": "ます", "reason": "past", "out": "masu"}] }
```

Unknown keys, an unknown class in `out`/`in`/`compounds`, an unknown `match` or script, an empty predicate,
an empty `from` or `reason`, `maxDepth` outside 1..8 or another `format` reject the whole table.

## Rules and chaining

A rule `{from, to, reason, in?, out, match?, stem?}` rewrites a form ending in `from` to
`stem + to`, where `stem` is the form without `from`; the new form has class `out`.

- `match`: `suffix` (default) needs a non-empty stem; `suffix-or-whole` also matches the whole form;
  `whole` matches only the whole form.
- `stem`: a predicate the stem must satisfy (below).
- `in`: at depth > 0 a rule applies to a form only when the form's class is in `in`. At depth 0 (the
  surface) every rule applies; a rule without `in` therefore applies only to the surface.
- **Deinflect(surface)**: breadth-first from the surface. Depth d (0-based, d < `maxDepth`) applies every
  rule, in table order, to every form produced at depth d−1, in production order. A candidate (form,
  class) is kept the first time it is produced and never when its form equals the surface. Output order:
  depth, then the order of the form it came from, then rule order. Each candidate carries `reasons`, the
  reasons of its chain in application order (the rule applied to the surface first); the server's
  single `reason` string joins them innermost first (`polite past` for `[past, polite]`).
- A candidate is a dictionary form only when an entry's sense has a POS tag of its class
  (`classes`); intermediate classes never match.

### Stem predicates

An object; every key present must hold. `minRunes n`: at least n code points. `notOnly <script>`: at
least one code point outside the script (so false for an empty stem). `notSuffix [s...]`: ends in none.
`allOf [p...]`, `anyOf [p...]`: nested predicates. Scripts: `kana` (hiragana, katakana, `ー`), `hiragana`,
`katakana` (with `ー`), `han`, `latin`.

## Compounds

For a candidate of a compound's `class` whose form ends in its `suffix` with a non-empty stem that satisfies
the compound's optional `stem` predicate, the stem is looked up too, with the same class requirement: 勉強しています → 勉強する → 勉強 (JMdict tags `vs` on the
noun). The match's `lemma` stays 勉強する; `/api/segment` reports `stem: "勉強"` (`reader/` contract).

## Ranking keys and the boundary rule

Lookup ranks entries (`server/internal/lookup/rank.go`, keys in order): matched length; **expression
yields**; frequency; primary; **kana fit**; chain length; exact matches; dictionary order; entry score;
headword. The two keys from this item, language-neutral and parameterised by `hints`:

- **Expression yields**: an exact match (empty chain) of an entry without written forms whose every sense
  has a tag in `expressionPos` ranks after the same-length inflected candidates when one of them has an
  entry with a priority > 0 and ≥ its own and no sense tagged `expressionPos` (すれば → する; として stays
  before とする).
- **Kana fit**: a match through a reading, of an entry that has written forms and is not usually-kana, is
  weak; everything else is strong; strong first (kana しよう → する before 使用).

Segmentation is greedy longest match. **Boundary rule**: when the match at a position is exact, its first
entry has priority 0 and its senses all carry an `expressionPos` tag, the shortest proper prefix of it that has a match has a
first entry with a `particlePos` tag, and the match starting right after that prefix ends strictly
after the expression, the token is the particle (仕事をしている → 仕事 | を | している; には and にとって,
with priority, stay). Priority is the entry score the server derives from JMdict's priority tags (`pri`).

## Japanese table (`ja.rules.json`)

Classes `v1`, `v5`, `vs`, `vk`, `adj-i` (dictionary forms), `masu`, `te` (intermediate). Kana te-form
auxiliaries fold into the verb (ている/てる, ておく/とく, てしまう/ちゃう/ちまう, てみる, ていく, てくる,
てください, てあげる, てくれる, てもらう; で- variants): the lemma is the main verb, the auxiliary a reason.
Godan imperatives are deliberately not deinflected (届け, 構え are nouns far more often).

## Android notes

Bundle `ja.rules.json` until a rule-table package type exists (follow-up); implement the engine and the
two predicates exactly; check against `deinflect.json` and `segment.json`.
