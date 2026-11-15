# Pronunciation audio packs (issue #43) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The owner always runs plans subagent-driven, but they must say "start" before anyone dispatches an implementer.

**Goal:** Play buttons for word/character pronunciation in the entry view and after reveal in study, fed by `audio` packs (Kanji alive bundled into the Docker image, Commons/Lingua Libre local-only) with device-voice fallback.

**Architecture:** A new `audio` pack type imported by `qinqin seed` into content-addressed blobs under the data dir plus an `audio_clips` table; `internal/audio` resolves an entry to term clips or a Mandarin syllable sequence; signed-in routes stream immutable clips. The web adds a shared player, a `PlayButton`, card integration and settings.

**Tech Stack:** Go 1.26 stdlib (net/http `ServeContent`, modernc SQLite); SvelteKit 2 / Svelte 5, vitest; Node 24+ scripts; POSIX sh + curl + sha256sum + unzip for the fetch script. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-15-audio-packs-design.md`.

**Worktree:** `<wt>` = `/home/user/www/github/qinqin/.claude/worktrees/audio-packs`, branch `feature/audio-packs` from `develop`. Ledger (gitignored): `<wt>/.superpowers/sdd/2026-11-15-audio-packs/progress.md`. Run `npm --prefix <wt>/apps/web ci` once.

## Gates

- Web: `npm --prefix <wt>/apps/web run check`, `npm --prefix <wt>/apps/web test`, `npm --prefix <wt>/apps/web run build`.
- Go (own user, scratch caches): `docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e GOCACHE=/tmp/gocache -e GOPATH=/tmp/gopath -v <wt>:/src -w /src/server -e GOTOOLCHAIN=auto -e GOFLAGS=-buildvcs=false golang:1.26 sh -c "go vet ./... && go test ./..."`; race for touched packages: `go test -race ./internal/audio/... ./internal/api/...`.
- Scripts: `node <wt>/scripts/check-sources.mjs <wt>`, `node --test <wt>/scripts/*.test.mjs`.
- Every task ends green with a commit on `feature/audio-packs`, message ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; explicit `git add <paths>`; never merge or push.

## Global Constraints

- No audio file, `ka_data.csv`, Commons API dump or zip is ever committed. Test clips are generated in temp dirs by the tests (tiny valid Ogg/MP3 headers or a synthesised tone), test JSON fixtures are hand-written imitations of the Commons API shape.
- Downloads go only to gitignored `plugins/data-audio/` (Kanji alive) or `plugins/data-local/` (Commons tool) or a scratch dir. Add `/plugins/data-audio/` to `.gitignore` in Task 7.
- Kanji alive pins: repo commit `e1e24d39fc43e839948a8c7e99743b0994dedad5`; zip `https://media.kanjialive.com/examples_audio/audio-opus.zip`, 68,687,036 bytes; record its SHA-256 in the script on the first maintainer download (Task 7 step), and refuse on mismatch thereafter.
- Manifest: `type` `audio`, `format` `audio-index`; files `.opus`/`.ogg` → `audio/ogg`, `.mp3` → `audio/mpeg`; each ≤ 2 MiB; magic `OggS` or `ID3`/`0xFFEx` frame sync.
- Commons allow-list (`LicenseShortName`, case-insensitive): `CC0`, `Public domain`, `CC BY 2.0`…`CC BY 4.0`, `CC BY-SA 2.0`…`CC BY-SA 4.0`, including national ports such as `CC BY 2.0 fr`, `CC BY-SA 2.0 uk`. Anything else is skipped and counted.
- Clips: `GET /api/audio/clips/<sha256>.<ext>` (route pattern `{file}`), signed-in only, `Cache-Control: private, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`. `/api/audio-packs` and `/api/audio-packs/{id}/credits` are public.
- Settings keys (workspace settings): `audioAutoplay` (default `false`), `audioDeviceVoice` (default `true`).
- Play buttons on cards appear only after reveal/answer. Button label `Play pronunciation`.

## Review Focus

1. A pinyin reading with neutral tone, ü or an apostrophe (`lǜ`, `ma`, `nǚ'ér`, `Xī'ān`) must map to `lv4`, `ma5`, `nv3 er2`, `xi1 an1`, and a space-free reading (`zhōngguó`) must split — test `ToNumbered`.
2. Re-seeding a pack with one clip removed deletes its blob only when no other pack references the same hash — test with two packs sharing a file.
3. A request for `/api/audio/clips/<sha>.mp3` when the stored ext is `ogg`, a `..` path or uppercase hex → 404, never a file outside the store — test.
4. Pressing play twice quickly or navigating away mid-sequence must not overlap sounds — player test with fake audio elements.
5. A browser without `speechSynthesis` or without a zh/ja voice and no clip shows no button (not a dead one) — PlayButton test.

---

### Task 1: `pinyin.ToNumbered`

**Files:** Modify `server/internal/pinyin/pinyin.go`; Test `server/internal/pinyin/pinyin_test.go`.

**Interfaces:** Produces `func ToNumbered(s string) ([]string, error)` — one lowercase numbered syllable per syllable (`nǐ hǎo` → `["ni3","hao3"]`, ü as `v`, neutral tone `5`). `parseAll` splits on whitespace only (`strings.Fields`), so add an unexported `splitSyllables(token string) []string`: split on apostrophes, then greedy longest prefix that `parse` accepts (max 6 letters plus one tone mark), backtracking one step when the rest fails (`xian` alone stays one syllable; `Xī'ān` is split by its apostrophe). `ToNumbered` = `Fields` → `splitSyllables` → `parse` → numbered. `parseAll` and `ToBopomofo` are not changed.

- [ ] **Step 1: Failing table test** `TestToNumbered`: `nǐ hǎo`→`ni3 hao3`; `lǜ`→`lv4`; `ma`→`ma5`; `nǚ'ér`→`nv3 er2`; `Xī'ān`→`xi1 an1`; `zhōngguó`→`zhong1 guo2`; invalid `xyz` → error. Erhua (`wánr`): the first version pinned today's behaviour (an error). Review fix: an erhua r, alone (CC-CEDICT's `r5`) or after a syllable before or without a tone (`diǎnr`, `huàr`, `hua4r`, `zhe4r`), becomes the syllable `er5` (`yi1 dian3 r5` gives `yi1 dian3 er5`); `parseAll` and `ToBopomofo` are still unchanged.
- [ ] **Step 2: Run** the Go gate with `-run TestToNumbered ./internal/pinyin` — FAIL.
- [ ] **Step 3: Implement** `splitSyllables` and `ToNumbered` as above.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(pinyin): numbered syllables for audio keys`.

### Task 2: Audio manifest type, index parser and reading keys

**Files:** Modify `server/internal/dict/manifest.go` (+ tests); Create `server/internal/audio/index.go`, `index_test.go`.

**Interfaces:** Produces `dict.TypeAudio = "audio"`, `dict.FormatAudioIndex = "audio-index"`; `audio.Row{Kind, Form, Reading, File, License, Attribution, Source string}`; `audio.ParseIndex(r io.Reader, m dict.Manifest) ([]Row, error)`; `audio.ReadingKey(lang, reading string) string` (ja → hiragana via the kana fold `toHiragana` moved from `internal/lookup/frequency.go:156` into `internal/lang` as exported `lang.ToHiragana`, lookup updated to use it; spaces removed; zh → joined `ToNumbered`, e.g. `ni3hao3`; unparsable → `""`).

- [ ] **Step 1: Failing tests:** manifest with `type: audio, format: audio-index` validates; unknown-type message lists `audio`. `ParseIndex`: header `kind\tform\treading\tfile\tlicense\tattribution\tsource` required; `kind` ∈ {term, syllable}; `syllable` with a non-empty form or a zh-invalid key (`ni6`) rejected; `file` must be `audio/<name>.(opus|ogg|mp3)` with no `..`; empty license inherits the manifest's, but manifest license `per file` + empty row license → error naming the line; `syllable` rows in a `ja` pack rejected. `ReadingKey('ja','カゼ')` = `かぜ`; `ReadingKey('zh','nǐ hǎo')` = `ReadingKey('zh','ni3 hao3')` = `ni3hao3`; `ReadingKey('zh','xyz')` = `""`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(audio): audio pack manifest type and index parser`.

### Task 3: Migration 029 and `audio.Import`

**Files:** Create `server/internal/db/migrations/029_audio.sql`, `server/internal/audio/import.go`, `import_test.go`, `store.go`.

**Interfaces:**
- Consumes: `ParseIndex`, `ReadingKey` (Task 2); the import stores `reading_key`.
- Produces: `audio.Import(ctx context.Context, db *sql.DB, pack dict.Pack, storeDir string) (ImportResult, error)` with `ImportResult{Clips, Skipped int}`; `audio.BlobPath(storeDir, sha, ext string) string` = `<store>/<sha[:2]>/<sha>.<ext>`; tables per the spec.

- Ruling: the migration is **029**, not 026: grammar took 026 on develop and the sibling worktrees hold 027 (pack-management) and 028 (core-stats). Whichever branch merges later renumbers its file (and `audio_packs` carries `deleted_at`/`updated_at` like `grammar_packs`, so the plugin listing code treats it the same way). The spec's "026_audio.sql" reads 029 accordingly.
- Ruling: `ImportResult.Skipped` counts term rows whose reading yields no key (an unparsable zh pinyin reading); a missing, oversize or wrong-magic file fails the whole import.
- [ ] **Step 1: Failing tests** (temp DB via the existing test helper, temp store): import of a 2-row pack copies 2 blobs, rows carry sha/bytes/licence; same file twice → one blob; magic mismatch (`.ogg` holding `ID3`) → error, nothing written; file > 2 MiB → error; re-import with one row removed deletes that blob; two packs sharing a blob, removing it from one keeps the blob (Review Focus 2); blobs are written via temp + rename (no partial file left after an injected copy error).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (transaction per pack; GC after commit: blobs of this pack's old hashes not referenced by any row).
- [ ] **Step 4: Run** with race — PASS. **Step 5: Commit** `feat(audio): import audio packs into a content-addressed store`.

### Task 4: `Resolve`

**Files:** Create `server/internal/audio/resolve.go`, `resolve_test.go`.

**Interfaces:** Consumes `ReadingKey` (Task 2) and the tables of Task 3. Produces `audio.Clip{SHA, Ext, PackID, License, Attribution, Source string}`; `audio.Resolution{Terms []Clip; Syllables [][]Clip /* one entry per reading passed, in order; nil for a reading whose sequence is incomplete; always nil for ja */}`; `audio.Resolve(ctx, db, lang, written string, readings []string) (Resolution, error)`.

- [ ] **Step 1: Failing tests:** ja term match via katakana reading `カゼ` against row `風/かぜ`; zh term `你好/nǐ hǎo` matches row reading `ni3 hao3`; zh entry without term clip but syllables `ni3`,`hao3` present → `Syllables[0]` len 2 in order; one syllable missing → `Syllables[0] == nil`; character 行 with readings `xíng`,`háng` and clips for both → `Syllables` len 2, each len 1; ja never returns syllables; packs in import order.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(audio): resolve entries to clips or syllable sequences`.

