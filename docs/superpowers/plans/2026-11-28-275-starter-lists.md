# #275 Starter lists: about 150 words per language — plan (2026-11-28)

Issue #275 (milestone v0.9.0). Owner decisions (2026-11-26): about **150 words per language**, reviewed by
native-language teacher agents now, by the owner later. Starter mode itself is #214
(`docs/superpowers/specs/2026-11-26-starter-mode-design.md`); the lists open section 0 of the course
(`docs/superpowers/specs/2026-11-24-courses-design.md` §5, §9).

## What

- Grow `server/internal/starter/sets/starter-ja.json` (55 words) and `starter-zh.json` (47 words) to about 150
  common, picturable beginner words each, across the course themes (food, drink, family and people, the body,
  animals, nature and weather, numbers, colours, home and everyday objects, clothes, transport, places, school,
  everyday actions). The project chooses them (CC BY 4.0).
- Every word has a picture that the server really serves for it and that a reviewer checked.
- Review by two independent native-teacher agents per language plus an adjudicator; findings applied; notes kept in
  `server/internal/starter/sets/REVIEW.md`; the lists say "reviewed by agents".
- Tests: the lists parse, every word resolves to a dictionary entry and has its picture, no duplicates; an e2e
  check that Starter mode offers the larger set at phone width.
- Docs: sources, licensing, wiki, `NEXT.md`.

## Tasks

1. This plan.
2. Tests first: the shape rules of the shipped sets (size, no duplicate form, picture or gloss) and a resolution
   test that runs in CI against the committed dictionaries (filtered to the set's words) and checks each word's
   entry, its reading, its topic label and the picture the server would serve. See them fail on the old seeds.
3. The new lists (draft), checked by the tests.
4. Teacher-agent review (two per language, adjudicator), findings applied, notes file, "reviewed by agents".
5. Web: the Sources page credit for the Starter words; e2e at phone width.
6. Docs and release notes; gates.

## Rulings

1. Ruling: **146 Chinese and 145 Japanese words**, the test floor 140 (`minShippedWords`), the ceiling `MaxWords` 300
   unchanged — "about 150" (owner); the review dropped more words than it could add because many wanted words have
   no picture yet — cost if wrong: a few more words later, one constant.
2. Ruling: **only words whose served picture is good**, and no mapping row added or changed — the server serves the
   best row of the images mappings for the entry, not the set's `concept`, so a word needs a real row; the mappings
   are #274's (coordination through files only), so a word with a wrong or missing picture is left out and listed
   under "Wanted" in `REVIEW.md` instead of overridden — cost if wrong: basic words (吃, 食べる, 爸爸, お母さん, 海) wait
   for the picture work; adding them later is one line each.
3. Ruling: **the set's picture must equal the served picture** (new test) — the old test only checked that a row
   exists; a set naming a picture the learner never sees is the failure #216 meant to prevent — cost if wrong: a better
   mapping row from #274 for a Starter word fails the test until the set names it (a one-line update, and the test
   says which).
4. Ruling: **one picture, one form and one gloss per word in a set** — at stage 1 the picture and its sound are all a
   learner has; two words with one picture cannot be told apart — cost if wrong: none found; a pair that truly needs
   one picture would need a second drawing.
5. Ruling: **the resolution test runs in CI** against the committed CC-CEDICT and JMdict, filtered to the entries
   carrying a set's forms or readings and imported with the real importer (about 1 s) — the env-gated full-seed test
   never ran in CI; the filtered result matched the full seed for every word, including the misses (くま, 虹) —
   cost if wrong: a resolution that depends on entries the filter drops would differ from production; the full-seed
   test (`QINQIN_STARTER_DB`) is kept for that and was run.
6. Ruling: **"reviewed by agents" is said in `attribution`**, not in a new field; `humanReviewed` keeps its meaning
   (a person has read it), the contract README says a shipped set with `false` names its review in `attribution`,
   and a test checks the wording — no shape change, so the ContractVersion stays 22 — cost if wrong: a client that
   wants a machine-readable review state needs a field (a contract bump).
7. Ruling: **the web shows the size and the review state** under "Add the Starter words" (Home offer and Settings):
   "146 everyday words with pictures. Reviewed by agents acting as native-speaker teachers, not yet by a person." —
   `humanReviewed` was declared "the UI says so" but nothing showed it, and the e2e needs a visible sign of the larger
   set — cost if wrong: one line of text under a button.
8. Ruling: **the Sources page credits the Starter words** (`sources.core.starterWords`, CC BY 4.0, reviewed by agents)
   like the topic labels — the words are built-in content with a review state — cost if wrong: one credit row.
