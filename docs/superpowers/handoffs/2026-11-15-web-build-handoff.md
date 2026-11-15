# Web build handoff — 2026-11-15

Written at the end of the autonomous web-build run. Everything below is on `develop` and
pushed to `origin/develop`. Nothing was merged to `main`, nothing was tagged or released, and
no history was rewritten or force-pushed.

Decision rule used throughout (from your instructions): licensing first, then the best UX even
at higher development cost. Every ruling is recorded as `Ruling: <what> — <why> — <cost if
wrong>` in the plan or spec of its feature (paths below); this file lists the ones that matter
most and everything you have to do or check.

## 1. What shipped

Each row is one feature branch merged into `develop` with `--no-ff`; the merge commit is the
anchor. Specs are in `docs/superpowers/specs/`, plans (with the rulings) in
`docs/superpowers/plans/`.

| Scope | Issues | Merge commit | Notes |
|---|---|---|---|
| Writing and tone card feel | #56 (closed) | `96d5fda`, tuning `6e91032`, hardening `9259db1` | You confirmed: "the writer is perfect now" |
| Card management (delete, move, undo) | #30 | `ce219ff` | |
| Search filters | #33 | `8808691` | |
| Map backfill performance | #26 | `3e4d6c5` | |
| Re-show Again cards | #31 | `f8dc347` | |
| Journal with AI review and photo OCR | #46 (open, see §2) | `a49d7a6` | fake provider only |
| FSRS optimizer | #44 | `1731f08` | |
| Level packs (Jōyō, 通用规范汉字表) | #42 (open, local-only rest) | `8bccb57` | |
| Plugin SDK | #39 | `0ad18ef` | |
| Grammar lessons | #47 | `be12b6c` | demo pack only |
| Core activity statistics | #48 | `e3d06d9` | |
| CI and static-serving hardening | #54, #20, #21, #22 | `6ad3451` | |
| Pack management UI | #40 | `8b03eb5` | |
| Web polish batch | #19, #13, #14, #15, #16, #53 | `2d862f9` | #12, #17, #18 partly (see §5) |
| Audio packs | #43 | `3245730` | |
| Language management | #41 | `29a5878` | |
| Backend hardening: API and data | #1, #3, #9, #10, #11, #51, #52 | `a48326b` | |
| Backend hardening: import and language | #2, #4, #5, #6, #7, #8 | `fbe0ab4` | |

Migrations added: 025 journal/AI, 026 grammar, 027 pack registry, 028 study-events index,
029 audio. Numbers were assigned in merge order; the gaps never mattered because the runner
applies any missing version.

Test counts at the end: roughly 3,100 web tests (unit plus jsdom component tests) and all Go
packages green, with the opt-in real-data import test passing.

## 2. What you must do or check

