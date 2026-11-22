# Study batch handoff — 2026-11-22

Issues #131, #132, #133, #110 and #165 (added during the run), built from `develop` on the collection
branch `feature/study-batch`. Each one went spec → plan → test-first build → independent review on the
strongest model → one fix wave → merge, with mutation checks in the reviews. Everything is on `develop` and
pushed; nothing went to `main`, no tag, no release. During the run `main` (the grammar packs, PR #164) was
merged into `develop` (`b5ef7f13`), with the docs kept in their rewritten form and `main`'s facts applied.

## 1. What shipped

| Issue | Item | `develop` merge | Contract |
|---|---|---|---|
| #132 | Card types mixed within a session (fresh seed per session, word types kept apart, Recognise first for new words, due order kept, "Mixed / Grouped by type") | `da752c6c` | `docs/contracts/cards/session-mix.json` |
| #133 | Tatoeba example sentences: tooling, filters, readings, credits, seed integration — **packs not produced** (see §3) | `42738e89` | `docs/contracts/packages/` (empty reading), `server/tools/tatoeba` |
| #110 | `GET /api/events` paged (opt-in; old full answer streamed, byte-identical); **offline caching of event and pull v2 pages fixed** (they were sent `no-store` since the v0.4.0 prep) | `c2842f54` | `docs/contracts/events/page.json`, `sync/pull-page.json` |
| #131 | Back / Z in a study session: change a misclicked grade (last 20 cards); a `review` with `replaces` voids its target everywhere | `754ce5ef` | `docs/contracts/events/review-replace.json` (20 cases + 300 generated) |
| #165 | Language-agnostic lemmatizer: one engine driven by per-language JSON rule tables; Japanese table (contractions, folded te-form helpers, ranking keys, particle-expression boundaries); `/api/segment` matches carry `stem` | this merge | `docs/contracts/lemma/` |

Specs and plans with every Ruling and an Execution record: `docs/superpowers/{specs,plans}/2026-11-22-*.md`.

## 2. What you must check by hand

Nothing was seen in a browser or on a device.

1. **Mixed card types (#132):** a deck session with writing/tone/reverse/cloze on — the types interleave, a
   word's cards are apart, a new word's Recognise comes first; "Grouped by type" in the setup; a reload keeps the
   order, the next session differs.
2. **Change a grade (#131):** grade Again by mistake, press **Z** (or Back), choose Good; the summary, XP and the
   next day's due counts follow Good; Z while typing an answer does not trigger Back; offline the change is queued.
3. **Offline study (#110):** install the app, load a deck, go offline, reload: the study page and the review
   history load from the saved pages (this was broken before).
4. **Reader lemmatizer (#165):** Japanese text with している, しました, しちゃった, 食べてしまった, 読んでる,
   仕事をして帰った — one token on the main verb, the popup and known-word colours follow the verb, furigana
   sits over the kanji only. Note: unprioritised particle expressions such as に基づく, を通して, によれば, に応じて
   now split into particle + verb (a recorded trade-off; tunable in the rule table).
5. **Tatoeba packs (#133):** the one-time build (below), then entry examples, Fill the gap and Build the sentence
   cards in a Chinese and a Japanese workspace, and a sample review of the sentences.

## 3. Open items

- **#133 packs:** this environment cannot reach tatoeba.org (network policy; a change was declined). Steps in
  the #133 comment and `docs/sources.md`: edit `server/tools/tatoeba/pin.json`'s licence statement, then
  `go run ./tools/tatoeba pin --licence-checked <date>`, `go run ./tools/tatoeba build`, review the reports,
  commit `pin.json`, `rules.json` and both packs. #133 stays open for that and your sample review.
- **#176:** ship lemmatizer rule tables as a data pack (`lemma-rules`), so a new language needs no code change.
- Lemmatizer gaps: `ないでください` still splits wrongly; without a frequency pack bare して resolves to 仕手 and
  しかねない splits as し + かねない; the reading-probe hints are table-driven, but the script list is fixed in the
  engine (Hangul or Cyrillic need an engine change).
- Cached old web shells count both reviews of a changed grade until they update (documented).
- On this machine's Node 22, five DOM tests (`BookView.dom`, `AccountSettings.dom`) fail on the untouched base as
  well; they pass under Node 26, which CI uses.

## 4. Gates

On the final collection branch: web check 0 errors, build ok, full vitest under Node 26 12,274 passed;
`gen-api-docs --check`, `check-sources`, script tests ok; full Go run green apart from the sandbox-only
`internal/ai` IPv6 test. CI green on every `develop` merge above.