9. Ruling: **topic labels are not required** of a Starter word (logged, not failed) — section 0 is the Starter set
   itself, and the labels (#220) do not cover 11 Japanese and 3 Chinese words (林檎, 牛乳, 帽子 …) — cost if wrong: the
   fill rule cannot place those words by theme in later units.
10. Ruling: **kana forms only where the kana row resolves to the same entry** — the teachers asked for kana for 18
   Japanese words; 10 of them resolve to another word or none as kana (くま "corner", ちょう "just a minute"), so they
   keep the kanji with the kana reading; the cards show the kana until the last stages — cost if wrong: the last stage
   of 熊, 象, 虎, 蛇, 蝶, 鼠, 椅子, 箸, 鍵, 眼鏡 shows a kanji beginners rarely write.
11. Ruling: **one-character Chinese words with a misleading first line stay** where they are essential (书, 水, 三, 马 …)
   and are replaced where a two-character word has the picture (云 → 云彩, 钟 → 闹钟); 草 is dropped (its vulgar cào
   line shows on the card back) — the adjudicator's call; the sense order is a dictionary matter reported as a
   follow-up — cost if wrong: the card back of 书 starts with "abbr. for 書經" until the follow-up.
12. Ruling: **learning order: people and numbers first**, animals last (Japanese) or after the body (Chinese) — both
   teachers and both adjudicators, for adult beginners and the course's first lessons — cost if wrong: one reorder.

## Review summary (details: `server/internal/starter/sets/REVIEW.md`)

Two teacher agents per language reviewed independently (`claude -p --effort high`, no tools; personas in REVIEW.md),
an adjudicator per language decided every raised point. Chinese: 46 points raised (18 by both teachers); 24 kept
(most with a dictionary follow-up), 11 words dropped, 4 replaced or respelt (云彩, 闹钟, 洗手间, 桃子), 6 readings
pinned, 1 gloss fixed, 零 added. Japanese: 44 points raised (27 by both); 11 kept, 8 dropped, 3 replaced (じゃがいも,
お茶, 子供), 18 kana forms asked of which 8 were possible (ruling 10), おまわりさん and 葉っぱ adopted, 2 glosses
fixed, 財布 and 携帯電話 added. Both asked to start with people and
numbers. The reviews' main findings outside the lists: CC-CEDICT slang lines on child-facing cards, surname/variant
lines first on one-character cards, JMdict sense order and "usually kana" flags on 目/山, a resolution bug (虹 → 二次,
via a search-only form), and the pictures wanted for 22 words.

## Execution record

1. Plan — `42cd99ad`.
2. Resolution test — `50bcc6a0`. Written before the lists; it passed on the old seeds (they were consistent) and
   caught, on the drafts: 21 words without a served picture, カレー not resolving, 虹 resolving to 二次, 10 kana rows
   resolving elsewhere or nowhere, and a too-strict target rule (a manual row is keyed by a written form, not the key;
   relaxed to the server's targets, in both real-data tests). Size/duplicate rules: written first, seen failing on 55/47.
3. Web — `3e7502d0`. Dom tests for the set note and the Sources credit written first and seen failing; the e2e was
   committed with the lists (it needs them).
4. Lists — `daa47994`. Draft from the committed mappings (~160 per language), every picture rendered and looked at,
   doubtful ones dropped; teacher review, adjudication, applied. Not honest to call green: this commit's attribution
   lacked the exact credit "qinqin contributors, CC BY 4.0" that `scripts/check-sources.mjs` (rule i) checks; fixed in
   the next commit.
5. Docs and review notes — `8cdd1403` (also carries the attribution fix).

Gates (at `8cdd1403` plus this plan): Go `./...` 62 packages ok, the one known failure `internal/ai`
`TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6); `go test -run RealDictionaries` with a full seed of
CC-CEDICT and JMdict: pass. Web: check 0 errors, build ok, vitest 742 files / 15,049 tests passed (Node 26); e2e
three runs: 60/60, 60/60, 59/60 (hide-romanisation.spec.ts "Chinese with pinyin and bopomofo hidden" failed once
under full-suite load; 10/10 when repeated alone; not touched by this change). Scripts: 229 pass, 1 skipped;
`check-sources` agrees; `gen-api-docs --check` clean.

## Local follow-up

- None needed for the lists. A look at the Starter cards on a phone with the images pack installed (the e2e instance
  has no pictures): `qinqin seed` with `WITH_IMAGES=1`, add the Starter words in a Japanese and a Chinese workspace,
  study a few cards, look for pictures that read wrongly at stage 1.
