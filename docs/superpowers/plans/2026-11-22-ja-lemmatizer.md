# Lemmatizer (issue #165) Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it,
> SEE IT FAIL, implement, see it pass. One commit per task.

**Goal:** One language-neutral lemmatizer engine driven by per-language JSON rule tables; Japanese ported
behaviour-identically, then extended with contractions, folded te-form auxiliaries, ながら and the adverbial
く; ranking and segmentation fixes so common verbs win over rare homophones and particle-led expressions;
furigana over the noun of a する compound.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-22-ja-lemmatizer-design.md`.

**Branch / worktree:** `feature/sb-ja-lemma` at `.claude/worktrees/sb-ja-lemma` (`<wt>`), from
`feature/study-batch`.

## Gates

- Go per task (targeted):
  `cd <wt>/server && flock /tmp/qinqin-go.lock env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u NO_PROXY -u no_proxy GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false sh -c 'gofmt -l . ; go vet ./<pkgs> && go test -count=1 -p 2 -timeout 30m ./<pkgs>'`.
  ONE full `./...` at the end (known environment failure: `internal/ai`
  `TestHostnameResolvingToEmbeddedFormIsRefused`).
- Web: `npm --prefix apps/web run check`, targeted `npx vitest run <paths>`; at the end full `test`, `build`
  and the Node 26 vitest run. Exit codes read.
- Commits end with a blank line and exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Tasks

### Task 1 — engine (`internal/lemma`)

- [ ] `lemma_test.go`: decode a synthetic non-Japanese table (toy rules, two classes, a stem predicate,
      chaining, `whole`/`suffix-or-whole`), check `Deinflect` order/reasons/classes, `ClassMatches`
      (tags and prefixes), validation errors (unknown key, unknown class, unknown predicate, bad match,
      maxDepth out of 1..8). Run: fails (no package).
- [ ] Implement `Table`, `Parse`, `Deinflect`, `ClassMatches`, predicates. Pass.
- Commit `feat(lemma): data-driven deinflection engine`.

### Task 2 — Japanese table, parity with the Go rules (`lemma`, `lang`)

- [ ] `lang` parity test: for every prefix (≤ 12 code points) at every offset of the grammar-pack example
      corpus plus every surface in the existing tests, the table engine's output equals the Go rules'
      (form, class, reasons, order). Run: fails (no table).
- [ ] Generate `server/internal/lemma/tables/ja.json` from `buildJaRules` (scratch generator, not
      committed), embed it (`lemma.Builtin`). Pass; existing `lang` tests unchanged.
- Commit `feat(lemma): Japanese rule table ported from the Go rules`.

### Task 3 — seam: Ja on the table, lookup asks the pack (`lang`, `lookup`, `segment`)

- [ ] Tests: `lang` — `For("xx")` with a registered table-only language deinflects; Ja's `ClassMatches` and
      `Hints` come from the table. `lookup` — a table-only language deinflects in lookup (synthetic table),
      the する compound comes from the table's `compounds`. Run: fail.
- [ ] `lang.Deinflector` gains `ClassMatches`, `Hints`; `lang.Ja` delegates to the table; `lang.For` gives a
      table-only language a generic pack with its table; lookup uses `deinflector.ClassMatches` and the
      table's compounds. Delete `buildJaRules`, the Go class table and the parity test. Pass `lang lemma
      lookup segment`.
- Commit `refactor(lang): Japanese deinflection runs on the rule table`.

### Task 4 — contract `docs/contracts/lemma/` (`lemma`)

- [ ] README, `ja.rules.json` (copy), `deinflect.json` (today's behaviour), Go test decoding both plus the
      byte-identity check. Run: fails until the files exist; pass.
- Commit `docs(contracts): lemma rule table format and fixtures`.

### Task 5 — new Japanese forms (`lemma` table)

- [ ] Add fixture cases (contractions, auxiliaries, ながら, adverbial く, depth 5, rejects). Run: fail.
- [ ] Add rules to `ja.json` and the contract copy; `maxDepth` 5. Pass; existing tests updated only where
      the depth-4 test pinned the old limit (recorded).
- Commit `feat(lemma): Japanese contractions, te-form auxiliaries, ながら, adverbial く`.

### Task 6 — ranking keys (`lookup`)

- [ ] Tests: しました → する before 揣摩 (no frequency); しよう → する before 使用; すれば → する before the
      expression; ください and しかし stay; した without frequency → する (old test updated, Ruling). Fail.
- [ ] `kanaFit` and `yields` keys in `rank.go`, hints from the pack. Pass `lookup segment`.
- Commit `feat(lookup): kana fit and expression keys rank common verbs first`.

### Task 7 — segmentation boundary and segment fixtures (`segment`)

- [ ] `segment.json` fixture (mini lexicon, texts → tokens) and the decoding test; a case for 仕事をしている
      and the kept にとって. Fail.
- [ ] Boundary rule in `Segment`. Pass.
- Commit `feat(segment): particle-led expressions never cut a longer word`.

### Task 8 — `stem` and furigana (`segment`, web)

- [ ] Go: `Match.Stem` set for a compound stem match. Web: `smart-readings.json` case with `stem`;
      `smartReadings.test.ts` fails. Fail.
- [ ] `Match.Stem`; web `SegmentMatch.stem`, `smartReadings.ts` aligns against `stem ?? lemma`. Pass.
- Commit `feat(reader): furigana over the noun of a する compound`.

### Task 9 — docs

- [ ] `docs/wiki/Reader.md`, `docs/wiki/Searching-and-entries.md`, `docs/contracts/README.md`,
      `docs/contracts/overview.md`, `docs/contracts/reader/README.md`.
- Commit `docs: lemmatizer in the wiki and contracts index`.

### Task 10 — real-app check, measurements, final gates

- [ ] Issue table and 30+ sentences before/after (JMdict only, and JMdict + Jiten frequency), corpus
      timing before/after, token diff over the corpus reviewed; Execution record; full gates.
- Commit `docs(plan): lemmatizer execution record`.

## Execution record

(empty)