1. **Journal with a real API key (#46).** Everything was built and checked only against the fake
   provider (`QINQIN_AI_PROVIDER=fake`); the real Anthropic API was never called.
   - Set `QINQIN_SECRET` (README, "Journal and AI", and the compose example). Without it AI is
     disabled with a clear message and no key is ever stored in plaintext.
   - First real call checks three things I could only verify against SDK source and canned
     replies: the key check (`Models.Get`), structured output on `claude-opus-5-5`, and the
     SDK sending the key as a Bearer header (v2.9.0 `WithAPIKey` does; verified in source).
   - Default model `claude-opus-5-5`, selectable `claude-sonnet-5-5` / `claude-haiku-5-5`.
   - Offline OCR is Tesseract (chi_sim, chi_tra, jpn, eng). Vertical Japanese reads poorly.
   - Not rate-limited at login (#86); see §5.
2. **Tone card feel on a touch device.** The writing matcher was reworked from your feedback and
   you confirmed it. The tone card (shape-based swipes, character-only pads) was only tested
   with mouse events. Thresholds live in `apps/web/src/lib/writing/params.ts` and the tone
   angle band in `apps/web/src/lib/study/tones.ts`.
3. **Native-speaker read of the 40 grammar demo sentences** (`plugins/data/zh-grammar-demo`).
   They are my own CC0 text, checked against the bundled HSK list and by an independent review,
   but no fluent speaker has read them.
4. **Listen to about ten Kanji alive clips** against `index.tsv` to confirm the word-to-file
   mapping (it was verified from the data: clip counts per kanji and file sizes, not by ear).
5. **Hand-check what was verified only by component tests or curl** (you banned local browser
   automation mid-run, and early checks used it before that):
   - Settings → Data: Languages table focus (Remove → Confirm → Cancel), Dictionaries panel
     placement, "No dictionary" chips, hidden-dictionary reveal in entries and the reader popup.
   - Audio: iOS/Safari first-tap behaviour (see Rulings), credit line on study cards, the `p` key.
   - Heatmap scope switch and chips at phone width, and the daily-activity list for screen readers.
   - Layout at 320/360/1024 px light and dark for the pages added in the last two batches.
6. **CI.** Watch the first GitHub run after the final push. Things that could only be validated
   locally (actionlint, scripts) and not on GitHub: the bumped action majors (checkout v7,
   setup-node v7, setup-go v7, buildx v4, login v4, metadata v6, build-push v7), the new
   `audio-stage` workflow, the embed smoke step, and the archive check step.
   - The two last develop runs before the final fix failed on the web jsdom tests under Node 26
     (Node's own `localStorage` global shadows jsdom's). A fix branch is part of the final push;
     check that develop is green.
7. **GitHub Support for the two zombie CI runs (#55).** UI cancel, API force-cancel (409) and
   API delete (403) all fail. Run URLs are in the issue.
8. **Image size.** Tesseract adds about 193 MB (`--build-arg WITH_OCR=0` skips it). Kanji alive
   audio adds about 70 MB and is fetched from media.kanjialive.com on default and release image
   builds (`WITH_AUDIO=0` skips it; a weekly/PR job builds the audio stage so breakage shows
   before a release).
9. **Test instance on :8300** (`/home/user/qinqin-feel-test`, binary built from an early develop)
   is still running with `tester` / `qinqin-test-123`. It predates most of this work; rebuild or
   stop it (`kill $(cat /home/user/qinqin-feel-test/pid)`). The old data backup and previous
   binary are beside it.

## 3. Licence-gated items and decisions you may want to veto

- **Bundled, licence evidence in the specs:** `joyo-grades` (KANJIDIC2 grade field, CC BY-SA
  4.0) and `tgh-chars` (Unihan `kTGH`, Unicode licence; the underlying 通用规范汉字表 is a State
  Council document, see `docs/superpowers/specs/2026-11-15-level-packs-design.md`).
  `tgh-chars` is a mainland scheme you had not seen: purge it like HSK if unwanted.
- **Local-only by design (fetch/prepare tooling, gitignored, never committed):** TBCL word and
  character lists, mainland curriculum tables (`scripts/prepare-local-levels.mjs`); Commons and
  Lingua Libre audio (`scripts/fetch-audio-commons.mjs`, per-file licence allow-list).
- **Rejected:** TOCFL 8000 list (withdrawn, never licensed), textbook grade splits, Forvo,
  JapanesePod101, eSpeak/Piper/Coqui/Kokoro TTS output for bundling (reasons in the audio spec).
- **No Mandarin recordings out of the box;** the device voice is the fallback.
- **Kanji alive audio** is CC BY 4.0 (licence evidence checked twice; credit text and links are
  on the entry page, study cards and the Sources page). It is never committed.
- History scans on the audio and level-pack branches found no audio, no restricted lists and
  no `data-local` content in any commit.
- The repository has no `LICENSE` file; compatibility was judged against the bar in your memory
  notes (CC BY-SA 4.0 or more permissive, with notices).

## 4. Rulings worth knowing (full text lives in each plan)

- **Matcher:** stroke order stays enforced. Acceptance is rank-based against all other strokes
  with generous ceilings; hooks and entry ticks are optional; joined strokes work for 了, 子,
  糸, 纟, 红 (first two strokes) and 好's 子 strokes. The old endpoint-anchoring rule was too strict
  for real hands and was replaced. The fixtures are in `apps/web/src/lib/writing/fixtures/strokes.json`
  (compact format, shared with the future Kotlin port).
- **FSRS optimizer:** our own TypeScript Adam optimizer in a Web Worker (`ts-fsrs` has none; the
  WASM one needs cross-origin isolation). Optimising needs at least 400 reviews; Apply requires
  that the new set beats the current one on held-out recent reviews (more than two standard
  errors on logs under 2,000 items). It refuses often on small logs: that is deliberate.
- **Heatmap:** default scope stays "This workspace" (your earlier decision); "All workspaces" is
  opt-in. Days are UTC (#84).
- **Plugin SDK:** built-in manifests are JSON under `server/internal/plugins/builtin/` (one
  source for Go and web); strict validation at registration, legacy admin plugins grandfathered;
  plugin-data writes need `owns-data`.
- **Pack uploads:** stage → licence review → exact licence echo → background install. The UI
  never says a licence is verified, approved, cleared or safe. Audio packs cannot be uploaded
  through the admin UI (10,000 files exceed the extraction limit): install them with the fetch
  script and `qinqin seed`.
- **Languages:** only admins add new language codes; learners can create workspaces in any
  known code (code pack, registered row, installed data or any live pack). Deleting a language
  is blocked while anything uses it.
- **Grammar:** new `grammar` pack type; demo pack only, no other authored content.
- **Debt batches:** component tests (jsdom, `*.dom.test.ts`) were added (#19) so UI behaviour
  can be tested without a browser; 47 MB of stroke data stays in the bundle by ruling (browsers
  fetch ~5 KB per character).
- **iOS audio:** play buttons preload clips and call `play()` in the tap's tick when ready; if
  the tap comes before the blob is ready iOS may refuse and a second tap works. Not testable
  here.
- **Intermediate commit:** `fd9f232` (inside the backend-hardening-api merge) does not compile on
  its own; the next commit repairs it. The branch was never published separately, so I left it.

## 5. Left open and why

- **#46** Journal: needs your real-key test (§2).
- **#42** TBCL and curriculum tables: local-only by the licence rule.
- **#12** English-only copy and `<html lang>` (accepted out of scope).
- **#17** Licence text on the entry page stays plain (free-text licence names → URLs would risk
  wrong links).
- **#18** The 47 MB stroke JSON stays in the bundle (above).
- **#55** Zombie CI runs: GitHub Support.
- **#57** Level sessions for character-unit packs (JLPT kanji, Jōyō, 通用规范汉字表 give no study
  cards in "By level"); pre-existing for JLPT kanji.
- **#84** Heatmap days in local time. **#85** Move flashcards and reader onto the plugin SDK.
  **#86** Login rate limiting and lockout (each failed login now costs one argon2 run).
- **Not started on purpose:** Android (#34–#38) and MCP (#45).
- **#58–#83** are issues that appeared during the run and were not created by me; I did not
  touch them.
- **Android notes** (for #34–#38): the client does not read `fsrs:*` plugin rows yet, so due
  counts differ once a parameter set is active; `GET /api/plugins` now has `hidden`;
  `GET /api/languages` rows can have `installed: false` and should be filtered or flagged.
- **Known limits written into the plans:** one undo slot in card management; re-adding a legacy
  ULID-id card starts a fresh history; plain keys and derived romaji need a re-seed to pick up
  pinyin/romaji changes; ~9 CEDICT symbol entries move from character to word on re-seed.

## 6. Process notes

- All implementation ran subagent-driven (implementer per task, then an independent review on the
  strongest model and one fix wave per branch). Review found real bugs before merge, for example
  the pinyin splitter regression (would have changed audio keys), a whitespace-only written form
  silently deleting an overlay, a stage-slot leak in uploads, and install-directory collisions.
- Browser automation was used early in the run for real-app checks; after your instruction it
  was stopped and replaced by curl, jsdom tests and built-server checks.
- Go gates ran in Docker as the normal user (Go is not installed locally).
- Scratch files were cleaned up; the two old Docker images that predate this run
  (`qinqin:integration`, `qinqin:web`, `qinqin:test`) were left alone.
