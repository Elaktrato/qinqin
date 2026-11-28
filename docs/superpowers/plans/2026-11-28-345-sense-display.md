# #345 — vulgar and slang senses never lead a card (2026-11-28)

Issue: "entries: vulgar and slang senses show first on beginner cards (鸡, 鸭子, 黄色, 草)". Child safety, the highest
priority of the three dictionary display issues of v0.9.0 (#345, #346, #347; one branch each, in that order).

## What

One display rule for the senses of an entry, shared by the server and the web (new contract `senses/`, fixture
`display.json`, rule `senses/display`): every gloss is checked for a slang, vulgar or derogatory mark; a sense's marked
glosses become a **sensitive unit** of their own, shown after every other meaning and **folded** behind "more" on
cards, in the lookup popup and in the lists that show one gloss; the full entry page still shows them, last and
marked. Stored data does not change (sense order and count stay as imported, so picture mappings by sense number and
JMdict cross-references keep pointing at the same senses), and the rule works on an existing database without a
re-import.

## The rule (`docs/contracts/senses/README.md`)

1. **Marks.** A gloss is marked `vulg`, `derog` or `sl` (the strongest wins: vulg, then derog, then sl) when
   - its sense carries a JMdict tag: `vulg` → vulg; `derog`, `sens` → derog; `sl`, `net-sl`, `m-sl` → sl;
   - its text has a parenthesised note (CC-CEDICT's markers) containing, case-insensitively, `vulgar` or `expletive`
     (vulg), `derog`, `pejorative` or `offensive` (derog), or `slang` (sl, also "Internet slang");
   - its text has one of the explicit words (whole words, case-insensitive: fuck, fucking, fucked, fucker, cunt,
     penis, vagina, testicles, prostitute(s), prostitution, whore(s), slut(s), porn, porno, pornographic,
     pornography, lewd, obscene, masturbate, masturbation) → vulg;
   - its text contains one of the vulgar characters 肏 屄 屌 (a "variant of 肏" line) → vulg.
2. **Units.** Each sense gives at most two units, in this order: its unmarked glosses (class `everyday`), then its
   marked glosses (class `sensitive`, with the strongest mark among them). Gloss order inside a unit is kept.
3. **Order.** Every everyday unit in sense order, then every sensitive unit in sense order.
4. **Folding.** Sensitive units are folded, unless the entry has no everyday unit at all (a word whose only meaning
   is vulgar, looked up or studied on purpose): then nothing is folded and the order is the stored one.
5. **The one gloss** a list shows (Starter set, frequency top words, search hits per dictionary, a word's characters,
   the reverse card's front, the writing card's prompt) is taken from the unfolded units in display order.

## Tasks

1. Plan (this file).
2. Contract: `docs/contracts/senses/README.md` + `display.json` with the issue's words from real CC-CEDICT and JMdict
   lines, contract 23, CHANGELOG, index row. Go `lexicon.DisplaySenses` (lexicon/senses.go) and web
   `lib/entry/senseDisplay.ts`, each decoding the fixture; tests first.
3. Server: the one-gloss picks (starter set entries, frequency top, search hits, entry characters, the AI examples
   request) use the rule; real-data test of the issue's words through the committed dictionaries (filtered CC-CEDICT
   and JMdict, the #275 pattern).
4. Web: card backs (vocab, Starter mode, reverse) show unfolded units with a "Show n more meanings" button for the
   folded ones (marked); the reverse front and writing prompt use unfolded glosses; the lookup popup and sheet order
   units and keep sensitive ones behind "Show more senses"; the entry page shows every unit in display order with a
   mark chip. Unit tests and component tests.
5. e2e at phone width: 鸡 on a card back and in the popup (folded, revealed by the button); the entry page marks it.
6. Docs: wiki, NEXT.md, plan execution record, gates.

## Rulings

- Ruling: the rule is applied at display time, never by reordering or splitting stored senses — picture mappings
  (`map.tsv` sense numbers) and JMdict xrefs ("山札・1") count stored senses, and existing databases get the fix
  without a re-import — cost if wrong: every client must implement the rule (hence the contract and fixture).
- Ruling: JMdict `col` (colloquial) and CC-CEDICT "(coll.)" are **not** sensitive — `col` is on 2,500 JMdict senses
  of everyday words and "(coll.)" on harmless lines (水 "lacking in substance"); crude colloquial lines are caught by
  their own vulgar/slang marks or the explicit words — cost if wrong: a crude colloquial line shows unfolded; add
  its word to the list.
- Ruling: all slang folds, harmless slang too (牛 "awesome", 沙发 "first reply to a forum post") — the markers do not
  say which slang is crude and a beginner loses little behind "more" — cost if wrong: a useful modern sense is one
  tap away on cards.
- Ruling: JMdict `sens` (sensitive) counts as derog; `euph` (euphemism) does not (去世 "to pass away") — cost if wrong:
  a few euphemisms for sexual topics show unfolded.
- Ruling: an entry whose every unit is sensitive shows them all, unfolded and marked (鸡巴, 屄) — the learner looked
  the word up or chose to study it; hiding its only meaning would leave an empty card — cost if wrong: none for
  beginner lists, which never contain such words (the Starter sets are reviewed).
- Ruling: the explicit-word and vulgar-character lists are short and closed (in the contract) rather than a general
  profanity list — they catch the lines CC-CEDICT leaves unmarked (黄色 "vulgar; lewd; pornographic", 草 cào
  "variant of 肏", 鸟 diǎo "penis", 烟花 "prostitute") without folding ordinary words ("cock" is a rooster, "rape" a
  plant, "sex" a gender) — cost if wrong: an unmarked crude line shows; extend the list in the contract.
- Ruling: the full entry page orders units the same way (everyday first) and marks sensitive ones with a chip
  ("vulgar", "derogatory", "slang"), unfolded — the issue asks to keep them for completeness, clearly marked.
- Ruling: the popup shows its first three units as before, but a sensitive unit is never among the ones shown before
  "Show more senses" (unless every unit is sensitive).

- Ruling: JMdict's derog first senses fold too (7 common words: おっさん, くたばる, 彼奴, 気違い, 成金 …): one rule, no
  exception list — cost if wrong: おっさん's "middle-aged man" sits behind "Buddhist priest" on its card.
- Ruling: a word's mark is the strongest of its glosses' marks, the explicit words included, so 鸡's "(slang)
  prostitute" is marked "vulgar", not "slang" — cost if wrong: a chip wording.
- Ruling: the AI example request leaves folded glosses out, and the character universe's meaning skips marked glosses
  like it skips surname lines — the example writer and the character map are beginner views too.

## Execution record

1. Plan committed first (`docs(plan)`).
2. Contract and both implementations, test first: the Go and web fixture tests were written and run red (undefined
   symbols / no module) before `lexicon.DisplaySenses` and `senseDisplay.ts`. The first green run showed two fixture
   expectations wrong (鸡, 鸭子: "prostitute" is an explicit word, so the strongest mark is vulg, not sl); the fixture
   was corrected to the rule, not the code changed. Contract 23.
3. Server picks, test first: `api/sense_display_internal_test.go`, `sentences/examples_glosses_test.go` and the new
   鸡 / 肏 rows of `TestCharactersMeaningfulFields` failed first, then passed. The real-dictionary test
   (`lexicon/senses_real_test.go`, through the new `internal/realdict` helper that imports the shipped CC-CEDICT and
   JMdict cut down to the named words) was written after the rule and passed at once: 鸡, 鸭子, 黄色, 草, 鸟, 干, 犬, 猫,
   山.
4. Web, test first for the logic (`entrySenses.test.ts`, `cardView.test.ts`, `reverse.test.ts`,
   `entryDisplay.test.ts` red, then green). The DOM tests (`VocabCard.dom.test.ts`, `EntryCard.dom.test.ts`) were
   written after the components and passed at once. One test expectation was wrong (a two-sense entry cannot show
   three) and was fixed.
5. e2e `sense-display.spec.ts` at 360 px (card back, lookup sheet, word page; a 鸡 line added to the e2e zh fixture
   pack): passed on its first run.
6. Wiki (Searching and entries, Reader, Dictionary data model) and NEXT.md.

Gates on the branch head: `npm run check` 0 errors 0 warnings; full vitest 744 files, 15,092 passed, 2 skipped;
targeted Go (`lexicon`, `api`, `sentences`, `starter`, `realdict`) ok; `node --test scripts/*.test.mjs` 235 passed;
e2e `sense-display.spec.ts` 3 passed. The full Go suite, the build and the 3-run e2e are run on the last branch
(#347), which contains this one.
