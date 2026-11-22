# Lemmatizer: data-driven rule tables, Japanese first — design (issue #165)

Status: Draft (2026-11-22), written unattended; every non-obvious call is a
**Ruling: what — why — cost if wrong**. Owner direction (2026-11-22, after the issue): the lemmatizer must
make the app *more language-agnostic* — one engine driven by a per-language rule table, Japanese the first
table, a shared contract so the Android client (#36) runs the same tables.

## Problem (measured on a JMdict-only server, 2026-11-22)

`lang.Ja.Deinflect` is Go code (`server/internal/lang/ja_deinflect.go`, `ja_pos.go`); `/api/segment` and
`/api/lookup` use it through `pack.(lang.Deinflector)`. It handles plain chains (している, 勉強しています,
させられた) but: しました → しまする (揣摩 + した, a rare noun read しま); 仕事をしている → をして (an
expression) + いる; しちゃった → しち + た; してしまった, しておく → two tokens; すれば, しよう, しながら →
expression or homophone entries; 食べちゃった → 食 + べち + た; 書いとく unmatched; 寒くなってきた → 寒 + く +
なって + きた. A する compound (勉強しています, lemma 勉強する, reading べんきょう) gets **no furigana**: the
alignment pattern 勉強+する cannot match べんきょう.

## Design overview

1. **Engine** `server/internal/lemma`: decodes and validates a rule table (JSON), deinflects a surface by
   chained suffix rewrites with word-class gating, matches word classes against dictionary POS tags, and
   exposes the table's ranking hints. It knows no language.
2. **Tables** are JSON files embedded in the binary (`server/internal/lemma/tables/<lang>.json`); `ja.json`
   is today's Go table ported rule for rule, then extended. A table-only language (no Go pack) gets
   deinflection from its table alone.
3. **Seam** `lang.Deinflector` grows `ClassMatches` and `Hints`; lookup and segment ask the pack, never
   branch on a language for lemmatization.
4. **Ranking and segmentation** gain two language-neutral keys and one boundary rule, parameterised by
   the table's hints.
5. **Contract** `docs/contracts/lemma/`: schema and semantics, a copy of `ja.json`, deinflection fixtures and
   segmentation fixtures with a small lexicon, decoded by Go.

## Rule table format (`docs/contracts/lemma/README.md` is normative)

```jsonc
{ "format": 1, "language": "ja", "version": "2026-11-22", "maxDepth": 5,
  "classes": { "v1": {"tags": ["v1","v1-s"]}, "v5": {"prefixes": ["v5"]}, "masu": {}, "te": {} },
  "compounds": [ {"suffix": "する", "class": "vs"} ],
  "hints": { "expressionPos": ["exp"], "particlePos": ["prt"] },
  "rules": [ {"from": "ました", "to": "ます", "reason": "past", "out": "masu"},
             {"from": "した", "to": "する", "reason": "past", "out": "vs", "match": "suffix-or-whole"},
             {"from": "ろ", "to": "る", "reason": "imperative", "out": "v1",
              "stem": {"anyOf": [{"minRunes": 2}, {"notOnly": "kana"}]}} ] }
```

- **Rule**: `from` suffix → `to`, `reason` label, `out` class of the produced form, `in` classes the
  rewritten form must have when it is itself a rule's product (absent = the rule applies only to the
  surface). `match`: `suffix` (default; a non-empty stem must remain), `suffix-or-whole`, `whole`.
  `stem`: an optional predicate on the text before the suffix.
- **Classes**: each class lists POS `tags` (exact) and/or `prefixes`; a class with neither (masu, te) is
  an intermediate form no POS matches.
- **Chaining**: breadth-first, at most `maxDepth` rules; depth 0 is the surface (every rule may apply), at
  depth > 0 only rules whose `in` holds the node's class. A (form, class) pair is produced once, never the
  surface itself; output order is depth, then node order, then rule order.
- **Stem predicates** (declarative): `minRunes n`, `notOnly <script>` (the stem has a character outside the
  script), `notSuffix [..]`, `nonEmpty`, combined with `allOf` / `anyOf`. Scripts: `kana` (hiragana,
  katakana, ー), `hiragana`, `katakana`, `han`.
- **Compounds**: a deinflected form of `class` ending in `suffix` is also looked up by its stem; the stem's
  entry must have that class (JMdict tags `vs` on 勉強, not on 勉強する).
