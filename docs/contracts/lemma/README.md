# Lemmatizer rule tables (issue #165)

One language-neutral engine turns an inflected surface into its possible dictionary forms by chained
suffix rewrites, driven by a **rule table** per language. Every language fact lives in the table; a client
(the Go server today, Android #36) implements the engine below once and runs any table. Design:
`docs/superpowers/specs/2026-11-22-ja-lemmatizer-design.md`.

Owner code: `server/internal/lemma` (engine, `tables/<lang>.json` embedded in the binary),
`server/internal/lang` (the `Deinflector` seam: `Ja` runs `ja.json`; a language with a table but no code
pack gets a generic pack with its table), `server/internal/lookup` (probes, word-class check, compounds,
ranking keys), `server/internal/segment` (the boundary rule), `server/internal/lemmapack` (rule-table packs, below). The web app does not run the engine: it reads
`/api/segment` and `/api/lookup` (`reader/` contract).

Fixtures:

- `ja.rules.json` — the Japanese table, byte-identical to `server/internal/lemma/tables/ja.json`.
- `deinflect.json` — Japanese table cases: each `expect` candidate (`form`, `class`, `reasons` in
  application order) must be among `Deinflect(surface)`, no candidate may have a form in `reject`, and
  `none: true` means no candidate at all.
- `budget.json` — the work budget of one Deinflect call, counted unit for unit, and where a smaller budget
  stops it ("Bound").
- `segment.json` — a small lexicon and texts with the tokens the server must produce (boundaries, lemma,
  reason chain, first entry).

Go: `server/internal/lemma/contract_test.go`, `server/internal/lemma/budget_test.go`, `server/internal/segment/contract_lemma_test.go`.

## Table format (`format: 2`)

```jsonc
{ "format": 2,                 // engine format; a new field, match mode or predicate bumps it
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
  "hints": {"expressionPos": ["exp"], "particlePos": ["prt"],   // POS tags the ranking/boundary rules read
            "readingScript": "kana", "readingType": "kana",   // text only in this script is also looked up by reading
            "keepWhole": ["に基づいて", "にもとづいて"]},       // format 2: surfaces the boundary rule keeps whole
  "rules": [{"from": "ました", "to": "ます", "reason": "past", "out": "masu"}] }
```

Unknown keys, an unknown class in `out`/`in`/`compounds`, an unknown `match` or script, an empty predicate,
an empty `from` or `reason`, an empty `keepWhole` entry, `maxDepth` outside 1..8 or a `format` outside 1..2 reject
the whole table. An engine reads every format from 1 up to its own: format 2 added `hints.keepWhole` and the rule
flag `chainOnly`; a format-1 table stays valid, and a format-1 table that uses either is rejected.

## Rules and chaining

A rule `{from, to, reason, in?, out, match?, stem?, chainOnly?}` rewrites a form ending in `from` to
`stem + to`, where `stem` is the form without `from`; the new form has class `out`.

- `match`: `suffix` (default) needs a non-empty stem; `suffix-or-whole` also matches the whole form;
  `whole` matches only the whole form.
- `stem`: a predicate the stem must satisfy (below).
- `chainOnly` (format 2): the rule never applies at depth 0 (to the surface), only to a form an earlier
  rule produced: ないで → ない applies inside 食べないでください but not to the ないで of 高くないです.
- `in`: at depth > 0 a rule applies to a form only when the form's class is in `in`. At depth 0 (the
  surface) every rule applies; a rule without `in` therefore applies only to the surface.
- **Deinflect(surface)**: breadth-first from the surface. Depth d (0-based, d < `maxDepth`) applies every
  rule, in table order, to every form produced at depth d−1, in production order. A candidate (form,
  class) is kept the first time it is produced and never when its form equals the surface. Output order:
  depth, then the order of the form it came from, then rule order. Each candidate carries `reasons`, the
  reasons of its chain in application order (the rule applied to the surface first); the server's
  single `reason` string joins them innermost first (`polite past` for `[past, polite]`).
