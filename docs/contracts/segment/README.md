# Whole-sentence segmentation (issues #348, #349)

How `POST /api/segment` reads a text in a language with **segmentation rules** (`<language>.json` here: `ja.json`,
`zh.json`), and the `function` flag on its matches. A language without a rules file (data-only languages with a
lemma-rules pack) keeps greedy longest match (`lemma/README.md`, "Ranking keys and the boundary rule"), unchanged.

Owner code: `server/internal/segment` (`lattice.go`, `rules.go`, `reading.go`; `rules/ja.json` and `rules/zh.json`
are byte-identical to the files here, tests check it), `server/internal/levels` (`WordLevels`). The web app does not
segment: it reads `function` and `reading` (`lib/api/types.ts` `SegmentMatch`).

Fixtures:

- `ja.json` — the Japanese rules (format below).
- `cases.json` — a JMdict-shaped lexicon (as `lemma/segment.json`: `forms`, `readings`, `pos`, `pri` tags on the
  first form, `uk`) and texts with the tokens the server must produce: `surface`, `lemma`, `head` (the first entry's
  first written form, else its first reading) and `function` (present only when true). `greedy` records what greedy
  longest match produced, where it differs (the bug). Go: `server/internal/segment/contract_test.go`; web:
  `lib/features/reader/functionWords.contract.test.ts`, `lib/features/courses/readingText.contract.test.ts`.

- `zh.json` — the Chinese rules (#349; the format's optional keys below).
- `zh-cases.json` — CC-CEDICT lines (verbatim from the shipped dictionary), a word level list (levels-pack shaped) and
  texts with their tokens: `surface`, `reading` (the match's reading as the server sends it) and `function`, in
  `cases` with the list installed and in `withoutLevels` without one; `greedy` where greedy differed (the bug). Go:
  `server/internal/segment/contract_zh_test.go`; web: the same two tests as `cases.json`.

Real data: `server/internal/segment/real_test.go` reads ordinary sentences on the shipped JMdict, `real_zh_test.go`
on the shipped CC-CEDICT with the shipped HSK word list (`realdict`).

## Rules format (`format: 1`)

```jsonc
{ "format": 1, "language": "ja",
  "costs": {"token": 100, "weakReading": 70, "noPriorityKana": 30, "kanjiSplit": 100, "unmatched": 250},
  "splitWords": ["今日は", "今晩は"],               // surfaces that are never one token
  "functionPos": ["prt", "cop", "aux", "aux-v", "aux-adj"],
  "functionWords": ["は", "が", "を", "に", ...] }  // a closed list of lemmas
```

Optional keys (Chinese, `zh.json`; absent in `ja.json`, which reads no level list):

```jsonc
{ "costs": {..., "levelStep": 10, "unlisted": 80},   // level costs (0: none)
  "compounds": "parts",                               // "" (absent): keep every edge
  "partFunctionWords": ["的", "了", "着", "得", ...],  // function words that are a compound's part anywhere
  "functionReadings": {"着": "zhe", "得": "de", ...},  // a function word by its reading
  "readings": {"长": "cháng", "没": "méi", ...} }      // the reading a match of the lemma shows
```

One JSON object, no unknown key, no trailing data. Costs are integers 0..10,000, `token` at least 1, and
`unmatched` must exceed `token + weakReading + noPriorityKana + unlisted` (any token is cheaper than leaving its runes
unmatched). `functionWords` is non-empty and each of its words has a part of speech list (`functionPos`
non-empty) or a `functionReadings` reading; every `functionReadings` and `partFunctionWords` word is in
`functionWords`; `compounds` is `""` or `"parts"`; no list or map holds an empty string. A file that breaks a rule is
refused whole.

## The lattice

1. **Look up every position** of the text once, in text order (the request's work budget, `lemma/README.md`
   "Request budget", is drawn in that order). The lookup at a position is `/api/lookup`'s ranked result list.
2. **Edges.** Each distinct matched surface at a position is one edge; its results are those with that surface, in
   ranking order. A result is **no word** when it is an exact reading match (no inflection) whose matched text is
   not the reading as written and is one code point long or mixes hiragana and katakana (はア read as はあ, ナ as
   な); such results are dropped, and a surface left with none, or listed in `splitWords`, has no edge.
3. **Boundary rule.** Where the lemma contract's boundary rule would split the longest match at a position (をして
   in 仕事をしている), that longest edge is dropped.
4. **Function words.** An edge is a function word when one of its results has a lemma in `functionWords` and a
   sense tagged with one of `functionPos`, or the lemma's `functionReadings` reading among its readings (CC-CEDICT
   has no parts of speech: 着 through zhe). That result becomes the edge's first entry (の the particle, not 野; で,
   not 出), its other results follow in ranking order, and the match carries `function: true`.
5. **Head** (rules with level costs). Otherwise the edge's first entry is its result that is a direct member of an
   installed word level list of the language at the lowest level index, else its best-ranked result.