### Task 5: Seed wiring

**Files:** Modify `server/cmd/qinqin/seed.go`, `seed_test.go`, `packcheck.go` (audio packs: `audio_packs` table).

**Interfaces:** `importOrder[dict.TypeAudio] = 5` (Ruling: grammar already holds 4; audio refers to entries only at resolve time, any order after dictionaries works); default roots `plugins/data`, then `plugins/data-audio` if it exists, then `plugins/data-local` if it exists; signatures become `seed(ctx context.Context, sqlDB *sql.DB, dataDir string, roots []string, out io.Writer) error` and `importPack(ctx, sqlDB, dataDir string, pack dict.Pack)`; update every caller (the seed command and all `seed_*_test.go`); `importPack` calls `audio.Import(ctx, sqlDB, pack, filepath.Join(dataDir, "audio"))` and prints `N clips`.

- Ruling: like `grammar`, the new pack type is also handled by the plugin listing code: `plugins.audioPlugins` (type `audio`, active packs of `audio_packs`) in `ListFor`, and `plugins.Exists`; there is no built-in feature manifest (an audio pack is data, not a feature plugin). `Resolve` computes syllable sequences for every zh entry, also when term clips exist (polyphonic characters need one per reading).
- [ ] **Step 0:** add `/plugins/data-audio/` to `.gitignore`, and `plugins/data-local` and `plugins/data-audio` to `.dockerignore` (restricted data never enters a build context; the image fetches its own copy in Task 7).
- [ ] **Step 1: Failing tests:** seed over a temp root with a generated audio pack prints `<id> audio 2 clips`; default-roots test includes `data-audio` when present; packcheck warns on a changed audio manifest licence.
- [ ] **Step 2–4:** FAIL → implement (pass the data dir into `importPack`) → PASS. **Step 5: Commit** `feat(seed): import audio packs`.