- **Bound:** one Deinflect call stops as soon as it has produced **64 candidates** (`MaxCandidates`), or when
  it has spent its **work budget of 16,384 units** (`MaxWork`), and returns the candidates produced so far, in
  the output order above. Every format; no table field. A unit is one (form, rule) pair considered (before the
  class and `chainOnly` gating) and one predicate leaf evaluated: a `minRunes` test, a `notOnly` test, one
  `notSuffix` entry. A predicate is evaluated in this order and stops early: `minRunes`, `notOnly`, each
  `notSuffix` entry, the `allOf` children until one is false, the `anyOf` children until one is true. A unit
  that cannot be spent stops the call at once; a predicate cut short produces no candidate. The Japanese table
  produces at most 16 candidates and spends at most 4,352 units on the fixture texts, so neither bound changes
  its output. `budget.json` pins the counting unit for unit (an engine takes the budget as a parameter for it).
- A candidate is a dictionary form only when an entry's sense has a POS tag of its class
  (`classes`); intermediate classes never match.

### Stem predicates

An object; every key present must hold. `minRunes n`: at least n code points. `notOnly <script>`: at
least one code point outside the script (so false for an empty stem). `notSuffix [s...]`: ends in none.
`allOf [p...]`, `anyOf [p...]`: nested predicates. Scripts: `kana` (hiragana, katakana, `ー`), `hiragana`,
`katakana` (with `ー`), `han`, `latin`. The script list is fixed by the engine (formats 1 and 2), not by a table:
a language needing another script (Hangul, Cyrillic) needs an engine change in every client and a format bump.

## Limits

A table over any limit is rejected as a whole, like an unknown key (every format; the built-in tables obey
them too). Lengths count code points.

| Item | Limit |
| --- | --- |
| `language` | a lowercase language code: `^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$` |
| `version`, a rule's `reason` | 64 |
| `rules` | 1,024 |
| `classes` | 64; a class name, a tag or prefix 32; `tags` + `prefixes` of one class 256 |
| `compounds` | 64 |
| a rule's `in` | 64 classes |
| `from`, `to`, a compound `suffix`, a `notSuffix` or `keepWhole` entry | 32 |
| `hints.keepWhole` | 2,048 entries |
| `hints.expressionPos`, `hints.particlePos` | 64 entries each, each 32; `readingType` 32 |
| stem predicate | nesting 4 levels (a predicate alone is level 1); `allOf`, `anyOf` 16 children each; `notSuffix` 256 entries; `minRunes` 0..64 |
| all predicates of a table (rules and compounds) | 4,096 predicates (each nested one counts) and 4,096 `notSuffix` entries in total |

A rule-table pack's `rules.json` is at most 1 MiB ("Rule-table packs" below).

## Compounds

**Lookup bounds.** One lookup window (up to 12 code points, every prefix) is bounded too: the Deinflect calls
of its prefixes share **32,768 units** (each prefix's call gets what is left, at most `MaxWork`; once spent,
the remaining prefixes are looked up exactly only), the compound stem checks of the window share **4,096
predicate units**, a prefix gets at most one compound probe per (stem, class), and the window keeps at most
**256 probes** (later ones are dropped). The Japanese table needs at most 44 probes and 11,696 units per window
on the fixture texts.

For a **deinflected** candidate of a compound's `class` whose form ends in its `suffix` with a non-empty stem
that satisfies the compound's optional `stem` predicate, the stem is looked up too, with the same class
requirement: 勉強しています → 勉強する → 勉強 (JMdict tags `vs` on the noun). The dictionary form itself is not
folded: 勉強する as written is 勉強 + する, two tokens (an exact compound would compete at chain length 0 with
real する-verb entries such as 愛する and 察する). The Japanese stem predicate admits a kanji stem of any length (愛する), a katakana stem of two
(メモする) and a hiragana stem of three or more (ちゃんとする), not すし (す + し) or こうしている (稿 + している).
The match's `lemma` stays 勉強する; `/api/segment` reports `stem: "勉強"` (`reader/` contract).

