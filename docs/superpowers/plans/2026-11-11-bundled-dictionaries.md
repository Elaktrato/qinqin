# Bundled Starter Dictionaries — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, chosen for this small plan) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship CC-CEDICT, Unihan, JMdict, and KANJIDIC2 compressed in-repo (~24 MB total) with licenses and attribution, teach the importers to read `.gz`/`.zip` sources, and prove a fresh offline seed produces the full Chinese + Japanese starter database.

**Architecture:** The four importers currently `os.Open` a single uncompressed file per pack. Add one shared source-opening helper (`openMaybeGz`, `openZipMembers`) so each importer accepts either the plain file (tests, legacy) or its compressed distribution form (`.gz`, or the multi-file `Unihan.zip`). `plugins/data/<pack>/` then carries the compressed upstream file + manifest + license/attribution; `scripts/fetch-seeds.sh` regenerates exactly that layout. Docker already copies `plugins/data` into the image, so deployed instances seed offline.

**Tech Stack:** Go stdlib `compress/gzip`, `archive/zip`; existing `dict` pipeline; shell script.

**Spec:** `docs/superpowers/specs/2026-11-10-chinese-learning-platform-design.md` — Constraints (seed data, licenses, attribution).

## Global Constraints

- Module `qinqin`; all code under `server/`. No new dependencies (stdlib compression only).
- Every pack directory MUST carry `manifest.json` with `license` + `attribution`, plus `LICENSE` and `ATTRIBUTION.md` files crediting the upstream source with a link.
- Compressed upstream bytes are committed once, unmodified; `fetch-seeds.sh` reproduces the exact layout.
- Plain-file imports must keep working (existing fixtures prove it).
- Conventional commits, at least one per task; work on `feature/bundled-dictionaries`.

## Review Focus

1. **Plain-file imports unchanged** — existing cedict/unihan/jmdict/kanjidic2 fixtures still import; the helper falls back cleanly.
2. **Unihan.zip completeness** — importing from the zip covers all three members (`Unihan_IRGSources.txt`, `Unihan_Variants.txt`, `Unihan_Readings.txt`), not just the first.
3. **Offline fresh seed** — a pristine data dir seeded from the committed packs, with no network and no decompression step, yields full counts for all four sources.
4. **Attribution is real** — each tenant pack has license text + attribution with upstream link, and the registry exposes license/attribution.
5. **Binary integrity** — committed `.gz`/`.zip` files import after `git checkout` (verified by the seed run, not just by presence).

---

### Task 1: Compressed source support in the importers

**Files:**
- Create: `server/internal/dict/source.go`
- Modify: `server/internal/dict/cedict.go` (`readCedictPack`), `unihan.go` (`readUnihanPack`), `jmdict.go` (`readJMdictPack`), `kanjidic2.go` (`readKanjidic2Pack`)
- Test: `server/internal/dict/source_test.go` (plus compressed-fixture cases in the existing importer tests)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `dict.openMaybeGz(path string) (io.ReadCloser, error)` — opens `path`; if it does not exist and `path + ".gz"` does, opens it through `gzip.NewReader` (returns a closer that closes both).
  - `dict.openZipMembers(path string, names ...string) (io.ReadCloser, error)` — opens the zip, requires every named member, concatenates them in order (`io.MultiReader` over member readers) with a closer that closes the archive.
  - Importers try, in order: the plain file via `openMaybeGz`, then their distribution archive (Unihan: `Unihan.zip`; others have no archive).

- [ ] **Step 1: Write failing tests** — `TestOpenMaybeGz` (plain fixture opens; `.gz` variant opens with identical bytes when the plain file is absent); `TestCedictReadsGz` (build a `.gz` of the existing cedict fixture with `gzip.Writer`, import a pack pointing at it, assert the same 3 entries/5 senses); `TestUnihanReadsZip` (build `Unihan.zip` in a temp dir containing `Unihan_IRGSources.txt`, `Unihan_Variants.txt`, `Unihan_Readings.txt` with the fixture lines split across them; assert variant links + radical assignment + kDefinition senses all present); `TestJmdictReadsGz` and `TestKanjidic2ReadsGz` (gzip the existing XML fixtures; assert import counts).

- [ ] **Step 2: Run** `cd server && go test ./internal/dict/ -run 'Gz|Zip'` — FAIL (functions missing).

