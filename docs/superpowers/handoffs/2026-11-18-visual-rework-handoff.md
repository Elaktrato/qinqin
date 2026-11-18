# Visual rework handoff — 2026-11-18

The visual rework (#95) is on `develop`: #96–#106 and #108, plus the owner's follow-ups of
2026-11-18 (Settings tabs wrap without a scrollbar, Search leads the frame menu, and the
character map has a level filter). Nothing went to `main`, no tag, no release and no Android
code; the `qinqin` container and `/home/user/qinqin-deploy` were not touched.

Final merge: `4bbea04c` **Merge the visual rework: pages, stats, search and the qinqin house
themes (#95)**.

## What shipped

| Issue | Item | Merge in the branch history | Contracts / docs |
|---|---|---|---|
| #96 | Theme pack type, appearance row, built-in palettes | `9765b86d` (to develop) | `docs/contracts/themes/` |
| #97 | Interface font and hanzi/kanji font packs | `9765b86d` | `docs/contracts/fonts/` |
| #98 | Base components, tokens and the design rules | `9765b86d` | `docs/contracts/themes/`, `docs/wiki/` |
| #99 | Frame: desktop icon bar, workspace/account menus, phone drawer | `9765b86d` | frame tests, `docs/wiki/` |
| #100 | Home and the three heatmap layouts | `9765b86d` | `docs/contracts/home/`, `docs/contracts/activity/` |
| #101 | Flashcards: decks, session, cards, grades | `9765b86d` | `docs/contracts/study/` |
| #102 | Reader: page, rail, lookup popup and phone sheet | `9765b86d` | `docs/contracts/library/`, `docs/contracts/reader/` |
| #103 | Journal: three-column page, margin corrections, ideas sheet | `9765b86d` | `docs/contracts/journal/` |
| #104 | Search master–detail and the shared entry view | `94ac772c` | `docs/contracts/search/`, `docs/contracts/levels/` |
| #105 | Stats Overview / Characters / Week; `Select`; stats widgets | `32535bbb` | `docs/contracts/stats/` |
| #106 | Every remaining route, controls, page containers, README gallery | `4cbb689c` | `docs/superpowers/plans/2026-11-17-vr-pages.md` |
| #108 | qinqin Day / Night / Deep and the Neon, Pigments and Pop extras; new defaults and fallback; theme-switch fade | `f28967aa` | design §7a, `docs/contracts/themes/`, `docs/sources.md` |

The README gallery was committed in `38bd0924` (13 images under `docs/assets/screenshots/`,
with `apps/web/src/lib/readmeGallery.test.ts`).

### Owner follow-ups of 2026-11-18

- **Settings tabs wrap** (`3450720d`): the page no longer overrides the base `Tabs` with a
  nowrap, sideways-scrolling strip; every tab is visible at 1440 and 360, and no scrollbar
  appears.
- **Search first in the frame menu** (`cfb41497`, test fix `5be40686`): the desktop icon bar
  is Search, Decks, Reader, Journal, Grammar, Stats; the phone drawer is Home, Search, then
  the features, with Stats last.
- **Character map level filter** (`4f6a96fc`, fix wave `f6871f1a`/`6d3e2693`, docs
  `4f4e3740`): Stats → Characters has a **Level** select — All levels or one installed level
  scheme's level (JLPT N5, HSK 2, Jōyō grade 3, …). The map, stage counts and the
  "X of Y learned" summary cover only that level; choosing a level opens its scheme under
  Group by (Grade for the Jōyō pack), and the choice is remembered per workspace. A test with
  JLPT N5 on the demo data shows its own `0 of 80 learned`, not the 13k-character map.

## Gates (final branch)

- Web: `npx vitest run` — **11,911 passed, 2 skipped**; `npm run check` 0/0; `npm run build`
  exit 0.
- Go: `go test ./...` exit 0 (46 packages).
- Docs: `contractsDocs`, `wikiDocs`, `readmeGallery` and the catalogue tests pass; the README
  and images agree.
- Reviews: independent reviews for #101–#105 and #108, one fix wave each (two for #105's
  contrast/level work); the level filter had its own review and fix wave. Reports are in
  `/tmp/opencode/reviews/` on the build machine (not committed).
- Visual pass: Day, Night and Deep at 360/1440 on Home, a flashcard, the reader and
  Appearance; the README gallery at the listed widths/themes. Playwright screenshots were
  deleted after the pass.

## Owner checks

- Every page at 360 and 1440 px, in light and dark and at least three themes; the qinqin Day,
  Night and Deep themes on a real device.
- A real screen reader, touch, 200 % zoom and forced-colours/reduced-motion pass; the
  theme-switch fade is 0 ms under reduced motion.
- The character map's level filter on a real Japanese workspace (JLPT N5) and a Chinese one
  (HSK 1); the Jōyō level with Grade grouping.
- The decks, Settings and study pages after the page pass; the user reported the old decks
  page lacked the outer margin and some controls were unstyled — both were fixed in #106.

## Rulings and open items

- All rulings are in the plans: `docs/superpowers/plans/2026-11-17-vr-*.md`, plus
  `docs/superpowers/plans/2026-11-18-vr-char-level.md` for the level filter and design §7a
  for the house themes/defaults.
- Open: **#107** (owner drawings: lotus heatmap stages, level badges, day markers). **#95**
  closes when #107 lands. #108 is closed with this merge.
- The old samples (`hsk-mini`, `jlpt-mini`) and the optional JLPT vocabulary pack remain
  optional; the bundled HSK 3.0, JLPT kanji, Jōyō and TGH packs are the real level lists.

## Before / after

The reader and flashcard restyle before/after images from the #102 review are in
`docs/superpowers/handoffs/assets/`:

- `vr-reader-before-1440-latte.png` → `vr-reader-after-1440-latte.png`
- `vr-reader-after-360-mocha-sheet.png` (the phone lookup sheet)
- `vr-flashcards-after-1440-latte.png`, `vr-flashcards-after-360-mocha.png`

The full current look, including search/entry, Stats, the journal, decks, Appearance and the
phone drawer, is in the README's [Screenshots](../../../README.md#screenshots) section.