6. **Costs.** An edge costs `token`; a function word nothing more; any other edge `weakReading` more when its first
   result is a weak kana fit (`lemma/README.md`, "Kana fit": kana text read as a word usually written in kanji, がい
   as 害) and `noPriorityKana` more when its surface is all kana and its first entry has priority 0. An edge that
   starts between two kanji (a Han character, 々 or 〆 on both sides of its start) costs `kanjiSplit` more
   (仕｜事がある). With level costs, an edge whose first entry is a **listed word** (a direct member of a live
   word-unit scheme of the language; a character only derived from a listed word is not one) costs
   `min(levelStep × level index, unlisted)` more (index 0 for a scheme's first level, the lowest over the schemes),
   any other `unlisted` more. A rune no edge covers costs `unmatched` (it stays outside every match, as before).
7. **Compounds** (`compounds: "parts"`). An edge of two or more runes whose first entry is not a listed word is
   dropped when its whole text is read by edges inside it that are listed words, `partFunctionWords`, or any other
   function word as its last part: 不是 is 不｜是, 中国人 中国｜人, 得很 得｜很, 在地 在｜地 — but 地上 stays (地 is
   no part at the start of a compound) and 熊猫 stays while 熊 is not listed. Without a level list nothing is
   listed and no edge is dropped.
8. **Path.** The segmentation is the cheapest path from the start of the text to its end. Ties go to the **longer
   edge at the earliest position** where the paths differ, so where scoring prefers nothing else the result is
   greedy's (every `lemma/segment.json` case holds unchanged).

Examples (`cases.json`): 妹がいます is 妹｜が｜います (greedy: 妹｜がい｜ます — がい is a weak reading of 害);
花がきれいです is 花｜が｜きれい｜です (greedy: がき｜れい); 仕事はちょっと is 仕事｜は｜ちょっと (greedy: はち, with
ょっ left unmatched); 名前はアンナ is 名前｜は… (greedy: はア, a mixed-script reading of はあ).

## The reading of a match (rules with `functionReadings` or `readings`)

With `"readings": true` a match shows: a function word its `functionReadings` reading (着 zhe, 得 de); else the
`readings` reading of its lemma when the entry has it (长 cháng, 没 méi); else the reading, of the type of the
entry's first reading (pinyin), whose **everyday** senses have the most glosses — a minor sense (the sense display
rule, `senses/`: a surname, variant, "used in", abbreviation or archaic line) counts nothing, a sense without a
reading tag counts for every reading, ties go to the earlier reading; else the lookup's reading. 那 is nà (nā and nuó
are surnames, nǎ a variant), 打 dǎ (not the loanword dá), 看 kàn. Clients show `reading` as sent.

Chinese examples (`zh-cases.json`, HSK on the shipped data in `real_zh_test.go`): 那是我的书 is 那｜是｜我｜的*｜书
(greedy: 那是 nà shi); 他看着我 is 他｜看 kàn｜着* zhe｜我 (greedy: kān, zhāo); 我有时间 is 我｜有｜时间 (greedy:
有时｜间; 间 is listed only through 时间); 我在教室 is 我｜在｜教室 (greedy: 在教｜室); 他学得很好 is 他｜学｜得*｜很｜好
(greedy: 得很); 一个, 不是, 这不, 中国人 and 明天见 split into their listed words.

## Function words for clients

`function: true` is sent only when true. A function word is grammar, never vocabulary:

- **never new or learning**: the reader draws no word-state line on it (`reader/README.md`, word states);
- **never unreached**: a course reading lesson shows it without a reading or a gloss and does not list it;
- **not a coverage token** (`reader/README.md`, coverage): it counts neither as known nor as unknown and is not a type
  of the unknown list; its characters are covered by a match, so they are not "unmatched" either.

The popup's lookup (`/api/lookup`, `/api/segment/at`) is unchanged: a lookup at a cursor, longest match first.

## Bounds and speed

Chinese (#349): on 5,000 runes of Tatoeba sentences with the whole shipped CC-CEDICT and the HSK word list, greedy
took 0.44–0.58 s and the lattice with its one batched level read takes 0.71–0.93 s (the #349 plan's execution
record).


The lattice looks up every position, where greedy looked up only where a match started; one request keeps one memo
of the store reads (entries by form and by reading, frequencies, retired entries, dictionary names), so a recurring
prefix is read once. On 5,000 runes of Tatoeba sentences with the whole shipped JMdict and the Jiten frequency list,
greedy took 3.0–3.5 s and the lattice takes 1.6–1.9 s (the #348 plan's execution record). The work budget and every
lookup bound are unchanged.

## Android notes

Read `function` and `reading` from `/api/segment` and apply the three client rules above. A client that segments
offline implements this lattice over its lookups with the bundled `ja.json` and `zh.json` (and, for Chinese, the
installed word level lists).