- [ ] **Step 3: Implement** `source.go` + the four importer read paths. Keep the error text actionable (`no source: tried dictionary.txt, dictionary.txt.gz` / `Unihan.zip lacks member X`).

- [ ] **Step 4: Run** `go test ./... && go vet ./...` — PASS (including all pre-existing plain-fixture tests).

- [ ] **Step 5: Commit** — `feat: read compressed dictionary sources (gz/zip)`

### Task 2: Bundle the real data with licenses

**Files:**
- Modify: `scripts/fetch-seeds.sh` (emit the bundled layout — download compressed files as-is, no decompression; write fixed-version manifests; write license/attribution files)
- Modify: `.gitignore` (stop ignoring the four pack payload files)
- Create (committed binaries + text): `plugins/data/cedict/{manifest.json,dictionary.txt.gz,LICENSE,ATTRIBUTION.md}`, `plugins/data/unihan/{manifest.json,Unihan.zip,LICENSE,ATTRIBUTION.md}`, `plugins/data/jmdict/{manifest.json,jmdict.xml.gz,LICENSE,ATTRIBUTION.md}`, `plugins/data/kanjidic2/{manifest.json,kanjidic2.xml.gz,LICENSE,ATTRIBUTION.md}`

**Interfaces:**
- Consumes: Task 1's compressed readers.
- Produces: the committed starter packs; `scripts/fetch-seeds.sh [dest]` reproducible layout.

- [ ] **Step 1: Update the script** — downloads: `cedict_1_0_ts_utf-8_mdbg.txt.gz` → `cedict/dictionary.txt.gz`; `Unihan.zip` → `unihan/Unihan.zip`; `JMdict_e.gz` → `jmdict/jmdict.xml.gz`; `kanjidic2.xml.gz` → `kanjidic2/kanjidic2.xml.gz`. Manifests keep existing ids/names/licenses/attributions (version: date of download).

- [ ] **Step 2: Add license/attribution files** — `CEDICT/LICENSE` = CC BY-SA 4.0 text + `ATTRIBUTION.md` (CC-CEDICT, MDBG, https://cc-cedict.org); `unihan/LICENSE` = Unicode license v3 text + attribution (Unicode Consortium, https://www.unicode.org/); `jmdict/LICENSE` + `kanjidic2/LICENSE` = CC BY-SA 4.0 text + EDRDG attribution (https://www.edrdg.org/) noting files are unmodified.

- [ ] **Step 3: Run the script and commit the binaries** — verify sizes: cedict ≈ 4.0 MB, Unihan ≈ 8.3 MB, JMdict ≈ 10.6 MB, KANJIDIC2 ≈ 1.5 MB; `git add` them explicitly (no other large artifacts).

- [ ] **Step 4: Commit** — `feat: bundle CC-CEDICT, Unihan, JMdict, KANJIDIC2 starter packs`

### Task 3: Fresh offline seed verification + credits doc

**Files:**
- Create: `docs/sources.md` (credits table: source, what it provides, license, upstream link; plus note on Make Me a Hanzi/Arphic for the web phase)

**Interfaces:**
- Consumes: committed packs (Task 2) + compressed readers (Task 1).
- Produces: verified real-data seed; public credit surface for the repo.

- [ ] **Step 1: Verify offline seed** — `go build -o /tmp/opencode/qinqin ./cmd/qinqin`; `qinqin seed --data /tmp/opencode/qinqin-real --packs plugins/data` with networking disabled for the command (or no downloads involved — script not run); capture per-pack counts + wall time; run `seed` a second time and confirm identical counts (idempotent). Expected magnitude: CEDICT ≈ 124k entries; KANJIDIC2 ≈ 13k characters; Unihan supplies radical/variant/definition rows; JMdict ≈ 200k+ word entries.

- [ ] **Step 2: Smoke the real data** — start `serve` on a temp dir; `qinqin adduser --admin` (or first-user register) then `GET /api/search?q=nihao&lang=zh` and `?q=gakkou&lang=ja`; entry detail shows pinyin+bopomofo (zh) / kana+romaji (ja) and an HSK/JLPT badge where the sample levels reference real entries; `GET /api/dictionaries` lists all four with license+attribution.

- [ ] **Step 3: Write `docs/sources.md`** — table with the four bundled sources + licenses + links; a short "attribution in the app" note (registry fields; UI shows them once the web view lands).

- [ ] **Step 4: Commit** — `docs: starter data sources and licensing credits`