- **Hints**: POS tags the ranking and segmentation rules below read.

Ruling: tables are **embedded in the binary**; a `lemma-rules` data-pack type (format `rules-json`, served as a
package for Android) is a follow-up, not this item — the engine already loads any table from bytes, so the
pack type is an importer, a package type and a catalogue row; doing it now doubles the item and touches the
packages contract owned by v0.4.0 prep — cost if wrong: a new language needs a server release to get rules
(the table is still data: no Go code).

Ruling: all of today's stem guards are **declarative predicates**, no named Go predicates — `longKanaStem` is
`anyOf(minRunes 2, notOnly kana)`, `yoStem` is `allOf(notOnly kana, notSuffix [て, で])`; a named-predicate
registry would make a table unportable to Android without code — cost if wrong: a future language needs a
new primitive in both engines (the format version says which primitives exist).

Ruling: the table is **flat** (godan rows written out, 225 rules) — templates would need an expansion step
in every engine; the contract copy is the generated file — cost if wrong: editing godan rows is verbose.

Ruling: the contract copy `docs/contracts/lemma/ja.rules.json` must be **byte-identical** to the embedded table
(a Go test) — one source, no drift — cost if wrong: none beyond a test to update.

Ruling: the port is **behaviour-identical first**: a parity test compares the table engine with the old Go
rules on every prefix of the bundled grammar-pack example sentences (27 522 code points) and all existing
test surfaces before the Go rules are deleted.

## New Japanese forms

Ruling: **fold every kana te-form auxiliary the issue lists into the verb token**: ている/てる, ておく/とく,
てしまう/ちゃう/ちまう, てみる, ていく, てくる, てください, てあげる, てくれる, てもらう (and で- variants).
The token's lemma is the main verb and the auxiliary is a reason in the chain (`te-form`, then one of
`progressive`, `in advance`, `completion`, `trying`, `going`, `coming`, `request`, `for someone`,
`favour`, `receiving favour`), so known state, smart readings, coverage and add-to-deck follow the main
verb; the popup still names the auxiliary in the chain. Yomitan folds only ている/ておく/てしまう and
their contractions; the issue asks for all, and a learner counting 教えてくれた as unknown because of くれる
is worse than not counting くれる — cost if wrong: くれる/もらう/みる never count as words of their own in
coverage (they still do when used alone).

Ruling: **only kana auxiliaries fold**: 走って行く, 持って来る, 書いて見る keep 行く/来る/見る as tokens — a kanji
spelling usually means the literal verb — cost if wrong: two tokens where one would do.

Ruling: contractions carry **the same reason as the full form** (しちゃった: past, completion, te-form) —
one label per meaning — cost if wrong: the popup does not say the form was colloquial.

Ruling: **ちゃ/じゃ (ては) are not added** — kana おちゃ (お茶) would deinflect to おる (居る) and the new kana
fit key would rank the verb first — cost if wrong: 食べちゃだめ stays 食べ + ちゃ.

Also added: ながら (`while`) on every class (しながら, 食べながら, 飲みながら), the adverbial く of
i-adjectives (寒く → 寒い, `adverbial`), suffix forms of kana くる after a te-form (てきた, てきて, てきます,
てこない), and `maxDepth` 5 (食べてしまっていた needs five steps).

## Ranking (`server/internal/lookup/rank.go`)