## Reading lookups

When `hints.readingScript` is set, a prefix written only in that script (engine script list above) is also
looked up by `NormalizeReading(readingType, prefix)` against the plain form of the dictionary's readings of
that type (Japanese: kana text by kana readings, katakana folded to hiragana). Without it a language matches
written forms only. Two rules outside the table stay with the language code (they are about selection and
display, not lemmatization): which letters can start a word (Latin letters never in zh/ja) and that a
Japanese form match shows the matched written form as the headword.

## Ranking keys and the boundary rule

Lookup ranks entries (`server/internal/lookup/rank.go`, keys in order): matched length; **expression
yields**; frequency; primary; **kana fit**; chain length; exact matches; dictionary order; entry score;
headword. The two keys from this item, language-neutral and parameterised by `hints`:

- **Expression yields**: an exact match (empty chain) of an entry without written forms whose every sense
  has a tag in `expressionPos` *yields* when a same-length inflected candidate has an entry with a priority
  > 0 and ≥ its own and no sense tagged `expressionPos` (すれば → する; として stays before とする). Particles
  never yield (にて is not 煮る, たって is not 立つ); an entry that is all `expressionPos` is an expression for
  this rule even when its first sense also carries a `particlePos` tag (には). A
  yielding candidate ranks after **every** same-length candidate that does not yield (also after 掏る, a
  priority-0 conditional of すれば), whatever the later keys say.
- **Kana fit**: a match through a reading is **strong** only when the reading's value equals the matched
  text exactly (same script: アメ does not fit あめ, although both share the plain form あめ) and the entry
  has no written form or is **usually-kana**; every other reading match is **weak**; a match by a written form
  is strong. Strong first (kana しよう → する before 使用; あめ → 雨/飴 before the katakana-only アメ).

