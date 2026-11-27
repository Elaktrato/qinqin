# #286 — flashcards: level, deck and status tags as outline pills (2026-11-27)

Milestone v0.9.0, phase 2. Branch `feature/v090-286-outline-pills`, from `feature/v090-291-salad-drag` (#291).

## What

The card header (`lib/features/flashcards/face/FaceHeader.svelte`) shows the kind label, status chips (`Chip`: a
`--raised` wash) and "deck · level" as one muted string. The owner wants every tag as a small pill with only an
outline and a transparent background: one pill each for the level, the deck and the status chips (new, re-show,
tier, the re-grade chip). A shared `Tag` in `lib/ui` gives the look to later users (entry page, reader lookup).

## Tasks

1. This plan.
2. `lib/ui/Tag.svelte` (`<Tag tone?>`, neutral or accent) with `Tag.contrast.test.ts` (test first): text against
   the card background (`panel`) at least 4.5:1 and the outline at least 3:1, in every built-in theme (house and
   extras) and every accent it offers; forced colours draw the outline in `CanvasText`. The gallery shows it.
3. The header: `StudyFace`/`FaceHeader` take `deck` and `level` instead of `deckLevel`; the session page passes
   them (`deckAndLevel`) and renders its status chips as `Tag`s. DOM tests (test first): one tag per deck, level and
   status, the level in the accent tone, deck and level at the end of the line, wrapping.
4. Docs: the visual rework design (§2, §5) records the owner's decision, the wiki (study session: the header),
   `docs/releases/NEXT.md`.

## Rulings

- Ruling: the outline and the text use the **same** colour: `--readable-muted` for a neutral tag, `--reading-accent`
  for an accent one — both are derived to be at least 4.5:1 on `panel` in every theme (`derive.ts` falls back to
  `text`), so the outline (a 3:1 graphic) and the text pass everywhere without a per-theme exception; `--line`
  (the theme's line colour) is below 3:1 on several themes — cost if wrong: the pills read a little stronger than a
  hairline; one token to change.
- Ruling: the **level** is the accent tag, the deck and the status tags are neutral — the issue allows it where it
  reads well, and `--reading-accent` is guaranteed readable; it ties the level to the kind label without
  colour-coding the card kinds — cost if wrong: one prop on one tag.
- Ruling: deck and level are two tags, the deck first, both pushed to the end of the line (as "deck · level" was);
  the joined string `study.session.deckLevel` is no longer used and is removed — the issue asks one pill per tag —
  cost if wrong: a string to bring back.
- Ruling: the session's status chips (tier, re-show, new, the re-grade chip "Graded Good") all become `Tag`s; `Chip`
  stays for the entry page, the search filters and the reader until they adopt `Tag` (the issue says "later") —
  cost if wrong: two looks for a while, which the issue expects.
- Ruling: the pill radius is `999px` (rounded ends), the padding 0 0.6em, the label size and the body line height
  (as the kind label beside it), so a tag line is no taller than the label line — cost if wrong: cosmetic.
- Ruling: the "no pills" rule of the visual rework stays for navigation and buttons; it is amended in §2 and §5 as
  the owner's decision for tags only (the issue's wording) — cost if wrong: a doc line.
- Ruling: `Tag` gets a row in `docs/contracts/themes/README.md` (base components, design rules) without a
  ContractVersion bump — the table documents components, not data a client decodes; no fixture changes — cost if
  wrong: one number and a CHANGELOG line.

## Execution record

- Task 2, test first: `Tag.contrast.test.ts` run before `Tag.svelte` existed (failed: no module), then the
  component: 2 source checks + 2 tones × every built-in theme and accent pass. The gallery shows the tags
  (`gallery.gallery.test.ts` requires every exported component).
- Task 3, test first: the header tests in `StudyFace.dom.test.ts` and the session page tests
  (`page.dom.test.ts`: level tag, deck and level tags in a deck session, the re-show and re-grade labels are tags)
  were changed first: 6 failed; then `FaceHeader`/`StudyFace`/the session page; all pass.
- Checked by eye (headless Chromium): the gallery's tags in Catppuccin Latte, Catppuccin Mocha, Gruvbox and forced
  colours, and a Word Salad card at 360 px in the e2e app (the tier and "new" wrap onto a second line with the
  deck at its end, no sideways scroll). Not checked: the other themes by eye (the contrast test measures them all).