Ruling: new key **kana fit**, after `primary` and before the inflection chain: a kana-only probe that matched a
word by a reading is a weak match when the word has written forms and is not usually-kana (揣摩 read しま,
使用 read しよう, 下 read した); form matches, usually-kana words and kana-only words are strong. Running text
writes those words in kanji, so kana しよう is the verb — cost if wrong: a text spelling a kanji word in kana
(children's books) sees a verb reading first; the word stays the next candidate. This changes the
no-frequency case of した (now する before 下/舌), deliberately: the test documenting the old order is updated.

Ruling: new key **expression yields**, right after matched length (before frequency): an exact match of a
word whose every sense has an `expressionPos` tag, that has no written form, ranks after the same-length
inflected candidates when one of them has a JMdict priority ≥ its own (> 0) and is no expression itself.
すれば (exp, 60) is the conditional of する (60): the token is する; ください (no competing inflection), しかし
(conj), でしょう, という (written form) are untouched; として (exp, 60) keeps its place against とする (exp + vs-i,
found in the real-app corpus check) — cost if wrong: an expression shown second in the popup.

Ruling: the expression key sits **before frequency** — it is lexical evidence, not usage, and the result must
not depend on whether a frequency pack is installed — cost if wrong: a frequency pack cannot rescue an
expression.

## Segmentation boundary (`server/internal/segment`)

Ruling: an **expression must not cut a longer word**: when the best match at a position is an exact match whose
first candidate is an expression **without priority** (all senses carry `expressionPos`, JMdict priority 0),
its shortest proper prefix with a match has a first candidate tagged `particlePos`, and the match starting
right after that particle ends strictly past the expression's end — or ends with it and is an inflection of a
word with priority (review fix: 仕事をして帰った, 宿題をしても, 宿題をしてから) — the segmenter emits the particle alone.
仕事をしている → 仕事 | を | している, をもらいました → を | もらいました, と言いました → と | 言いました; には, にも,
にとって (priority 60) stay. The priority condition
came from the real-app corpus check: without it 泣かずにはいられない split into に | はいられない (入る) — cost if
wrong: one extra lookup per unprioritised expression match (rare) and a split where a learner wanted the
expression whole. `GET /api/segment/at` (a single position) is unchanged: it returns the longest match.

Ruling: a **compound stem needs two code points or a non-kana one** (`compounds[].stem`): すし was す (為, an
archaic vs-c) + し in the corpus check — cost if wrong: a one-kana する noun (none common) is not found.

## Furigana for folded and compound tokens

Ruling: `/api/segment` matches gain **`stem`** (omitted unless set): the dictionary-side text the first entry
matched when it was found as a compound's stem (勉強 for 勉強しています, lemma 勉強する). The web aligns
furigana against `stem ?? lemma`, so べんきょう sits over 勉強 and the rest stays plain; `alignFurigana` itself
is unchanged and stays language-neutral in shape — cost if wrong: Android must read one more field (the
reader contract says so).

Folded tokens need nothing new: 食べてしまった (lemma 食べる) aligns た over 食; 来ている stays without furigana
(the 来る rule of `furigana-align.json`).

## Consumers follow the lemma (checked, no change needed)

Word states, smart readings and coverage use the match's **first candidate** (`entries[0]`), which is the
lemma's entry; coverage's type label is `lemma`; add-to-deck and the popup use `/api/lookup` at the cursor,
whose ranking is the same code. Verified in the real-app check.

## Performance

Folding adds rules and one depth level: each prefix yields more probes, all batched in the same two store
calls per position. Budget: segmenting the 27 522-code-point corpus may grow at most 1.5×; measured before
and after on the same machine, recorded in the plan.

## Contract `docs/contracts/lemma/`

- `README.md`: format, rule semantics, chaining, stem predicates, compounds, hints, the ranking keys and the
  boundary rule (for a client that segments itself), versioning (`format` bumps on new primitives).
- `ja.rules.json`: the Japanese table (byte-identical to the embedded one).
- `deinflect.json`: `{surface, expect: [{form, class, reasons}], reject: [{form}]}` cases.
- `segment.json`: a small lexicon (forms, readings, POS, priority, usually-kana) and texts →
  tokens (surface, start, end, lemma, reasons, first headword).
Go decodes all three (`lemma`, `segment` tests).

Ruling: **the web does not decode the `lemma/` fixtures** — it never runs the engine (it reads `/api/segment`
and `/api/lookup`), so a web decoder would test nothing the web does; it decodes `reader/smart-readings.json`,
which gains a `stem` case — cost if wrong: a web-side engine later needs its own decoder test.

Ruling (review): **the dictionary form of a compound is not folded** — 勉強する as written stays 勉強 + する; an
exact stem probe would compete at chain length 0 with real する-verb entries (愛する, 察する) — cost if wrong:
coverage counts 勉強する as two words where 勉強した is one.

## Review fixes (2026-11-22)

Ruling: **kana fit compares the reading as written**: a reading match is strong only when the reading's value
is the matched text itself (アメ does not fit あめ, though both fold to あめ) — the plain-form comparison let
katakana-only entries beat 雨, 着る, 買う and でした in hiragana text — cost if wrong: katakana text matching
a hiragana-only word by its folded reading ranks it weak.

Ruling: **adj-ix is its own class** inflecting only on its よ form (かっこよくない → かっこよい, a JMdict reading
of かっこいい), and the adverbial く needs a stem of two code points or a non-kana one — いく, なく, しく were
いい, ない, しい — cost if wrong: an adj-ix word whose entry lacks the よい reading is not deinflected.

Ruling (review nit 8, declined after measuring): **a kana compound stem keeps the two-code-point minimum** —
requiring three hiragana fixed こうしている (稿 + している) but broke けがしていて (怪我 written in kana became 汚す)
in the corpus re-check; こうしている resolves to the expression こうする anyway when JMdict lists it — cost if
wrong: a rare two-kana する noun can still take a kana phrase (こう → 稿 without a frequency pack).

Ruling: **reading lookups are table-driven** (`hints.readingScript`, `hints.readingType`), replacing the
`language == "ja"` checks; selection (which letters start a word) and the Japanese headword display rule stay
with the language code, documented in the contract — cost if wrong: none for Japanese (same behaviour).

## Not in scope

ちゃ/じゃ, そう/すぎる/やすい, godan imperatives (deliberately not deinflected, unchanged), the `lemma-rules`
pack type (follow-up), a Spanish table (the engine test uses a synthetic table; es-demo has no inflected
data worth a table yet), the pre-existing kana-reading branches of lookup (`language == "ja"` for reading
matches; not lemmatization).

## Refinements (#177, 2026-11-22)

Follow-up to the trade-offs recorded above, measured on JMdict-only and JMdict + Jiten scratch servers built
from `develop` (979d67ee). All changes are table data or generic, table-driven engine features (format 2).

Ruling: **a table may list expressions the boundary rule keeps whole** (`hints.keepWhole`: texts compared
with the first entry's written forms and readings) — an expression in the list is never split into particle +
word. A declarative list beats a heuristic: the pri-0 particle-led JMdict expressions include taught grammar
(に基づいて) and plain quotation (と言って) that no tag tells apart — cost if wrong: a listed expression
followed by a longer word loses that word's folding (計画に基づいている → に基づいて + いる).

Ruling: **the Japanese list is derived, then reviewed**: JMdict `exp` entries (every sense `exp`) with priority 0
that start with a particle and whose form or reading occurs in a lesson title, pattern or example focus of the
bundled `ja-grammar` pack (73 candidates, of which the 44 with priority 0 can be split at all), each kept or
dropped by hand; the committed list is the reviewed result in the table, not a build step. Kept whole (taught
as units): に基づいて, を通して, によれば, に応じて, に沿って, をめぐって, をおいて, にすぎない, に反して, にあたって,
にあたり, にわたり, にかけては, にひきかえ, に至っては, に対し, に関し, にして, によらず, にもまして, と思ったら,
ときたら, というと, といえど, といえども, といったらない, が早いか, であれ, であろう, ですら, でない, となく, もさることながら — and
しかねない (its し is する's stem, not a particle; N2 grammar). Split (the learner meets the verb): と言って and
と言い (quotation + 言う: と言っていました folds 言う's progressive), をして (+ する). — cost if wrong: a grammar
expression outside the pack's points is still split.

Ruling: **ないで is the negative te-form inside a chain only** (`ないで` → `ない`, in te, `chainOnly`, a format-2
rule flag): 食べないでください → 食べる with reasons [request, te-form, negative] ("negative te-form request").
As a surface rule it cut 高くないです and どころではないでしょう into ないで + す in the corpus check, so
standalone ないで (忘れないでね, 触らないで) stays ない + で — cost if wrong: those standalone forms keep two
tokens.

Ruling: **てはいけない / てもいい fold like てください** (reasons `prohibition`, `permission`; で- variants,
いけません): してはいけない → する, 食べなくてもいい → 食べる; a chainOnly なくて → ない lets the negative chain
reach the verb (making the general くて rule chainable instead read 痛くてたまらない as a contracted progressive). — cost if wrong: てもいい's いい is not
counted as a word in coverage.

Ruling (superseded in the #177 review, see below): kana fit's usually-kana was briefly the first sense's tag;
display and ranking do **not** share one definition — display uses the first sense (`frequency/`), ranking
the entry flag (any sense).

Ruling: **format 2**: the new hints and `chainOnly` are format-2 fields; an engine reads every format up to its own, so format-1
tables stay valid — cost if wrong: none (no format-1-only client exists yet).