### Task 6: API routes

**Files:** Create `server/internal/api/handlers_audio.go`, `handlers_audio_test.go`; Modify `server/internal/api/api.go`, `README.md` (API table, body limits).

**Interfaces:** Routes from the spec; register the clip route as `GET /api/audio/clips/{file}` (a ServeMux wildcard must be a whole segment) and parse `file` with `^([0-9a-f]{64})\.(opus|ogg|mp3)$` in the handler. JSON clip: `{"url":"/api/audio/clips/<sha>.<ext>","packId","license","attribution","source"}`. `POST /api/audio/resolve` body ≤ 16 KiB, ≤ 200 ids, else 413/422.

- Ruling: the JSON `syllables` is `[[Clip]|null]|null` (one slot per pinyin reading of the entry, aligned with `Resolution.Syllables`; `null` for non-zh), not the flat `[Clip]` the spec sketched; Tasks 9 and 10 (`AudioResolution.syllables`, `Readings.audioFor` index) follow this shape. The credits response is JSON `{total, offset, limit, clips}` and shows the stored `reading_key` as `reading`.
- Ruling (review fix): `audio.Uninstall(ctx, db, packID, storeDir)` soft-deletes the pack, deletes its clip rows and removes the blobs no remaining row references, through the same `collectBlobs` refcount rule Import uses; an unknown or already removed pack is `ErrPackNotFound`. Pack-management will call it with its own store dir when it merges. Storing a blob now hashes what it copies and verifies size, hash and magic after the copy, and `Resolve` looks up each distinct syllable once and at most 64 per call (later readings get no sequence).
- [ ] **Step 1: Failing tests:** unauthenticated clip/entry/resolve → 401; clip 200 with `Content-Type: audio/ogg`, the cache and nosniff headers; `Range: bytes=0-3` → 206 `OggS`; wrong ext, uppercase hex, unreferenced hash, `..` → 404 (Review Focus 3); entries/{id} for unknown id 404; resolve with 201 ids → 422; `/api/audio-packs` public with `clipCount`; credits paging `limit` capped at 500.
- [ ] **Step 2–4:** FAIL → implement → PASS (race). **Step 5: Commit** `feat(api): audio resolve, clip streaming and audio pack credits`.

