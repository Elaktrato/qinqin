# Lemmatizer rule tables as a data pack (#176) Implementation Plan

> Steps use checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it, see it fail, implement, see
> it pass. One commit per task; every message ends with a blank line and
> `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Goal:** a `lemma-rules` data pack gives a language lemmatization without a code change: validated and
bounded, hot-reloaded, served as a data package, credited, listed in Settings → Data; the bundled Japanese
table also ships as the seed pack `ja-lemma`.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-23-lemma-rules-pack-design.md`.

**Branch / worktree:** `feature/hb-lemma-pack` (from `feature/hardening-batch`),
`/home/user/qinqin/.claude/worktrees/hb-lemma-pack` (`<wt>`).

## Gates

- Go (under `flock /tmp/qinqin-go.lock`, proxy variables unset, `GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false`):
  targeted packages per task; `gofmt -l` prints nothing; one full `./...` at the end (known environment
  failure: `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused`). `-race` on `internal/lemma` and
  `internal/lemmapack` (new shared state).
- Web: targeted vitest per task; at the end `check`, `test`, `build` and the Node 26 vitest.
- `src/lib/contractsDocs.test.ts` and `src/lib/wikiDocs.test.ts` after every contract or wiki change.

## Tasks

### Task 1 — engine limits, candidate bound, installed overlay (`internal/lemma`)

- [ ] Tests: each limit of the spec table rejected by `Parse` (one over) and accepted at the limit; an
  explosive table (many rules on one suffix, chaining into themselves, depth 8) returns exactly
  `MaxCandidates` candidates, the first ones in output order; the Japanese table stays ≤ 16 on every ≤ 12
  code-point substring of the contract fixtures; `SetInstalled` wins over `Register` and the built-in,
  `SetInstalled(nil)` restores, `Languages` is the union — FAIL.
- [ ] Implement. PASS (`./internal/lemma/... ./internal/lang/... ./internal/lookup/... ./internal/segment/...`,
  `-race` on lemma). Contract README: "Limits" and the candidate bound. Commit
  `feat(lemma): table limits, a candidate bound and an installed-table overlay (#176)`.

### Task 2 — migration 043 `lemma_rule_packs`

- [ ] `migrate_043_test.go`: columns, defaults, NOT NULLs, primary key — FAIL.
- [ ] `043_lemma_rules.sql` (pure SQL; no Go step). PASS (`./internal/db/...`). Commit
  `feat(db): lemma_rule_packs registry (#176)`.

### Task 3 — pack type row, manifest, store and reload (`packtype`, `dict`, `lemmapack`, `packs`)

- [ ] Tests: `lemmapack` (spec "Tests"), dict manifest (`rules-json` only for `lemma-rules`, one language),
  packs (import/list/uninstall through `packs`). The table tests (`TestEveryPackTypeHasItsOperations`,
  standard columns, contract, web pack types) fail once the row exists — FAIL.
- [ ] Implement the row (after strokes), `FormatRulesJSON`, `internal/lemmapack`, the `operations` entry and
  `notFound`, `pack-types.json` + packages README, web `PackType`, `PACK_TYPES`, `PACK_TYPE_LABELS`, i18n key,
  `TYPE_ORDER`. PASS (Go targeted + web packTypes/packsView tests). Commit
  `feat(packs): lemma-rules pack type with validated, hot-reloaded tables (#176)`.

### Task 4 — data package `lemma-rules`

- [ ] Tests: datapkg table test (fails until `Types`/`typeDefs`/idPattern), a build test reading `lemma_rules`
  back byte-identical; contract `schemas.json`/`manifest.json` cases; web `packages.ts` parser — FAIL.
- [ ] Implement. PASS. Commit `feat(datapkg): lemma-rules packages (#176)`.

### Task 5 — upload review and hot reload through the API

- [ ] Tests: staged upload of a bad table → 400 naming `rules.json`; a second pack for a language → 400 naming
  the installed pack; install via the staged flow then `/api/segment` uses the new table, uninstall restores
  the built-in (no restart) — FAIL.
- [ ] Implement the review check (`lemmapack.CheckPack` with the DB). PASS. Commit
  `feat(api): review lemma-rules uploads; segmentation follows installs (#176)`.

### Task 6 — bundled `ja-lemma` seed pack and startup sync (`plugins/data`, `cmd/qinqin`)

- [ ] Tests: `plugins/data/ja-lemma/rules.json` byte-identical to the embedded table; seed installs it; serve's
  sync installs when absent, refreshes when changed, leaves an uninstalled one; `serve` reloads the overlay
  before listening — FAIL.
- [ ] Pack files, `docs/sources.md`, `plugins/data/README.md`; `syncBundledLemmaPacks`; reload in `serve`. PASS
  (incl. `node scripts/check-sources.mjs`). Commit `feat(seed): ship the Japanese rule table as the ja-lemma pack (#176)`.

### Task 7 — credits: `GET /api/lemma-packs` and the Sources section

- [ ] Tests: route public, listed, token rule pinned; route-walk and PWA fixtures; web `lemmaSection` unit and
  Sources dom test — FAIL.
- [ ] Implement; regenerate fixtures and `docs/wiki/API-Routes.md`. PASS. Commit
  `feat(sources): credit installed lemmatizer rule packs (#176)`.

### Task 8 — docs

- [ ] Contract READMEs (lemma "Rule-table packs", packages ids table), wiki Data-pack-format and
  Admin-data-packs, Reader note; docs tests green. Commit `docs: lemma-rules packs (#176)`.

### Task 9 — real-app check, full gates, Execution record

- [ ] Build from a scratch copy; serve on a free random high 127.0.0.1 port; seed; upload a toy-language
  table and a modified Japanese table; check `/api/segment` before/after install and uninstall; the
  catalogue lists `lemma-rules.*`; kill and clean up.
- [ ] Full Go `./...`, web `check`, `build`, Node 26 vitest. Execution record. Commit
  `docs(plan): lemma-rules pack execution record (#176)`.

## Execution record

(filled in at the end)
