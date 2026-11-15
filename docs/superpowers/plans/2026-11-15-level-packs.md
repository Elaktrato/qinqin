# Jōyō, 通用规范 and local level packs (issue #42) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The owner always runs plans subagent-driven, but they must say "start" before anyone dispatches an implementer.

**Goal:** Two bundled level packs derived from already-bundled data (`joyo-grades` from KANJIDIC2, `tgh-chars` from Unihan `kTGH`) and a converter that turns a user-prepared TSV (TBCL, curriculum tables) into a local-only pack.

**Architecture:** Node scripts generate ordinary `levels` packs; the server and most of the web app already handle any levels pack. One web change hides `joyo-grades` from the map's "Group by".

**Tech Stack:** Node 24+ ESM scripts with `node:test`; SvelteKit 2 / Svelte 5, vitest; Go 1.26 for the opt-in real-pack seed test. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-level-packs-design.md`.

**Worktree:** `<wt>` = `/home/user/www/github/qinqin/.claude/worktrees/level-packs`, branch `feature/level-packs` from `develop`. Ledger (gitignored): `<wt>/.superpowers/sdd/2026-11-15-level-packs/progress.md`. Run `npm --prefix <wt>/apps/web ci` once.

## Gates

- Web: `npm --prefix <wt>/apps/web run check`, `npm --prefix <wt>/apps/web test`, `npm --prefix <wt>/apps/web run build`.
- Scripts: `node <wt>/scripts/check-sources.mjs <wt>` and `node --test <wt>/scripts/*.test.mjs`.
- Go (as your own user, scratch caches): `docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e GOCACHE=/tmp/gocache -e GOPATH=/tmp/gopath -v <wt>:/src -w /src/server -e GOTOOLCHAIN=auto -e GOFLAGS=-buildvcs=false golang:1.26 sh -c "go vet ./... && go test ./..."`.
- Every task ends green with a commit on `feature/level-packs`, message ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only your files with explicit `git add <paths>`. Never merge or push.

## Global Constraints

- Licence rule: nothing from TBCL, the 2021-withdrawn TOCFL 8000 list or any 课程标准 / textbook is downloaded into a tracked path, committed, or used as a test fixture. Fixtures are hand-written.
- `joyo-grades`: levels `Grade 1`…`Grade 6`, `Secondary` (KANJIDIC2 grade 8); 2,136 kanji; grades 9 and 10 excluded; within a level by KANJIDIC2 `<freq>` (none last), then code point. `license` "CC BY-SA 4.0".
- `tgh-chars`: `Level 1` serial 1–3,500, `Level 2` 3,501–6,500, `Level 3` 6,501–8,105, in serial order; `license` "Unicode License v3"; source `Unihan_OtherMappings.txt` field `kTGH` (`2013:<n>`).
- Manifest names: "Jōyō kanji by school grade", "通用规范汉字表 (2013) levels". Attribution strings verbatim from the spec.
- Generated packs are byte-for-byte reproducible from the bundled inputs.
- Local converter writes only under a directory named `data-local` unless `--force-dir`.

## Review Focus

1. A Unihan line `#\tkTGH` (the header comment) or a value with a leading zero must not create a serial 0 or a bogus character — test with a fixture header line.
2. A TSV with CRLF line endings, a BOM or a trailing blank line converts like a clean one — test.
3. Re-running the generator over existing packs leaves `git status` clean — test writes twice, compares bytes.
4. A user TSV whose level column is empty on some row fails with the line number, not a silent "" level — test.
5. The map still offers `tgh-chars` and all non-hidden schemes when `joyo-grades` is installed, and a user pack that happens to be named "Jōyō…" with another id stays visible — test in `charGroups.test.ts`.

---

### Task 1: Standard level generator (`joyo-grades`, `tgh-chars`)

**Files:**
- Create: `scripts/prepare-standard-levels.mjs`, `scripts/prepare-standard-levels.test.mjs`
- Modify: `scripts/prepare-level-packs.mjs` (export `writePack`; no behaviour change)

**Interfaces:**
- Consumes: `parseKanjidic2(xml) -> Map<literal, {grade, freq, old}>`, `writePack(dir, {manifest, unit, levels, license, attribution, extraFiles})` from `prepare-level-packs.mjs`.
- Produces: `joyoLevels(kanjidic: Map) -> {name: string, entries: string[]}[]`; `parseTgh(text: string) -> Map<char, number>`; `tghLevels(serials: Map) -> {name, entries}[]`; `parseJoyoSet(text) -> Set<char>`; constants `JOYO_NOTICE`, `TGH_NOTICE`; CLI `node scripts/prepare-standard-levels.mjs [<packs-dir>]` (default `plugins/data`).

- [ ] **Step 1: Write failing tests** in `prepare-standard-levels.test.mjs`:
  - `joyoLevels` on a fixture map `{一:{grade:1,freq:2}, 二:{grade:1,freq:undefined}, 誰:{grade:8,freq:undefined}, 伊:{grade:9}, 岡:{grade:4,freq:900}}` → `[{name:'Grade 1',entries:['一','二']},{name:'Grade 4',entries:['岡']},{name:'Secondary',entries:['誰']}]` (empty levels omitted; 伊 absent).
  - `parseTgh("#\tkTGH\nU+4E00\tkTGH\t2013:1\nU+4E42\tkTGH\t2013:3501\nU+77D7\tkTGH\t2013:3500\nU+3447\tkTGH\t2013:6602\n")` → size 4, 一→1; `tghLevels` → `Level 1` [一, 矗(U+77D7)], `Level 2` [乂(U+4E42)], `Level 3` [U+3447]; a duplicate serial or char throws `PackError`.
  - CLI on a temp packs dir holding fixture `kanjidic2/kanjidic2.xml.gz`, `kanjidic2/LICENSE`, `unihan/Unihan.zip` (built in the test with `zip` from fixture `Unihan_OtherMappings.txt`), `unihan/LICENSE`: writes both packs; running twice gives identical bytes; each `manifest.json` has `type` `levels`, the spec's names/licences; `notice` passes `assertValidNotice` (copy the helper from `prepare-level-packs.test.mjs`).
  - Real-data test (skipped when `plugins/data/kanjidic2` is absent): total 2,136; set equals `parseJoyoSet` of the real `kJoyoKanji` values `2010`; `tgh-chars` counts 3,500 / 3,000 / 1,605.
- [ ] **Step 2: Run** `node --test scripts/prepare-standard-levels.test.mjs` — FAIL (module missing).
- [ ] **Step 3: Implement** the module; read the zip member with `execFileSync('unzip', ['-p', zip, 'Unihan_OtherMappings.txt'])`; ignore lines starting with `#`; serial must match `^2013:[1-9]\d{0,3}$`.
- [ ] **Step 4: Run** the test file and `node --test scripts/prepare-level-packs.test.mjs` — PASS.
- [ ] **Step 5: Commit** `feat(scripts): generate Jōyō grade and 通用规范 level packs from bundled data`.

### Task 2: Generate and document the bundled packs

**Files:**
- Create (generated): `plugins/data/joyo-grades/{manifest.json,levels.json,LICENSE,ATTRIBUTION.md}`, `plugins/data/tgh-chars/{…}`
- Modify: `docs/sources.md` (Japanese and Chinese tables, "Level lists" subsections with the spec's evidence and dates), `README.md` ("Bundled data" table, scripts table), `plugins/data/README.md`
- Test: `server/cmd/qinqin` real-pack test (existing `RealPacks`, opt-in)

**Interfaces:** Consumes Task 1's CLI.

- [ ] **Step 1: Run** `node scripts/prepare-standard-levels.mjs` in `<wt>`; then `node scripts/check-sources.mjs .` — FAIL (packs not named in `docs/sources.md`).
- [ ] **Step 2: Add the docs rows** (ids in backticks; evidence table from the spec incl. URLs and "checked 2026-11-15"); re-run `check-sources` — PASS.
- [ ] **Step 3: Extend the real-pack Go test** to assert seed output lines `joyo-grades … 0 unknown forms skipped` and `tgh-chars … 0 unknown forms skipped`; run `QINQIN_REAL_DATA_TESTS=1 go test ./cmd/qinqin -run RealPacks -v` via the Go gate command — PASS. If `tgh-chars` skips characters, record the count and the reason in `docs/sources.md` instead of hiding it.
- [ ] **Step 4: Commit** `feat(data): bundle Jōyō grade and 通用规范汉字表 level packs`.

### Task 3: Hide `joyo-grades` from the map's Group-by

**Files:**
- Modify: `apps/web/src/lib/study/charGroups.ts`
- Test: `apps/web/src/lib/study/charGroups.test.ts`

**Interfaces:** Produces `HIDDEN_GROUPING_PACK_IDS: ReadonlySet<string>` (exported, contains `'joyo-grades'`).

- [ ] **Step 1: Failing tests:** `groupOptions('ja', [joyo{packId:'joyo-grades'}, jlpt{packId:'jlpt-kanji'}, own{packId:'my-joyo', name:'Jōyō kanji by school grade'}])` → keys `grade,freq,strokes,scheme:<jlpt>,scheme:<own>`; `groupOptions('zh', [tgh])` includes `scheme:<tgh>`.
- [ ] **Step 2: Run** `npm --prefix <wt>/apps/web test -- charGroups` — FAIL.
- [ ] **Step 3: Implement:** skip schemes whose `packId` is in the set; update the comment that lists bundled packs.
- [ ] **Step 4: Web gates** — PASS.
- [ ] **Step 5: Commit** `feat(web): keep the Jōyō pack out of the map grouping (the built-in Grade covers it)`.

### Task 4: Local-only TSV converter

**Files:**
- Create: `scripts/prepare-local-levels.mjs`, `scripts/prepare-local-levels.test.mjs`
- Modify: `scripts/check-sources.mjs` (`LOCAL_ONLY_PACKS` += `tbcl-words`, `tbcl-chars`, `cn-curriculum-chars`), `scripts/check-sources.test.mjs` if it pins the list, `docs/sources.md` ("Local-only data": TBCL and curriculum steps; TOCFL 8000 rejected, with the withdrawal evidence), `README.md` scripts table

**Interfaces:**
- Consumes: `writePack` (Task 1 export).
- Produces: `parseLevelTsv(text: string, unit: 'word'|'character') -> {levels: {name, entries: (string|{form, reading})[]}[], droppedZhuyin: number}`; CLI flags `--id --name --language --unit --license --attribution [--version] [--force-dir] <tsv> [<out-dir>]` (default out `plugins/data-local`).

- [ ] **Step 1: Failing tests:** header `level\tform\treading` required (missing `form` → `PackError` naming the header); BOM and CRLF stripped; level order = first appearance; repeated form keeps the first level; `{form:'行', reading:'xíng'}` kept; reading `ㄒㄧㄥˊ` dropped and counted; empty level on line 3 → error containing `line 3`; `unit: 'character'` rejects a two-character form; CLI to a dir not named `data-local` exits non-zero unless `--force-dir`; output `ATTRIBUTION.md` contains "not bundled, local use only" and the input SHA-256; no `LICENSE` written.
- [ ] **Step 2: Run** `node --test scripts/prepare-local-levels.test.mjs` — FAIL.
- [ ] **Step 3: Implement**; zhuyin test `/[㄀-ㄯㆠ-ㆿ]/`; warn once with the count.
- [ ] **Step 4: Run** script tests and `check-sources` — PASS.
- [ ] **Step 5: Commit** `feat(scripts): local-only level pack converter for TBCL and curriculum lists`.

### Task 5: Real-app check, history scan, roadmap

**Files:** Modify `docs/ROADMAP.md` (#42 line: what shipped, what is local-only).

- [ ] **Step 1: Seed a scratch data dir** (never the live `/home/user/qinqin-integration-data`): build the server binary in the Go container, `qinqin seed --data <scratch>/data`, start `qinqin serve` on a free 127.0.0.1 port (check with `ss -ltn`), web build served by it.
- [ ] **Step 2: Check in a headless browser** (playwright-core in the scratchpad): Japanese workspace — entry 誰 shows a badge naming "Jōyō kanji by school grade" and level `Secondary`; `/study` offers the scheme and a `Grade 1` session starts with 80 kanji; `/stats/characters` Group-by has no Jōyō option but has "Grade". Chinese workspace — entry 乂 (U+4E42) shows a badge naming "通用规范汉字表 (2013) levels" and `Level 2`; map grouping by it shows three sections 3,500 / 3,000 / 1,605 (minus any skipped noted in Task 2); Sources lists both with licence and attribution.
- [ ] **Step 3: Local pack check:** hand-write `<scratch>/mini.tsv` (3 rows, own words), run the converter into `<scratch>/data-local`, seed `--packs plugins/data,<scratch>/data-local`, confirm the scheme appears; delete it afterwards. Kill every process you started.
- [ ] **Step 4: History scan** — each prints nothing:
  `git -C <wt> ls-files plugins/data-local`;
  `git -C <wt> log --all --name-only --format= | grep -Ei 'tbcl|curriculum|课程标准|八千|8000'`;
  `git -C <wt> log --all -p -- plugins | grep -E '^\+.*(臺灣華語文能力基準|识字写字教学基本字表)'`.
- [ ] **Step 5: Update ROADMAP**, commit `docs: roadmap — #42 Jōyō and 通用规范 packs bundled, TBCL/curriculum local-only`.

## Risks and notes for the owner

- `tgh-chars` adds a mainland scheme the owner has not seen yet; purge procedure as for HSK if unwanted.
- TBCL licence may change; re-check https://bcoct.naer.edu.tw/TBCL/ and data.gov.tw before any bundling.
- Builder check status is recorded in the hand-off report.
