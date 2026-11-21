# Handoff — Chinese grammar pack (HSK-aligned), all seven levels

Date: 2026-11-21
Branch: `claude/keen-sagan-kbhg48` (continues `feature/grammar-hsk`; `main` merged in)
Previous handover: `2026-11-19-grammar-hsk-handover.md`

## State

| Level | Rows (floor) | Lessons | Review |
|---|---:|---:|---|
| HSK 1 | 48 | 49 | tutor-passed earlier; ordinal 第一 pinyin fixed (dì-yī) |
| HSK 2 | 61 | 62 (345 examples) | two Chinese-tutor reviews, fixed |
| HSK 3 | 57 | 68 | Chinese-tutor review, fixed |
| HSK 4 | 46 | 58 | Chinese-tutor review, fixed |
| HSK 5 | 39 | 46 | Chinese-tutor review, fixed |
| HSK 6 | 31 | 36 | Chinese-tutor review, fixed |
| HSK 7–9 | 40 | 67 | Chinese-tutor review (two halves), fixed |
| **Total** | **322** | **386** | `--complete` passes |

The tutor reviews were run by an AI model prompted in Chinese as a grammar
teacher, reading every example. The pack still says it has not been reviewed
by a native speaker; that review remains open.

## Row source (open check)

The PDF host was not reachable from the build environment. The HSK 3–7–9 row
lists come from a public transcription of the outline's table
(`krmanik/HSK-3.0`, `New HSK (2025)/HSK Grammar/json`), which matches the HSK 1
and 2 rows authored from the PDF. Row numbers follow its 细目 grouping; HSK 4's
long 连接分句或句子 list counts as two rows (19, 20). The floors in
`scripts/build-grammar-pack.mjs` `LEVELS` were changed to 57/46/39/31/40 to
match (HSK 1/2 unchanged). **Open:** check `COVERAGE.md` against the PDF row by
row once someone has the PDF.

## Task 9 cutover (done)

- `plugins/data/zh-grammar-demo/` deleted; removed from the auto-seed demo list
  and its test, the notice test, Dockerfile comment, README, deploy wiki,
  `docs/sources.md`, `plugins/data/README.md`, ROADMAP; `route.test.ts` uses
  `zh-grammar`. `docs/contracts/packages/` fixtures left as they are.
- HSK word/character notices are pack-scoped ("This pack includes only …") in
  both manifests, both `ATTRIBUTION.md`, `docs/sources.md`, README,
  `plugins/data/README.md`, `docs/wiki/Data-and-licences.md`.
- `sources.grammar.notice` rewritten.
- `browse.test.ts`: 7 × 50 lesson grouping test.
- `TestBundledGrammarPack`: 300–500 lessons, every level populated, every
  lesson imported.

## Task 10 verification (done 2026-11-21)

- Seed of `zh-grammar` alone: `386 lessons`. `GET /api/grammar?language=zh`:
  7 levels, 386 lessons; the last lesson opens with 8 examples.
- `/p/grammar` (Playwright): seven level headings, 386 lesson links, ≈ HSK 1 …
  ≈ HSK 7–9 badges with `hsk-words` installed; last lesson's practice: all
  fill-the-gaps answered, a word-order exercise checks "Correct!".
- `/sources`: grammar credit with the unreviewed note; HSK notices say "This
  pack includes only …", no contradiction.
- `node --test scripts/*.test.mjs` 152 pass; `check-sources` pass;
  `npm run check` 0 errors; Go and web suites pass except pre-existing,
  environment-dependent failures that also fail on `main`'s code here:
  `internal/ai` netguard tests (proxy/IPv6) and 5 DOM tests in
  `AccountSettings.dom.test.ts` / `BookView.dom.test.ts`.

## Known minors / open

- Native-speaker review of the whole pack.
- Row-by-row PDF check of `COVERAGE.md` (above).
- Interpretations the reviewers could not verify against the syllabus wording:
  HSK 3 row 28 动补短语2, HSK 4 row 26 "X是X", HSK 5 row 37 不是……，还/还是……,
  HSK 7–9 row 4 我 (read as 我国/我校).
- Symmetric frames (或者……或者, 一会儿……一会儿, 一时……一时, 要么……要么,
  A也好B也罢) keep many `noOrder` examples by nature; a few clozes there test a
  longer unique chunk (或是去, 一会儿热) because the word occurs twice.
- HSK 1 still has a few repeated sentences across its own lessons (deliberately
  not polished, as before).
- Some HSK 2 words are above the level (感兴趣, 质量, 取消, 流利, 衬衫, 包裹).