### Task 7: Kanji alive pack: fetch, index, Docker

**Files:** Create `scripts/fetch-audio-kanjialive.sh`, `scripts/prepare-audio-kanjialive.mjs`, `scripts/prepare-audio-kanjialive.test.mjs`; Modify `Dockerfile` (stage `audio` `FROM alpine:3.22` with `apk add --no-cache curl unzip nodejs`, `ARG WITH_AUDIO=1`; the stage always runs `mkdir -p /out` so `/opt/qinqin/audio` exists even with `WITH_AUDIO=0`, as `findPacks` errors on a missing root; `COPY --from=audio /out /opt/qinqin/audio`; `QINQIN_PACKS=/opt/qinqin/packs,/opt/qinqin/audio`), `.github/workflows/build.yml` (no change to args: release images get audio; note the 69 MB fetch per build in the PR), `scripts/check-sources.mjs` (new `FETCHED_PACKS = ['kanjialive-audio']`, accepted like `LOCAL_ONLY_PACKS` when docs name them) and its test, `docs/sources.md` ("Audio" section with the spec's evidence table), `README.md`.

Fetch inputs (all pinned in the script; SHA-256 recorded on the first maintainer run, Step 5): `https://raw.githubusercontent.com/kanjialive/kanji-data-media/e1e24d39fc43e839948a8c7e99743b0994dedad5/language-data/ka_data.csv`, `…/e1e24d39fc43e839948a8c7e99743b0994dedad5/LICENSE.md`, `https://media.kanjialive.com/examples_audio/audio-opus.zip`, and the CC BY 4.0 legal code `https://creativecommons.org/licenses/by/4.0/legalcode.txt` (written as the pack's `LICENSE`).

**Interfaces:** `prepare-audio-kanjialive.mjs <ka_data.csv> <unzipped-dir> [<out>]` (default `plugins/data-audio/kanjialive-audio`); exports `exampleRows(csvText) -> {kname, form, reading, suffix}[]` (n-th example ↔ suffix `a`…`l`, form/reading split from `一年生（いちねんせい）`, する-verbs kept as written).

- Ruling (checked against the real data, 2026-11-15): Kanji alive's top-level README does not state the file naming, but `examples-audio/README.md` does (suffix `a` to `l` in the order of the readings, `_06_` constant; its SHA-256 is pinned in the fetch script); the data confirms it: `<kname>_06_<a..l>.opus`, the n-th `examples` entry being the n-th suffix. 10,156 example words, 10,156 files (the README's "10187" is not what the zip holds), every kanji has exactly as many files as examples, and file size correlates with reading length at 0.78 (0.21 when rotated within a kanji, about 0 shuffled). The mapping stands; listening is an owner to-do (docs/sources.md, "Audio").
- Ruling: the checksums of `ka_data.csv`, `LICENSE.md` and the zip (`b3ee4c74...6338ef`) are pinned in the script (first maintainer download done); the CC BY 4.0 legal code is only title-checked and its hash recorded in `ATTRIBUTION.md`, so a typo fix at creativecommons.org cannot break image builds. The build fails unless exactly 10,156 clips are found with none skipped. The generator writes the snapshot date (`2026-09-04`, the zip's Last-Modified) as the pack version and refuses an output under `plugins/data`.
- Ruling (review fix): the Dockerfile `audio` stage exposes every pin as an optional build arg (`KANJIALIVE_*`, empty = the script default) and a new `audio-stage` workflow builds only that stage on PRs touching the Dockerfile, workflows or audio scripts and weekly, so a break shows before a release; `WITH_AUDIO=0` is the documented fallback; the docs now say 10,156 clips (the README's 10,187 is not what the zip holds), Node 22 or newer, and that a warm layer cache skips the download. A mirror (`KANJIALIVE_ZIP_URL`) is documented, not built.
- Ruling (review fix): the pack credits Kanji alive with Harumi Hibino Lory & Arno Bosse (from the publisher's credits page, which lists them as project director and assistant; the repository's licence names only "Kanji alive"), links the CC BY 4.0 licence in ATTRIBUTION, manifest notice and the Sources page, marks `index.tsv` as derived from `ka_data.csv`, and shows the per-recording credit as visible text on the entry page and under a revealed study card.
- [ ] **Step 1: Failing tests** on a hand-written 2-kanji CSV in the real column layout: rows, suffixes, file names `jutsu-no(beru)_06_a.opus`; a missing audio file is skipped and counted; manifest `license` `CC BY 4.0`, attribution "Kanji alive (https://kanjialive.com), CC BY 4.0"; the prepare script copies a given `--license-file` verbatim to `LICENSE` and fails without it; deterministic output. (The fetch script itself is checked by Step 5, not by unit tests.)
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Maintainer download** into a scratch dir (not the repo): run the fetch script with `KANJIALIVE_SHA256=` unset → it prints the SHA-256 and refuses; pin that value in the script, re-run → writes `plugins/data-audio/kanjialive-audio`. Spot-check 10 clips by ear against their `form/reading` (record results in the ledger; mismatches stop the task).
- [ ] **Step 6:** `docker build --build-arg WITH_AUDIO=0 -t qinqin:audio0 <wt>` (then `docker run --rm --entrypoint ls qinqin:audio0 /opt/qinqin/audio` prints nothing, and seeding in it succeeds) and `docker build -t qinqin:audio <wt>`; `docker run --rm --entrypoint ls qinqin:audio /opt/qinqin/audio/kanjialive-audio` shows `manifest.json index.tsv audio LICENSE ATTRIBUTION.md`; note image sizes in the ledger.
- [ ] **Step 7: Commit** `feat(audio): Kanji alive audio pack (fetched, image-bundled, CC BY 4.0)`.

### Task 8: Commons / Lingua Libre local tool

**Files:** Create `scripts/fetch-audio-commons.mjs`, `scripts/fetch-audio-commons.test.mjs`, `scripts/testdata/commons-*.json` (hand-written); Modify `scripts/check-sources.mjs` (`LOCAL_ONLY_PACKS` += `commons-audio-zh`, `commons-audio-ja`), `docs/sources.md`.

**Interfaces:** exports `allowedLicence(shortName: string) -> boolean`; `rowFromFile(info, lang) -> Row | null` (form/reading from Lingua Libre `LL-Q… (cmn)-User-词.wav` titles and `Zh-<pinyin>.ogg` syllable titles); CLI `--lang zh|ja --category <name> [--limit N] [<out>]` (default `plugins/data-local/commons-audio-<lang>`), ≤ 1 request/s, `User-Agent: qinqin-audio-fetch (local tool)`.

- Ruling: a `term` row may have an empty reading (Lingua Libre titles carry only the word), so `ParseIndex` accepts it, `Import` stores key `''` and `Resolve` matches such rows under any reading of the form, after rows whose reading matches exactly (Go tests added in this task's commit). A zh term row with a non-empty but unparsable reading is still skipped.
- Ruling: `LL-Q… (cmn)-User-102 块钱.wav` yields no row (the plan sketched `块钱`): the recording says "102 块钱", so a form with digits, Latin letters or spaces is skipped. Files in another language or another transcode are dropped by title; Lingua Libre `.wav` files are fetched as their Commons `ogg` (else `mp3`) transcode, `Zh-` originals as they are.
- Ruling: the syllable list inside the tool is generated from the server's pinyin package (438 toneless syllables), so no row can fail `ParseIndex`.
- Ruling (review fix): the Commons tool writes only to a strict child of the real `<repo>/plugins/data-local` (`resolveOutput`: refuses the root itself, `plugins/data/data-local/x`, `../` tricks, a symlink at the end or on the way in, and a symlinked `data-local`), stages inside data-local, and replaces an existing directory only when it is empty or holds the `.qinqin-generated` marker the tool writes (`checkReplaceable`); nothing else is ever removed.
- [ ] **Step 1: Failing tests:** allow-list cases from Global Constraints true; `CC BY-NC-SA 4.0`, `GFDL`, empty → false; `Zh-nǐ.ogg` → syllable `ni3`; `LL-Q9192 (cmn)-Luilui6666-102 块钱.wav` → term `块钱`, empty reading; attribution from `Artist` with HTML stripped; refuses an out dir not under `data-local`.
- [ ] **Step 2–4:** FAIL → implement (network only in the CLI path; tests never fetch) → PASS.
- [ ] **Step 5: Commit** `feat(scripts): local-only Commons/Lingua Libre audio fetcher with licence allow-list`.

### Task 9: Web API client, player, settings helpers

**Files:** Create `apps/web/src/lib/api/audio.ts`, `apps/web/src/lib/audio/player.ts`, `apps/web/src/lib/audio/settings.ts` with tests.

**Interfaces:** `getEntryAudio(id: number): Promise<AudioResolution>`; `resolveAudio(ids: number[]): Promise<Record<string, AudioResolution>>` (chunks of 200, session cache shared with `getEntryAudio`); `AudioResolution = {terms: AudioClip[]; syllables: AudioClip[] | null}`; `createPlayer(make?: () => HTMLAudioElement): {play(clips: AudioClip[]): Promise<void>; speak(text: string, lang: string): boolean; stop(): void; playing: boolean}`; `deviceVoiceFor(lang: string, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null`; `readAudioSettings(settings: Record<string, unknown>): {autoplay: boolean; deviceVoice: boolean}`.

- Ruling: `AudioResolution.syllables` is `(AudioClip[] | null)[] | null`, one slot per pinyin reading in entry order (the server's shape, Task 6). `resolveAudio` never rejects (a failed chunk is left out and retried on the next call; ids the server omits are cached as empty), `getEntryAudio` rejects. `createPlayer(make?, synth?)` takes the speech synthesis as a second parameter (null for none) so tests need no browser; `play` rejects when a clip fails, so the caller falls back to `speak`.
- [ ] **Step 1: Failing tests:** play sequence ends in order; second `play` stops the first (Review Focus 4); `stop` cancels `speechSynthesis` too; `deviceVoiceFor('zh', [en-US, zh-TW])` → zh-TW, prefers `zh-CN` when present; settings defaults false/true and non-boolean values ignored; client caches and chunks 450 ids into 3 requests.
- [ ] **Step 2–4:** FAIL → implement → web gates PASS. **Step 5: Commit** `feat(web): audio client, player and settings`.

### Task 10: PlayButton and entry page

**Files:** Create `apps/web/src/lib/components/PlayButton.svelte`, `PlayButton.test.ts`; Modify `apps/web/src/routes/entry/[id]/+page.svelte`, `apps/web/src/lib/components/Readings.svelte`.

**Interfaces:** `PlayButton` props `{clips: AudioClip[]; speakText?: string; lang: string; deviceVoice: boolean}`; `Readings.svelte` gains optional `audioFor?: (reading: Reading, index: number) => AudioClip[] | null` (index into the readings as passed to the API, which `Resolution.Syllables` is aligned to) plus `lang` and `deviceVoice`, rendering a `PlayButton` per pinyin reading only when `audioFor` is given; hidden when no clips and no usable voice (Review Focus 5); title "Audio: <attribution> · <license>" or "Device voice".

- Ruling: the web tests are server-rendered (`svelte/server`) and unit tests; the repo has no DOM test environment. So the button's decisions live in `lib/audio/button.ts` (`buttonState`, `activate`, `headwordClips`, `readingClips`, `creditLine`) and are tested there; `PlayButton` and `Readings` get render tests; the entry page itself (router and stores) is covered by those pieces and the real-app check (Task 13), not by a page render test.
- Ruling: per-reading buttons play recordings only (a pinyin reading has no sensible device-voice text); the headword button carries the device-voice fallback. Per-reading slots are used only when their count equals the pinyin readings shown, so a user's edited readings never get another reading's clip. The entry's audio is fetched for signed-in users only (the audio routes are signed-in); the device voice works for everyone. A credit line (`Audio: <attribution> · <licence>`, each distinct credit once) sits under the readings.
- [ ] **Step 1: Failing tests:** hidden without clips/voice; device-voice title; click plays; `aria-pressed` reflects playing; entry page renders one headword button and, for a zh character with two pinyin readings, one per reading; credit line under readings when a clip is used.
- [ ] **Step 2–4:** FAIL → implement → web gates PASS. **Step 5: Commit** `feat(web): play pronunciation on the entry page`.

### Task 11: Study integration and settings UI

**Files:** Modify `apps/web/src/lib/plugins/flashcards/cards/VocabCard.svelte`, `ToneCard.svelte`, `apps/web/src/routes/study/session/+page.svelte` (prefetch, key `p`), `apps/web/src/routes/settings/+page.svelte` (Workspaces tab: two checkboxes) with tests in `cardView.test.ts`/new component tests.

- Ruling (bug found in the spec's design): an `<audio src>` cannot send the bearer token and the clip route is signed-in only, so Task 10's buttons would have got 401. Clips are now fetched with the API client and played from object URLs (`lib/audio/source.ts`, the 40 most recent kept, older revoked); `createPlayer(make, synth, resolveSrc)` takes the resolver and `shared.ts` passes it. Browser HTTP caching of the clip is therefore not relied on; the in-memory cache serves replays within a page load.
- Ruling: the two audio options are workspace settings (`audioAutoplay`, `audioDeviceVoice`), edited in Settings → Workspaces → "Audio for this workspace" through `PUT /api/workspaces/{id}` (`workspaces.setSettings`), and read by the entry page and the study session. Only vocab and tone cards pronounce; `p` works after the reveal only and never in a text field or a card's own input. The session resolves the whole queue (and reserve) with one `resolveAudio`, and warms the next card's clip.
- Ruling (review fixes): (a) autoplay waits for the session's recordings (`audioSettled`) and marks a card played only when it was decided (played, or nothing can sound), so a clip that arrives after the reveal still plays; (b) iOS/Safari: every `PlayButton` fetches its clip when it renders, and `createPlayer`'s `readySrc` lets `play()` start the shared element in the same tick as the tap when the blob is ready (`readyClipUrl`), else the async path runs. Verified only by unit tests (play() is called before any await) and Chromium, NOT on a real iOS device: if the tap comes before the clip has loaded, iOS may still refuse the delayed play(), and a second tap works; (c) `p` and the "P plays" hint need something that can sound (`canSound`: a clip, or device voice on with a matching voice); (d) the clip cache never evicts or revokes a clip still being fetched and is cleared, with the resolutions, on sign-out; (e) buttons carry accessible names (`Play pronunciation of 行 (xíng)`); the study card shows the credit as text after the reveal and its button is out of the answer heading; the Sources audio table links the licence text and pages per-recording credits 500 at a time; AudioSettings shows the stored value again when a save fails.
- [ ] **Step 1: Failing tests:** VocabCard shows no button while `revealed` is false, shows it after; ToneCard only when `done`; autoplay plays once on reveal when `audioAutoplay` is true and never otherwise; `p` plays only after reveal; session calls `resolveAudio` once for its queue; settings toggles write `audioAutoplay`/`audioDeviceVoice`.
- [ ] **Step 2–4:** FAIL → implement → web gates PASS. **Step 5: Commit** `feat(web): pronunciation in study and audio settings`.

### Task 12: Sources page audio section

**Files:** Modify `apps/web/src/routes/sources/+page.svelte`, its API helper, tests.

- [ ] **Step 1: Failing test:** an "Audio" section lists each `/api/audio-packs` item with licence, attribution, notice (via `lib/sources/notice.ts`) and a "Per-recording credits" link for packs whose licence is `per file`; absent when the list is empty.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(web): credit audio packs on the Sources page`.

### Task 13: Real-app check, history scan, roadmap

- [ ] **Step 1:** Scratch data dir (never the live integration dir); seed `plugins/data` plus the locally fetched `plugins/data-audio`; serve on a free 127.0.0.1 port.
- [ ] **Step 2: Browser checks** (playwright-core, headless; audio verified by `HTMLAudioElement` events and the network log, not by ear): ja entry 述語 shows the button, clicking requests `/api/audio/clips/…opus` (206/200, immutable header), a second visit serves from cache; a zh entry 你好 with no pack uses device voice when Chromium has one, else no button; study card hides the button before reveal; Sources lists "Kanji alive" with CC BY 4.0. Kill what you start.
- [ ] **Step 3: History scan** — each prints nothing: `git -C <wt> ls-files plugins/data-audio plugins/data-local`; `git -C <wt> log --all --name-only --format= | grep -Ei '\.(opus|ogg|mp3|wav|m4a|aac)$'`; `git -C <wt> log --all --name-only --format= | grep -Ei 'ka_data|audio-opus'`.
- [ ] **Step 4:** ROADMAP #43 line; commit `docs: roadmap — #43 audio packs`.

## Risks and notes for the owner

- Default image build fetches 69 MB from media.kanjialive.com; CI can pass `WITH_AUDIO=0`.
- No Mandarin recordings out of the box: device voice only, unless the user runs the Commons tool or installs `audio-cmn` locally.
- The Kanji alive suffix mapping rests on its README; Task 7 spot-checks it.
