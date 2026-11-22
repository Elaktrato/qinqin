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

Built in one session by one implementer (no per-task subagents, no separate review). **The packs were not
produced**: downloads.tatoeba.org, tatoeba.org and creativecommons.org are blocked here (proxy 403) and the owner
declined to open them. Everything else is built; the owner runs the command sequence below.

| Task | Commit | Test-first evidence / deviation |
|---|---|---|
| Spec + plan | `d4e25a60` | — |
| 1 Optional reading | `11e368c3` | `TestImportAcceptsSentencesWithoutReading` failed ("needs a hanzi, pinyin, and translation"), then passed; "no pinyin" moved out of the invalid table. |
| 2 Pin and rules | `36038081` | Build failure (undefined `Pin`, `loadRules`), then pass. |
| 3 Export readers | `db9f3451` | Build failure (undefined `readRows`), then pass. Deviation: `export.go` was written before the test run and held outside the package until the failing run. Fixture archives built once by `testdata/make-export.sh` (GNU tar + bzip2) and committed. |
| 4 Filters | `6abce0d3` | Build failure (undefined `filterLanguage`), then all filter tests passed on the first implementation run. |
| 5 Readings | `6f44cce7` | Build failure, then 2 real failures (the fixture rules carry the shipped default 今日 → きょう, so the test case moved to the no-defaults analyzer; ーを filed as a word → `word()` now tries only the entry's own forms/readings/headword and honours skipWords on all of them), then pass. Implementation written before the failing run, held aside (as in Task 3). |
| 6 Build, output, report | `74f1a583` | Build failure (undefined `buildConfig`, `cc0Text`), then everything but the golden tests passed; golden packs generated with `UPDATE_GOLDEN=1`, reviewed by eye (listed in the commit), then all passed. |
| 7 CLI and download | `3e7a4cf0` | Build failure (undefined `run`), then pass (httptest TLS server: pin records the fixture hashes and the Last-Modified date; a changed upstream needs `--repin`; build refuses unpinned before any request; a tampered archive stops the build and writes nothing). |
| 8 Seed integration | `4412cd6b` | Seed/auto-seed tests passed after a wrong expected row count (13, not 14: the importer counts entry × sentence once) — they verify existing behaviour, no code change was needed (sentences are type order 3; absent packs are simply absent). `TestCommittedPackNotices` failed (generated packs "not found"), then tolerated absence. Checked once with the golden packs copied into `plugins/data` (removed again): notice test and `TestBundledTatoebaPacksParse` passed, and check-sources then demanded the docs rows. |
| 9 Credits and docs | `71a52128` | `check-sources.test.mjs` failed (no `GENERATED_PACKS` export), then 25/25 passed. Wiki doc tests (`wikiDocs`, `readmeDocs`) passed. |
| 9b Real-dictionary refinement | `e8cc00e1` | A run of the tool over the real `plugins/data/jmdict` (fixture export) gave readings for 2 of 7 Japanese sentences and junk kana groups; tests for `preferCommonReadings` and kana-token filing failed (undefined field), then passed after a fixture fix (both readings of 私/今日/行く marked common). Spec gained two Rulings. |
| 10 Gates, record | (this commit) | see below; also `Project-layout` wiki row. |

**Gates (final):** `node --test scripts/*.test.mjs` exit 0 (131 tests: 130 pass, 1 skipped — the font-pack
build needs `npm --prefix scripts/fonts ci`, pre-existing); `node scripts/check-sources.mjs` exit 0 without the
packs (and, in a temporary check, it correctly demanded docs rows when packs were present, before Task 9);
full Go run (`gofmt -l .` empty, `go vet ./...` clean, `go test -count=1 -p 2 ./...`): 46 packages ok, 1 FAIL — only the known environment failure `internal/ai` `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6 sockets here). Web: no web code changed; `npx vitest run src/lib/wikiDocs.test.ts src/lib/readmeDocs.test.ts`
passed (docs only), the full web suite was not run.

**Real-dictionary smoke (not a pack):** the tool over the committed CC-CEDICT and JMdict with the fixture export,
`--root ..`: CEDICT import 27 s, JMdict 60 s; segmentation measured at about 1.4 ms (zh) and 3.3 ms (ja) per
sentence per worker. Estimated full run on the real export: tens of minutes (not measured; export size unknown).

**Owner commands (from `server/`, with access to downloads.tatoeba.org):**

```sh
# 1. re-read https://tatoeba.org/en/downloads and https://tatoeba.org/en/terms_of_use;
#    write what they state into licence.statement of server/tools/tatoeba/pin.json
go run ./tools/tatoeba pin --licence-checked <YYYY-MM-DD>
go run ./tools/tatoeba build
# 2. review ../plugins/upstream/tatoeba/{report,review,sample}-*.{txt,tsv}; tune tools/tatoeba/rules.json; rebuild
cd .. && node scripts/check-sources.mjs
(cd server && go test ./internal/sentences ./cmd/qinqin ./tools/tatoeba)
git add server/tools/tatoeba/pin.json server/tools/tatoeba/rules.json plugins/data/zh-sentences-tatoeba plugins/data/ja-sentences-tatoeba
```

Keep `plugins/upstream/tatoeba/*.tar.bz2`: Tatoeba overwrites its export weekly; byte-for-byte re-creation needs
the pinned archives.

**Not verified:** the export file names, member names and column layouts (from documentation/memory; the strict
column check fails loudly if wrong); that every sentence in `sentences_detailed` is CC BY 2.0 FR and the CC0 file's
semantics; Tatoeba's requested attribution wording; tag names (`@needs native check` …) and that skill 5 means
native; the real match rate, readings share, pack sizes, clone/image growth and `qinqin seed` time; whether the
packs fit comfortably in the repository with `maxPerWord` 5 (the report shows sizes; lower the cap if needed);
entry examples, cloze and word-tile cards in a running app with the real packs (the server path is tested with the
golden packs; no browser/app run was done). Known limitations: Chinese single-character words are character
entries and get no pack sentences (existing importer behaviour); Japanese segmentation is the server's (an
expression such as 今日は can win over 今日 + は).
