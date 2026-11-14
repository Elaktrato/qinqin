# Approximate JLPT N5–N1 kanji mapping

**Goal:** Replace the plain kanjiapi.dev copy in the bundled `jlpt-kanji` level pack with our own, reproducible approximation: kanjiapi's level where it has one; for every other kanji, a level derived from KANJIDIC2 (old four-level JLPT field, school grade, newspaper frequency). Honestly labelled as approximate.

**Owner decision (2026-11-14):** "go with that" — ours is the single JLPT kanji grouping; kanji kanjiapi.dev lists keep its level (so its 2,211 kanji do not change); our rule is applied only to kanji kanjiapi misses.

## Evidence (measured on the bundled data, 2026-11-14)

- All 2,211 kanji in kanjiapi's list are also in KANJIDIC2's old `<jlpt>` field (2,230 kanji, values 1–4 = old scale; 1,207/739/181/103).
- Old level vs kanjiapi level: old 4 → N5 79 / N4 22 / N3 1; old 3 → N4 143 / N3 25 / N2 12 / N1 1; old 2 → N4 1 / N3 339 / N2 349 / N1 44; old 1 → N3 2 / N2 6 / N1 1,187.
- Splitting old level 2 by KANJIDIC2 frequency rank: best single cut at rank 648 (≤ 648 → N3) agrees 69.5% (baseline 50.7%); whole pipeline (4→N5, 3→N4, 1→N1, 2→frequency split) agrees on 1,887 of 2,230 kanji (84.6%).
- About 170 jōyō kanji are in neither list (e.g. 分 可 無 的); 19 kanji have an old level but are not in kanjiapi's list; kanjiapi's N1 also holds ~247 jinmeiyō name kanji.

## Rules (binding)

1. **Base:** kanjiapi.dev `jlpt.tsv` (`5\t<kanji run>` … `1\t…`; N5 easiest) — unchanged levels for every kanji it lists.
2. **Gap fill, in this order, for kanji NOT in kanjiapi's list:**
   a. Has an old KANJIDIC2 `<jlpt>` level: 4→N5, 3→N4, 1→N1; 2→ N3 if frequency rank ≤ the calibrated cut else N2 (a missing frequency counts as beyond the cut).
   b. No old level, but a jōyō/kyōiku grade (`<grade>` 1–8): derive from grade and frequency with thresholds **calibrated on the reference set** (the 2,211 kanjiapi kanji) — e.g. thresholds on frequency rank per level, with grade as tiebreak/fallback when frequency is missing. Choose the rule by evaluation (hold out 20% of the reference set; report accuracy per level and overall for the train/holdout split; keep the rule simple: a handful of integer thresholds, no ML library). Jōyō kanji with neither frequency nor an old level go to N1.
   c. Everything else (jinmeiyō grades 9–10 without an old level, grade-less rare kanji): NOT listed (stay under "Not in this scheme").
3. **Determinism:** the generator is a pure function of (kanjiapi jlpt.tsv, bundled kanjidic2.xml.gz); output byte-identical on re-run; the calibrated thresholds live as named constants in the script with a comment recording the evaluation numbers and date.
4. **Labelling:** scheme name `JLPT kanji (approximate)`; pack id stays `jlpt-kanji`; `manifest.json`/`ATTRIBUTION.md` state: base list from kanjiapi.dev (MIT, Copyright 2023 Iridium Szreter, provenance not stated upstream), gap fill derived by `scripts/prepare-level-packs.mjs` from KANJIDIC2 (CC BY-SA 4.0, EDRDG), explicitly an approximation because the JLPT publishes no official list since 2010. Keep the existing attribution/licence files and add what is missing.
5. **No new bundled third-party data**; KANJIDIC2 is already in `plugins/data/kanjidic2`.

## Tasks

1. **Generator + pack:** extend `scripts/prepare-level-packs.mjs` (JLPT mode reads `<upstream-dir>/jlpt.tsv` plus the bundled `<packs-dir>/kanjidic2/kanjidic2.xml.gz`; default packs dir `plugins/data`), regenerate `plugins/data/jlpt-kanji`, extend `scripts/prepare-level-packs.test.mjs` with a small synthetic KANJIDIC2 fixture (each rule: base kept, old-level mapping, frequency split, grade rule, no-level exclusion, determinism, missing kanjidic2 → clear failure). Report per-level counts before → after, how many kanji were added per rule, and the calibration evaluation.
2. **App/test/docs updates:** scheme name change flows into the web (group-by label, badge text `N5 · JLPT kanji (approximate)` or shorter — keep badges readable; update tests/fixtures/strings that assert the old name or counts: Go `bundled_packs_test.go`/seed tests, web tests, README/docs/sources.md/plugins/data/README.md/Sources page copy). Re-seeding an existing database must update the scheme name and level membership (check the level importer handles a changed pack with the same pack id: members added/removed, scheme renamed; add a test if not covered).
3. **Verification:** gates (Go in Docker: `docker run --rm -v <worktree>:/src -w /src/server -e GOTOOLCHAIN=auto -e GOFLAGS=-buildvcs=false golang:1.23 sh -c "go vet ./... && go test ./..."`, plus `-race ./internal/levels ./cmd/qinqin`; web `check`, `test`, `build`; `node --test scripts/*.test.mjs`); real-app check: build a server from the committed tree, seed `plugins/data` into a scratch dir, `GET /api/schemes` and `/api/schemes/<id>/characters` show the new counts and name; a studied kanji (e.g. 分 now has a level) shows in the map grouping; playwright-core 1.52 is in the scratchpad `pw` dir if needed (Chromium headless shell 1161; free port; 127.0.0.1 only).
4. **Independent review** (read-only) of the evaluation method, determinism, licensing wording and the re-seed path, then one fix wave.

## Constraints

Work only in `/home/user/www/github/qinqin/.claude/worktrees/jlpt-approx` on `feature/jlpt-approx`; never touch `/home/user/www/github/qinqin` or other branches; plain single git commands; explicit `git add <paths>`; no push/merge (the owner approves merges). Go is not installed locally (use Docker as above; check `git status` for root-owned artefacts you created). The upstream `jlpt.tsv` is at `https://raw.githubusercontent.com/onlyskin/kanjiapi.dev/master/jlpt.tsv` (reachable with curl; a copy may exist in earlier scratchpad directories) and `LICENSE` beside it.
