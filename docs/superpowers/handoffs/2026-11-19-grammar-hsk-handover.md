# Handover — Chinese grammar pack (HSK-aligned)

Date: 2026-11-19
Worktree: `/home/user/.local/share/opencode/worktree/386de5/grammar-hsk`
Branch: `feature/grammar-hsk` (based on `develop` at `9765b86d`)
HEAD at handover: `5d4d0147` — `feat(grammar): HSK 2 lessons`
The main checkout `/home/user/www/github/qinqin` is used by another agent; work only in this worktree.

Read first:
- Design: `docs/superpowers/specs/2026-11-18-grammar-hsk-pack-design.md`
- Plan: `docs/superpowers/plans/2026-11-18-grammar-hsk-pack.md`
- SDD ledger (recovery map, rulings, per-task history): `.superpowers/sdd/2026-11-18-grammar-hsk-pack/progress.md`
- Shared authoring rules: `.superpowers/sdd/2026-11-18-grammar-hsk-pack/authoring-procedure.md`
- Per-level curated row guides: `.superpowers/sdd/2026-11-18-grammar-hsk-pack/hsk-1-rows.md` … `hsk-7-9-rows.md`
- Chinese grammar-tutor prompt: `.superpowers/sdd/2026-11-18-grammar-hsk-pack/chinese-tutor-review-prompt.md`

## State

| Level | Rows (floor) | Lessons | Examples | Review |
|---|---:|---:|---:|---|
| HSK 1 | 48 | 49 (语气助词 split) | 262 | Chinese tutor reviewed and **passed** |
| HSK 2 | 61 | 62 (row 41 split) | 248 | Authored by a free model, **Chinese tutor review not done** |
| HSK 3 | 56 | 0 | 0 | Not started |
| HSK 4 | 46 | 0 | 0 | Not started |
| HSK 5 | 38 | 0 | 0 | Not started |
| HSK 6 | 30 | 0 | 0 | Not started |
| HSK 7–9 | 27 | 0 | 0 | Not started (expect 55–65 lessons via splits) |
| **Total** | **306 floor** | **111** | **510** | 109/306 rows authored (~36%) |

The pack at `plugins/data/zh-grammar/` has seven levels; only HSK 1 and HSK 2 carry lessons. `lessons.json` and `COVERAGE.md` are generated from `authored/hsk-*.json` by `scripts/build-grammar-pack.mjs`.

Done and reviewed:
- Task 1: authoring tooling (`scripts/prepare-hsk-grammar.mjs`, `scripts/build-grammar-pack.mjs` and tests) — reviewed, fix round on `LEVELS.rows` floor semantics.
- HSK 1: 48 rows, 49 lessons, 262 examples, 23 `noOrder` examples; code/content reviews, two Chinese-tutor rounds, final **通过**.
- Task 2b: optional `noOrder` flag end to end (Go schema, build passthrough, web `buildExercises` filter, tests) — code review approved. Fill-the-gap always runs; word order is skipped for flagged examples.

Not done:
- HSK 2 Chinese-tutor review (first item below). The draft is structurally valid but the free model may have language/repetition issues.
- HSK 3–7–9 authoring.
- Task 9 cutover: the demo still exists, the HSK word/character notices still say "the project includes only…", `docs/sources.md` still names the demo, the i18n grammar note is unchanged.
- Task 10 verification (seed smoke, `/p/grammar`, `/sources`).
- Native-speaker review of the whole pack; the pack correctly stays marked "not reviewed by a native speaker".

## Immediate next steps

1. **Chinese tutor review of HSK 2.** Use `chinese-tutor-review-prompt.md` (prompt the subagent in Chinese as an experienced 对外汉语 grammar teacher). Give it `authored/hsk-2.json`, `lessons.json`, `COVERAGE.md`, `hsk-2-rows.md`, and the design. It must review all 62 lessons / 248 examples, not sample, and report in Chinese. The Go provider was rate-limited at handover; use a working Chinese model (the HSK 1 review used `opencode-go/qwen3.8-max`). Fix the findings in a content fix round, rebuild, and re-check. Known draft issues to start from:
   - Duplicate texts across HSK 2: `他比我高。` ×2, `因为生病，他没来上课。` ×2, `我喜欢苹果和梨。` ×2, `虽然下雨，我们还是去了。` ×2, `他说得很好。` ×3, `我去过中国。` ×2, `我没去过上海。` ×2, `他在看书。` ×2, `他去买菜。` ×2, `我昨天去了北京。` ×2. Rewrite or confirm different focus.
   - 14 `noOrder` examples: `hsk2-together-2`, `hsk2-together-4`, `hsk2-time-adverbs-3`, `hsk2-conjunction-gen-1`, `-3`, `-4`, `hsk2-other-phrases-4`, `hsk2-fixed-phrases-shenme-de-4`, `hsk2-patient-subject-3`, `-4`, `hsk2-shi-de-emphasis-4`, `hsk2-pivotal-sentences-4`, `hsk2-experiential-aspect-4`, `hsk2-approximate-numbers-3`. The tutor should scan for missed second orders (time fronting, A和B, 都 object fronting, V+了+一下+O).
   - Apply the distractor rule from `authoring-procedure.md`: never another member of the same interchangeable class (`很/太/非常/真`, `在/正在`, `也/都/还`, `不/没/别`, `的/得/地`) unless the sentence excludes it; `的` in a `是……的` confirmation slot is a second answer.
