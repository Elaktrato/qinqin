# Japanese conjugation (the conjugation trainer, #178)

The engine of the conjugation drill (`drill.conjugation`, `drills/README.md`): which dictionary entries are verbs or
adjectives it drills, their **form families** (the unit a learner switches on and the drill schedules), and every
form with its **canonical answer** first and the **accepted** alternatives after it. Plan:
`docs/superpowers/plans/2026-11-28-178-conjugation-trainer.md`. The forms and the exclusions were reviewed by two
Japanese teacher agents (notes in the plan).

Owner code: `server/internal/conjugation` (Go). The server conjugates; a client reads the forms from
`POST /api/drills/conjugation/words` (below) and never conjugates itself, so a second client needs only the route.

| File | Rule | Decoded by |
| --- | --- | --- |
| `families.json` | the families (`id`, `forms`, `default`), the families of each class, the word `exclusions` | Go: `server/internal/conjugation/contract_test.go`; web: `apps/web/src/lib/exercises/conjugationSettings.test.ts` (ids and defaults) |
| `forms.json` | `classify` (parts of speech → class), `conjugate` (a word → its families and forms), `ineligible`, `lemmaGaps` | Go: `server/internal/conjugation/contract_test.go`, `lemma_test.go` |
| `settings.json` | the workspace-settings key `conjugation` (`parse`, `patch`) | web: `apps/web/src/lib/exercises/conjugationSettings.test.ts` |
| `words.json` | the route's answer for a few entries | Go: `server/internal/api/handlers_conjugation_test.go`; web: `apps/web/src/lib/features/practice/conjugation/words.test.ts` |

## Classes

The **class** of an entry is the first part-of-speech tag, sense by sense in the stored order and tag by tag, that is
one of: `v1`, `v1-s` (くれる), `v5u`, `v5u-s` (問う, 請う), `v5k`, `v5k-s` (行く), `v5g`, `v5s`, `v5t`, `v5n`, `v5b`,
`v5m`, `v5r`, `v5r-i` (ある), `v5aru` (なさる, くださる, いらっしゃる, おっしゃる, ござる), `vk` (来る), `vs-i` (する and
する verbs written with it), `vs-s` (愛する, 察する), `adj-i`, `adj-ix` (いい and its compounds), `adj-na`. JMdict
gives these tags (`dict/` keeps them per sense). An entry without one is not drilled: a noun that takes する
(`n, vs`: 勉強), `adj-no`, `adj-t`, `vz` (信ずる), the archaic `v2`/`v4` classes, expressions.

Ruling: the class comes **only from the part-of-speech tags**, never from the ending or the reading — 着る/切る,
帰る/変える, 居る/要る, かわいい/かっこいい, きれい (adj-na) are told apart only by their tags — cost if wrong: an entry
with a wrong tag in the dictionary drills wrong forms.

Ruling: nouns tagged `vs` are **not drilled**; する itself is — the learner studies the noun, and its forms would be
する's forms again — cost if wrong: a learner who wants 勉強する drilled adds the する word.

## Forms

A word is conjugated on its written form and its kana reading (hiragana only). The class's **ending** (る, the u-row
kana of a godan verb, くる, する, ある, い, いい; none for adj-na) is replaced by each form's suffixes. A written form
with a kanji for the first kana of a two-kana ending (来る, 有る, 良い) keeps the kanji when the suffix starts with a
sound that kanji stands for (こ/き/く, あ, い/よ) and is written in kana otherwise (有る → ない). A word whose written
form or reading does not end in the ending is not drilled.

| Form id | Label (en) |
| --- | --- |
| `polite`, `polite-negative`, `polite-volitional` | polite (〜ます / 〜です), polite negative (〜ません), polite let's (〜ましょう) |
| `polite-past`, `polite-past-negative` | polite past (〜ました / 〜でした), polite past negative (〜ませんでした) |
| `negative`, `past`, `past-negative` | plain negative (〜ない), plain past (〜た), plain past negative (〜なかった) |
| `te` | て-form |
| `potential`, `volitional` | potential, plain volitional (〜よう / 〜おう) |
| `conditional-ba`, `conditional-tara` | ば conditional (な-adjectives: なら), たら conditional |
| `passive`, `causative` | passive, causative |

Accepted alternatives (the full list is `forms.json`): ら-less potentials of ichidan verbs and 来る (食べれる,
これる; never for the passive, never for いる); 〜くありません beside 〜くないです; ではない/では… beside じゃない/じゃ…
and じゃないです beside じゃありません; ならば and であれば beside なら; 〜しない beside 愛さない/訳さない; 訳すれば beside
訳せば (愛せば beside 愛すれば); される beside せられる (察する); ないです/なかったです for ある and ありません/ありませんでした
for the adjective ない; よいです for いい and 良い; 出来る for できる in a する verb; いらして/いらした/いらしたら for
いらっしゃる; the written forms of the entry's other spellings (判る, 解る, 行なう), after the headword's.

