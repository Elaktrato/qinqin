# Drop the local-only TBCL and curriculum level lists (#42)

Branch `chore/42-drop-local-levels` from develop 51200acd. A clean-up: the owner dropped TBCL and the mainland
curriculum tables (local-only, no redistribution licence; not needed). Jōyō grades (`joyo-grades`) and
通用规范汉字表 (`tgh-chars`) stay bundled; the TOCFL 8000 list stays rejected.

## Found (whole-repo search for `tbcl`, `curriculum`, `prepare-local-levels`, `data-local`, `TOCFL`, 小学/初中/高中)

- `scripts/prepare-local-levels.mjs` and its test: the TSV converter, only for these lists.
- `scripts/check-sources.mjs`: `tbcl-words`, `tbcl-chars`, `cn-curriculum-chars` in `LOCAL_ONLY_PACKS`.
- `docs/sources.md`: the section "Local level lists (TBCL, curriculum tables)" and a pointer to it.
- `docs/wiki/Admin-data-packs.md`, `Flashcards-study-sessions.md`, `Project-layout.md`; `docs/ROADMAP.md`.
- Comments in `server/internal/levels/levels.go` and `server/internal/model/model.go` ("curriculum tables");
  the pack id `zh-curriculum` in `TestCharacterUnitScheme` (a generic character-unit test); the scheme name
  `'My curriculum'` in `apps/web/src/lib/entry/badgeText.test.ts` (a generic pass-through case).
- Nothing in the server or web code is specific to these lists: no scheme ids, no badge texts, no i18n keys
  (`en.json`), no contracts (`docs/contracts/`). The server accepts any levels pack generically, so there is no
  scheme id to refuse now and no refusal test to add.
- `docs/superpowers/` left as it is (history).

## Removed / changed

- Deleted the converter and its test; dropped the three ids from `LOCAL_ONLY_PACKS`.
- `docs/sources.md`: the section became one paragraph "Level lists considered and not offered" (TBCL and the
  curriculum tables considered and dropped; TOCFL 8000 and textbook grade splits rejected); ids not in backticks,
  so the source check does not look for them.
- Wiki: the converter row (Project layout), "TBCL, a curriculum table" (Admin data packs), "a curriculum pack"
  (Flashcards, now 通用规范汉字表). ROADMAP: #42 struck through in both places.
- Comments say "Jōyō grades" instead of "curriculum tables"; the test pack id is `zh-hanzi-list` and the
  badge test name `'My own list'` (same generic cases, no curriculum wording).
- `docs/releases/NEXT.md`: one line that the converter is gone and packs built with it keep working.

## Rulings

- Ruling: keep `plugins/data-local/` (`.gitignore`, `.dockerignore`, Dockerfile comment, `seed` default roots and
  their tests, the wiki and sources sections on local-only data) — the JLPT vocabulary pack, the IDS components
  pack, the Commons audio tool, the frequency lists and any own pack still use it — cost if wrong: one unused
  default seed root, harmless.
- Ruling: keep the generic "A level list of your own" paragraph in Admin data packs, without TBCL, curriculum
  or the converter — a hand-written levels pack is a documented generic pack type, not one of the dropped lists —
  cost if wrong: one paragraph to delete.
- Ruling: keep `TOCFL` as a scheme name in `internal/lookup/levels_test.go` and `entryDisplay.test.ts` — they
  test generic multi-scheme ordering with invented data; nothing offers a TOCFL list — cost if wrong: a rename.

## Execution record

- Removal of code only, so the existing tests are the guard (no test-first step; nothing new to test).
- Gates (2026-11-24): `node --test scripts/*.test.mjs` 138 pass, 2 skipped, 0 fail; `node scripts/check-sources.mjs`
  agrees; `node scripts/gen-api-docs.mjs --check` clean; `gofmt -l` empty; Go vet+test on `internal/levels`,
  `internal/model` green, then full `./...` green except the known `internal/ai`
  `TestHostnameResolvingToEmbeddedFormIsRefused` (no IPv6 here); web `check` 0 errors; full vitest under Node 26:
  612 files, 12,889 pass, 8 skipped.
- Not verified: the e2e suite (no browser automation on this machine; the only web change is a renamed string in
  a unit test, so CI's `e2e` job is the check); the Dockerfile and `.dockerignore` were not changed, and no image
  was built.
