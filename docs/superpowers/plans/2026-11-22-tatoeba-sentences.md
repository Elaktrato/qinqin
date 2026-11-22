# Bundled Tatoeba example sentences (issue #133) Implementation Plan

> Steps use checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it, see it fail,
> implement, see it pass.

**Goal:** a Go tool that turns a pinned Tatoeba export into the bundled sentences packs
`zh-sentences-tatoeba` and `ja-sentences-tatoeba` (licence-filtered, quality-filtered, with generated readings,
deterministic), plus the seed integration, checks and credits. The packs themselves are NOT produced here
(Tatoeba is blocked in this environment); the owner runs the documented commands.

**Spec (binding, incl. Rulings):** `docs/superpowers/specs/2026-11-22-tatoeba-sentences-design.md`.

**Branch / worktree:** `feature/sb-sentences`, worktree `/home/user/qinqin/.claude/worktrees/sb-sentences` (`<wt>`).

## Gates

- Go (under the lock, proxies unset, targeted packages per task):
  `cd <wt>/server && flock /tmp/qinqin-go.lock env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u NO_PROXY -u no_proxy GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false sh -c 'gofmt -l . ; go vet ./tools/tatoeba ./internal/sentences ./cmd/qinqin && go test -count=1 -p 2 -timeout 30m ./tools/tatoeba ./internal/sentences ./cmd/qinqin'`
  ONE full `./...` run before the last commit (known env failure: `internal/ai`
  `TestHostnameResolvingToEmbeddedFormIsRefused` only).
- Scripts: `node --test scripts/*.test.mjs`, `node scripts/check-sources.mjs` (exit 0, without the packs).
- Web: no web code changes are planned (the Sources page and sentence views already handle these packs);
  if one becomes necessary, run the full web gates.
- One commit per task, explicit `git add <files>`, message ends with a blank line and exactly
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push. `git status` clean.

## Tasks

### Task 1: optional sentence reading in the importer
- [ ] Test (`internal/sentences`): a pack whose sentence has no `pinyin` (missing, and `""`) imports, stored
  with an empty reading; blank hanzi or translation still fail. Move "no pinyin" out of the invalid table.
- [ ] Implement in `readPack`; update the doc comment and `docs/wiki/Data-pack-format.md` (sentences.json
  shape), `plugins/data/README.md`. Commit `feat(sentences): make a pack sentence's reading optional`.

### Task 2: pin and rules files
- [ ] Tests (`tools/tatoeba`): `loadPin` rejects an archive without URL/member; `requirePinned` refuses an
  empty hash or licence date ("run pin first"); `verify` refuses a hash mismatch and accepts a match;
  `recordPin` fills empty hashes, refuses to replace recorded ones without `repin`; `loadRules` rejects
  unknown fields, `minRunes > maxRunes`, `maxPerWord < 1`.
- [ ] Implement `pin.go`, `rules.go`, commit `pin.json` (URLs, empty hashes) and `rules.json` (defaults).
  Commit `feat(tools): pin and rules files of the Tatoeba sentences tool`.

### Task 3: export readers
- [ ] Hand-made fixture export `testdata/export-src/*.csv` (invented ids, users and sentences) and its archives
  `testdata/export/*.tar.bz2` (built once with tar+bzip2, command in `testdata/README.md`); test that each
  archive's member equals its source, and that the strict column check fails on a 7-column line.
- [ ] Implement `export.go` (open by kind `.tar.bz2`/`.bz2`/plain, TSV rows, `\N`). Commit.

### Task 4: licence and quality filters
- [ ] Tests on the parsed fixture: CC0 kept as CC0 only with matching text; orphan, tagged, negatively
  reviewed, too short/long, deny-listed, untranslated sentences dropped; translation licence/tag checks;
  native preference; near-duplicates collapse to the best-ranked; counts per step.
- [ ] Implement `filter.go`. Commit.

### Task 5: readings
- [ ] Fixture dictionaries `testdata/dict/cedict` and `testdata/dict/jmdict` (hand-written). Tests: zh joined
  tone-marked pinyin with punctuation; ambiguous word → no reading + review entry; default reading applies;
  ja kana-only, inflected (行きました), default (私), ambiguous → none, 来る inflection → none.
- [ ] Implement `readings.go` (segment.Service + lexicon.Store.GetMany). Commit.

### Task 6: linking, cap, deterministic output, report
- [ ] Tests: groups only for linkable words (BestWord), skipWords, `maxPerWord`, coverage; output equals the
  golden packs `testdata/golden/*` (`UPDATE_GOLDEN=1` regenerates) and two builds are byte-identical; the
  report holds the match rate and sizes; manifest notice passes `dict.ValidateNotice`; the pack loads with
  `dict.LoadPack` and imports with `sentences.ImportPack`.
- [ ] Implement `build.go`, `output.go`, `report.go`. Commit.

### Task 7: CLI, download, git-ignored folder
- [ ] Tests with `httptest`: `pin` downloads, records hashes and the export date; `build` refuses unpinned,
  downloads a missing archive, refuses a mismatch, writes the packs via a staging dir.
- [ ] Implement `main.go`, `download.go`; `.gitignore` `/plugins/upstream/`. Commit.

### Task 8: seed integration
- [ ] Tests (`cmd/qinqin`): auto-seed and seed of a root with the fixture dictionaries and the golden
  Tatoeba-shaped packs install both sentence packs after the dictionaries and link their sentences;
  `TestCommittedPackNotices` requires the packs' notice when present, tolerates absence; `internal/sentences`
  parses the bundled packs when present (skip otherwise).
- [ ] Commit `test(seed): Tatoeba sentence packs install with seed and auto-seed`.

### Task 9: credits and docs
- [ ] `scripts/check-sources.test.mjs`: a doc naming a GENERATED pack passes while absent; present, it must
  have a manifest and be named. Implement `GENERATED_PACKS`; `docs/sources.md` "Example sentences";
  wiki `Data-and-licences`, `Admin-data-packs`; "How to produce the packs". Commit.

### Task 10: final gates and Execution record
- [ ] `node --test scripts/*.test.mjs`, `node scripts/check-sources.mjs`, ONE full Go run; record results.

## Execution record

(filled in at the end)