Variants by word: a `vs-s` verb takes the godan forms (愛さない, 訳せる, 訳そう, 訳せば) only when it has a godan twin in
す (the written stems 愛, 訳, 略, 課, 科, 解, 介, 期, 害, 属, 処, 適); every other `vs-s` verb (察する, 罰する, 要する,
有する) keeps the する forms (察しない, 察しよう, passive 察せられる) and has no potential or causative; 行く read ゆく gives
いった, いって, いったら; いる (居る) has no ら-less potential.

## Families

`polite`, `polite-past`, `negative`, `past`, `te-form` (on by default), `potential`, `volitional`, `conditional`,
`passive`, `causative` (off). A word has a family when it has one of the family's forms. くれる, ある, the honorific
verbs and adjectives have no potential, volitional, polite let's, passive or causative. **Exclusions** (by written
form, with a class or a reading where the written form is ambiguous) take forms away from single words: verbs that are
not done on purpose (分かる, できる, 見える, 起こる, 壊れる, …), the humble verbs (参ろう no, 参りましょう yes), ござる's
plain forms, 関する/対する/反する and 要る written いる (dropped: the prompt could not say whether 居る is meant), ない's double negatives, 死ぬ/殺す's volitional, 来る read きたる. A word
left with no form is not drilled.

Ruling: a `vs-s` verb is conjugated as a godan verb **only from an allowlist** of the stems with a godan twin, every
other one keeps the する forms — the second review found 有さない, 要さない, 反さない from a class-wide rule — cost if
wrong: a rare twin verb missing from the list is drilled with its する forms only (they are right too).

Ruling: the defaults are the **beginner families** (N5 in textbook order: Genki 3–9, Minna 4–20) and the rest is off
— both teacher agents found potential and volitional on by default too early for a beginner — cost if wrong: an
intermediate learner switches four families on once.

Ruling: ましょう is in the **polite** family — it is taught with ます (Genki 5), long before the plain volitional —
cost: none.

Ruling: the drill asks **only the listed forms**, never compounds (食べられなかった) — compounds would need
compositional labels and make the potential/passive overlap worse — cost if wrong: compound recognition waits for a
later family.

Ruling: 〜たい, 〜ている, 〜ないで/〜なくて, the imperative, the causative-passive and the adjectives' adverbial
form are **later families** (both reviews asked for them) — they fit the same tables; this issue ships the forms the
owner listed — cost: a follow-up issue.

## The lemmatizer (#165)

The reader's lemmatizer (`lemma/`) understands the same forms in reverse. `lemma_test.go` runs every form of
`forms.json` (written and read) through the Japanese rule table and expects its word back with the lemmatizer's class
(`v1`, `v5`, `vk`, `vs`, `adj-i`, `adj-ix`; な-adjectives are skipped: the table has no copula rules). The forms it
cannot reach yet are listed in `lemmaGaps` as `"<word> <form>"` (the い-adjectives' です forms, いい's よ- forms,
v5aru's い-stem, 問う's うて, the 愛する pattern, くる in kana, ある's ない, …); a listed gap that starts to
lemmatize fails the test, so the list stays honest. Closing the gaps is the lemmatizer's work (a later issue).

Ruling: **two tables**, the engine's forward table and the lemmatizer's reverse table, held together by this test,
not one generated from the other — the reverse table chains rules through intermediate classes and accepts
over-generation a forward table must never produce — cost if wrong: two tables to keep in step; the test names each
form where they part.

## The route

`POST /api/drills/conjugation/words` `{"ids": [1..500 entry ids]}` (signed in; no access token):
`{"words": [{"id", "class", "written", "reading", "readings", "families", "forms"}]}` in first-occurrence order of
the eligible ids (an unknown, foreign-language, non-word or not drilled entry is absent, duplicates once). `written`
is the entry's headword and `readings` its readings (romaji included) after the caller's own entry patch, as
`POST /api/entries/bases`; `reading` is the kana reading conjugated (the first kana reading of the headword's
readings). `forms` maps a form id to its answers `[{"written", "reading", "romaji"}]`, canonical first. Malformed
bodies, empty or more than 500 ids, an id ≤ 0: 400 `bad_request`.

## The setting (`conjugation`, `settings.json`)

The workspace-settings key `conjugation: {families: {<family>: boolean}}`: each family alone, a boolean, else its
default; unknown members ignored. Written one family at a time by merge patch (`{"conjugation": {"families":
{"passive": true}}}`). With every family off the drill has no items and says so.