2. **HSK 3–7–9** (plan Tasks 4–8). Each has a curated guide (`hsk-3-rows.md` 56, `hsk-4-rows.md` 46, `hsk-5-rows.md` 38, `hsk-6-rows.md` 30 floor/31 listed, `hsk-7-9-rows.md` 27 floor/28 listed). Author in batches, `--check`, `GO`, sample-review 10, then the Chinese tutor review. Row floors are floors, not caps; extra rows are allowed.
3. **Task 9 cutover** (plan). Delete `plugins/data/zh-grammar-demo/`; tighten `server/internal/grammar/bundled_test.go` to 300–500 lessons and all seven levels populated; remove the demo from `server/cmd/qinqin/seed_notice_test.go`, `docs/sources.md` and `plugins/data/README.md`; rewrite the HSK word/character notices pack-scoped in `hsk-words`/`hsk-chars` manifests + `ATTRIBUTION.md`, `docs/sources.md`, `docs/wiki/Data-and-licences.md`, `README.md`; change `apps/web/src/lib/i18n/messages/en.json` `sources.grammar.notice`; update `docs/ROADMAP.md`; update `route.test.ts` demo-id fixture; add the 7×50 browse test. Run `node scripts/build-grammar-pack.mjs --complete`.
4. **Task 10 verification** (plan): seed a temp DB with `zh-grammar` only, curl `/api/grammar?language=zh` (7 levels, 300–500 lessons), open `/p/grammar` (last lesson + practice), `/sources` (grammar credit, HSK notices no contradiction), run `go test ./...`, `node --test scripts/*.test.mjs`, `node scripts/check-sources.mjs`, `cd apps/web && npx vitest run` and `npm run check`.
5. **Final whole-branch review** per the subagent-driven-development skill, then finishing-a-development-branch. Native-speaker review remains open.

## Decisions and rulings (do not reopen without reason)

- **Row floors:** 48/61/56/46/38/30/27 (total 306). Floors, not caps; a level may author extra rows if the PDF has more. The extractor's counts are an aid, not the authority; authors cross-check the layout dump and add missing rows.
- **`noOrder`:** optional example flag. `true` skips the word-order exercise; fill-the-gap still runs. Use only when tokens have a second legal order. This is a small schema/API/web addition, no migration (stored JSON). `hsk1-he-conjunction` has all five examples noOrder, so that lesson is fill-the-gap only; accepted by the owner.
- **Distractors:** every distractor must be absolutely wrong in the slot; never another member of an interchangeable class unless the grammar excludes it; `的` is not used where it forms a `是……的` confirmation or possessive fragment. Similar-point discrimination lives in the 1–2 contrast examples.
- **Notices:** pack-scoped wording, no runtime detection of active packs. HSK word/character notices say "this pack includes only…" and name the grammar pack as a separate installed pack.
- **No removal migration:** no existing databases/users; repo deletion of the demo is enough. The demo entries in tests/docs stay until Task 9 because the demo still exists.
- **Chinese tutor gate:** every level gets a Chinese-language grammar-tutor review after the task review; findings are fixed before the level is complete. The prompt and HSK 1 reports are in the SDD workspace.

## Commands

```bash
cd /home/user/.local/share/opencode/worktree/386de5/grammar-hsk

# build/validate
node scripts/build-grammar-pack.mjs --check      # validate, write nothing
node scripts/build-grammar-pack.mjs              # regenerate lessons.json + COVERAGE.md
node scripts/build-grammar-pack.mjs --complete   # all 7 levels, floors, 300–500 lessons

# Go (toolchain; `go` may not be on PATH)
/home/user/qq-tools/goroot/bin/go test ./internal/grammar -run TestBundledGrammarPack -v
/home/user/qq-tools/goroot/bin/go test ./cmd/qinqin -run TestCommittedPackNotices -v
/home/user/qq-tools/goroot/bin/go test ./...

# web (node_modules is symlinked to the main checkout; in a fresh worktree run npm ci)
cd apps/web && npx vitest run src/lib/plugins/grammar/exercises.test.ts
cd apps/web && npx vitest run src/lib/plugins/grammar
cd apps/web && npm run check

# sources
node scripts/check-sources.mjs
node --test scripts/*.test.mjs
```

Seed smoke (after Task 9):

```bash
tmp=$(mktemp -d)
mkdir -p "$tmp/packs"
cp -r plugins/data/zh-grammar "$tmp/packs/"
cd server && /home/user/qq-tools/goroot/bin/go run ./cmd/qinqin seed --data "$tmp/data" --packs "$tmp/packs"
```

Then `serve --data "$tmp/data" --addr 127.0.0.1:8099` and curl `/api/grammar?language=zh`; expected 7 levels and 300–500 lessons.

## Known minors / deferred

- `buildGrammarPack`'s `rows` return value is the sum of level floors, not the authored row count.
- With `noOrder`, a lesson can collapse to one order exercise that is the last cloze, so the pre-existing "last cloze is a free answer" swap guard is unreachable. Follow-up note, not fixed.
- HSK 1 `J7` variety polish (light reuse of frames with different focus) was deliberately not done.
- HSK 2 is a free-model draft; expect language/repetition corrections in the tutor review.
- Native-speaker review of the pack is still open; do not remove the "not reviewed by a native speaker" wording.

## Git

- `feature/grammar-hsk` is 7 commits ahead of `develop` plus the HSK 2 commit; no push/merge has been done.
- Do not commit the PDF/TSV (`/tmp/opencode/hsk/`) or the SDD workspace (`.superpowers/` is gitignored).
- The other agent's main checkout is untouched.
