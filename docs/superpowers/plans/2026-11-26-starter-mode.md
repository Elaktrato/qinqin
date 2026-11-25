# Starter mode: per-word stages, Starter sets (#214)

Milestone v0.8.0 (the beginner experience). Issue #214. Branch `feature/starter-214`, PR base `feature/v0.8.0`.
Design and rulings (`Ruling: <what> — <why> — <cost if wrong>`): `docs/superpowers/specs/2026-11-26-starter-mode-design.md`.
Contract 9: `docs/contracts/starter/`. Built on #215 (hints registry, `forced`) and #216 (images pack, `entryPicture`).
The parallel visual-aids work (#212: tone colours, anatomy, grammar diagrams, word maps) shares only the hints registry;
none of its files were touched.

**Goal:** a pure, tested stage model derived from a word's review history; Starter mode as a display rule on vocab
cards that uses the hints registry with forced hints; a Starter set format and two small seed sets built only from words
that have a verified picture; settings, a Home offer, rendering of romaji, pinyin, kana, furigana and pinyin ruby, a11y,
contracts and fixtures decodable by Android, docs, i18n, dom and e2e tests.

## File map

- Pure: `apps/web/src/lib/study/starter.ts` (stage rule, fronts, notes, settings, deck id), `starter.test.ts`,
  `starter.contract.test.ts`, `pictureCache.ts`; `docs/contracts/starter/stages.json`.
- Server: `server/internal/starter` (format, embedded sets `sets/starter-ja.json`, `starter-zh.json`, resolution with the
  character fallback, `realdata_test.go` against a seeded database), `server/internal/api/handlers_starter.go`, routes in
  `api.go`, fixtures `routes.fixture.json` and `auth/tokens-routes.json`; `docs/contracts/starter/set.json`.
- Web: `lib/api/starter.ts`; `lib/starter/` (`StarterSettings`, `StarterOffer`, `StarterAdd`, `offer.ts`);
  `features/flashcards/decks/starterSet.ts` (the add plan); `VocabCard.svelte` (front, ruby, note, play button);
  `HintShown`/`HintScope`/`cardHints` (the picture hint); `routes/study/session/+page.svelte` (stage per card, forced
  hints, picture loading); Home and Settings pages; catalogue keys.
- Docs: contract README, CHANGELOG (contract 9), `version.json`, settings keys, overview, wiki (study sessions, API
  reference, licences), ROADMAP, ADR 0004 folder list.

## Tasks

- [x] 1. Contract fixture `starter/stages.json` and its decoder test, then `starter.ts`: points rule, thresholds, final
  stage, stage rows, forced hints, fronts, "New" note, settings read and patch, deck id (21 histories pinned).
- [x] 2. Starter set format, embedded sets, resolution (word rule, single-hanzi character fallback, duplicate entries),
  `set.json` fixture and Go contract test; picture promises checked against the committed mapping.
- [x] 3. Routes `GET /api/starter-sets` and `GET /api/starter-sets/{id}`; handler tests; route fixtures regenerated.
- [x] 4. Real-data check: seed JMdict and CC-CEDICT, resolve both sets (`QINQIN_STARTER_DB=... go test -run
  RealDictionaries -v`), read every word's entry; two zh words removed (苹果, 鸟), the rest kept with the findings in the
  spec.
- [x] 5. Picture hint lit: `hintsForEntry(entry, {hasPicture})`, `ready: true`, `PictureCache`, `HintShown` draws the
  SVG with `themeSvg` and the credit line, `HintScope` carries the picture.
- [x] 6. `VocabCard` Starter front, `starter` prop, ruby, below-annotation, note, play button; session page computes the
  stage per card from the loaded and session reviews, passes `forced` to `resolveHints`, loads the picture only when a plan
  could show one.
- [x] 7. Add-to-deck plan for the set (`starterSet.ts`), `StarterAdd`, `StarterSettings`, `StarterOffer`, pages wired.
- [x] 8. Catalogue keys, sentence-case name, repo guards (folder rules, overview read order, generated API docs).
- [x] 9. Docs: README, CHANGELOG (contract 9, `ContractVersion` 9, `version.json`), wiki, ROADMAP, spec, this plan.
- [x] 10. Tests: pure (starter, contract, pictureCache, offer), dom (VocabCard Starter, settings, offer, session page),
  Go (format, resolve, handlers, real data), e2e spec `e2e/tests/starter.spec.ts` (written, run only by CI).
- [ ] 11. Owner and a person: review and extend the Starter sets to 100-300 words per language (see below).

## Review list for the person who extends the sets

- Chinese single-character words are character entries whose first gloss is "surname X" (鱼 牛 马 水 火 雪 花 门 钱) or an
  abbreviation (书 "abbr. for 書經"): the real meaning is the second gloss. Either keep them, prefer a two-character word
  (书本, 小鸟), or fix the gloss order in the dictionary import.
- Japanese words whose display form is the kana (林檎 みかん 帽子 ...: JMdict tags their first sense `uk`) stop at stage 4
  by the owner's rule; loanwords (バナナ ...) have no kanji stage at all.
- Missing categories the issue names: numbers, colours, family, everyday verbs (verbs need a picture of an action:
  Mulberry has them, the matcher's verb-on-noun rule excludes most).
- Every word is `humanReviewed: false` until a person flips it per set.

## Open questions for the owner

1. **Word list licence:** CC0 1.0 for the Starter word choice (ruling in the spec)?
2. **Thresholds:** 7 spaced successes for Japanese, 6 for Chinese; Again drops a stage. Right pace?
3. **Manual nudge** ("show me the kanji already"): worth a keyed row per word?
4. **Create-workspace "I'm new" checkbox** and **reader/entry pages** following the stage: next?
5. **Picture hint everywhere:** with the picture kind lit, every vocab card of a word with a picture offers a Hint
   (the #215 default `hint` on Recognise). Keep, or default picture to `never` outside Starter mode?
6. **The pictures need a server round trip** (no offline pictures, #216 ruling 5): a Starter card offline shows romaji
   and no picture.

## Not verified

- Nothing was drawn in a browser (no local browser automation by the owner's rule): the ruby, the picture size and the
  note are covered by dom tests with jsdom only; the e2e spec was type-checked by CI only, not run here.
- The images packs were not built here (they need the pinned downloads): the pictures in the session test are a
  synthetic SVG; the set-to-mapping consistency is checked against the committed `map.tsv`, not against built packs.
- The real-dictionary resolution ran against a database seeded from the local JMdict and CC-CEDICT files, not against a
  deployed instance; the Android client was not touched.