**Priority** is the entry's score `pri` (0–100), as the lexicon package carries it (`packages/`): the JMdict
importer maps priority tags by max — nf01…nf24 → 101 − NN, news1/ichi1/spec1/gai1 → 60, nf25…nf48 → 78 − NN,
news2/ichi2/spec2/gai2 → 30, anything else 0 — rare/outdated/irregular/search-only forms lose 40, floored at 0
(`server/internal/dict/jmdict.go`, `priorityScore`). **Usually-kana** (kana fit) is the lexicon's entry flag `uk`: **some** sense of the word carries JMdict
`uk`. This is deliberately not the display-form rule of `frequency/display-form.json` (first sense only):
ranking by the first sense let 海松, 佝僂, 野老 and 奴 beat みる, くる, ところ and め without a frequency pack
(#177 review). Consequence: bare して is 仕手 (`uk` on its second sense, priority 92) without a frequency pack.

Segmentation is greedy longest match. **Boundary rule**: when the match at a position is exact, its first
entry has priority 0 and its senses all carry an `expressionPos` tag, the shortest proper prefix of it that
has a match has a
first entry with a `particlePos` tag, and the match starting right after that prefix either ends strictly after the expression, or ends exactly with
it and has, among its same-length results, an inflected match (non-empty chain) of an entry with priority > 0
that is strong by kana fit (して of する, even where the noun 仕手 ranks first without a frequency pack; not ねない
of 寝る, a word written in kanji, so かねない, さえない, よければ stay) **and the expression's matched surface is not
in `hints.keepWhole`**, the token is the particle
(仕事をしている → 仕事 | を | している; 仕事をして帰った → 仕事 | を | して | 帰った; には and にとって, with priority,
stay; 法律に基づいて判断する keeps に基づいて, but 計画に基づいている is に | 基づいている: a word running past a listed
expression still splits it). `keepWhole` is compared with the surface as written, so a list holds every
spelling that marks the grammar use (に基づいて and にもとづいて) and leaves out literal spellings (と来たら is と +
来たら; ときたら is listed). The rule reads only the lookup's ranked results at that position, which are capped at 30 entries
(`MaxEntries`); a particle ranked below the cap is not seen.

## Japanese table (`ja.rules.json`)

Classes `v1`, `v5`, `vs`, `vk`, `adj-i`, `adj-ix` (dictionary forms), `masu`, `te` (intermediate). `adj-ix`
(いい, かっこいい) inflects only on its よ form (かっこよくない → かっこよい, which JMdict lists as a reading);
the adverbial く needs a stem of two code points or a non-kana one (いく, なく, しく are not adverbials). Kana te-form
auxiliaries fold into the verb (ている/てる, ておく/とく, てしまう/ちゃう/ちまう, てみる, ていく, てくる,
てください, てあげる, てくれる, てもらう; で- variants): the lemma is the main verb, the auxiliary a reason.
`keepWhole` lists the surfaces of reviewed grammar expressions (に基づいて/にもとづいて, を通して/をとおして, によれば,
に応じて, に沿って, をめぐって/を巡って, にすぎない/に過ぎない, と思ったら, ときたら, であれ, でない, …, しかねない; the
spec's "Refinements (#177)" says how it was derived); quotation と言って / と言い, をして, をおいて, にして,
にあたって and にあたり are not listed (荷物をおいてください, サラダにしてください, 頭に当たって split). ないで (te-form of ない, chainOnly),
てはいけない / てはいけません (`prohibition`) and てもいい (`permission`) fold like てください:
食べないでください → 食べる [request, te-form, negative]; 食べなくてもいい → 食べる [permission, te-form, negative].
Godan imperatives are deliberately not deinflected (届け, 構え are nouns far more often).

## Rule-table packs (`lemma-rules`, #176)

A table also ships as a data pack: manifest `type: lemma-rules`, `format: rules-json`, `language` (one), and
`rules.json`, one table of this format whose `language` equals the manifest's, at most 1 MiB. Design:
`docs/superpowers/specs/2026-11-23-lemma-rules-pack-design.md`.

- **Precedence:** for a language, the live installed pack's table, else the built-in table, else none. A pack
  **replaces** the built-in table wholesale (no merging). At most one live pack per language: the server refuses
  a second pack id for a language with a live pack; the same id again replaces it.
- **Validation:** `Parse` as above (strict keys, Limits) at upload review and import; a table for a language whose
  code pack does not run tables (zh) is refused. A stored table that no longer parses (an older engine) is skipped
  and the built-in applies.
- **Effect:** immediate. The server swaps the table set after every install or uninstall (and within 30 s of a
  change another process, `qinqin seed`, made); segmentation and lookups read it per request. `/api/segment`, `/api/segment/at` and `/api/lookup` serve a language with a code pack or
  with a table in effect.
- **Package:** `lemma-rules.<packId>` (`docs/contracts/packages/`), table
  `lemma_rules (language TEXT PRIMARY KEY, rules_json TEXT NOT NULL)`, one row with `rules.json` byte for byte.
  A client parses `rules_json` with its engine (a `format` above its own: keep the bundled copy) and prefers it
  to a bundled copy of the same language.
- **Bundled:** `plugins/data/ja-lemma/rules.json` is byte-identical to `ja.rules.json` and to the embedded table
  (tests check all three); the server installs it when absent and refreshes it from the image when it differs,
  never after an uninstall.
- **Credits:** `GET /api/lemma-packs` (public) lists `{packId, name, version, language, license, attribution,
  notice}` of every live pack by pack id.

## Android notes

Bundle `ja.rules.json` as the fallback and prefer a downloaded `lemma-rules` package of the language ("Rule-table
packs" below); implement the engine, its limits, the candidate bound and the two predicates exactly; check against
`deinflect.json` and `segment.json`.
