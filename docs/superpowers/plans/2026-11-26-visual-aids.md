# Visual aids (#212)

Milestone v0.8.0 (the beginner experience). Issue #212. Branch `feature/visual-aids-212`, PR base `feature/v0.8.0`.
Spec: `docs/superpowers/specs/2026-11-26-visual-aids-design.md`. Contract 9: `docs/contracts/aids/`. Pure logic
(setting, tone segments and colours, anatomy, picture cache) was written test first.

**Goal:** pictures on entries and cards, Chinese tone colours with a contour cue, character anatomy, and one
"Visual aids" settings group with a switch per aid.

## Rulings

Format: `Ruling: <what> — <why> — <cost if wrong>`.

1. Ruling: **The setting is a workspace-settings key (`visualAids`), not a user-global keyed row** — the issue says "per
   account (synced, backed up)": a workspace's settings are synced with the account and in the backup, `hints` (#215) is
   stored the same way, it needs no migration, no Go code and no new backup rule — the switches are per language
   (a learner of Chinese and Japanese sets tone colours once, for Chinese) and a new workspace starts with the
   defaults; if the owner wants one account-wide switch a keyed row can be added later and read before the workspace key.
2. Ruling: **Defaults: all three aids on** — the issue suggests tone colours and anatomy on and "pictures on where
   available"; the picture switch is on and shows nothing where there is no picture — a learner who finds pictures
   noisy turns one switch off.
3. Ruling: **Tone colours start from the Okabe-Ito hues and are made readable by moving toward the theme's text
   colour** — Okabe-Ito is the standard colour-blind-safe set, "theme-derived" without a new derived token (a new
   token would change `themes/derive.json`, the first-paint script and the server) — after darkening, orange, green and
   purple can come closer together for some colour-blind readers; the contour under each syllable is the cue that does
   not depend on colour, and the tone mark stays.
4. Ruling: **The contour is a drawn line (SVG path) under each syllable, the neutral tone a dot** — the Chao tone
   letters are font-dependent and tiny, a path scales with the text and takes the colour of the syllable — an
   inline-block syllable with padding can nudge line breaks of very long readings by a fraction of a line.
5. Ruling: **Run-together pinyin (`Běijīng`) is cut into syllables by a consonant rule** (the consonants before the
   next vowel group start the next syllable; zh/ch/sh are one initial; `n`, `ng`, `r` end the last) — CC-CEDICT
   pinyin has spaces but other sources and user edits may not — an ambiguous cut without an apostrophe (`xiangan` for
   `xiān` + `gān`) is coloured wrongly; a token with a digit or symbol is left plain, never mis-coloured.
6. Ruling: **Tone colours apply on every pinyin the app draws through `ReadingText` and `ReadingTable`** (entry page,
   reading hint, answers) and not on the Tone card's front or the writing pad — the Tone card is the exercise that asks
   for the tone: colouring the question would answer it, and the front never shows a reading — a new place that draws a
   reading with plain text is not coloured until it uses `ReadingText`.
7. Ruling: **Anatomy meanings come from the character universe's first gloss (`m`), not a new source** — no new data,
   no licence question, one cached request that the character map already makes — a part that is not a character of
   the dictionary (氵) shows without a meaning.
8. Ruling: **No part highlighting inside the glyph** — the issue says "highlighted in colour"; per-part stroke data
   exists only in KanjiVG (CC BY-SA 3.0), which the owner rule forbids adding — the parts are listed beside the
   character with their meaning (the colour-free form of the aid) instead; follow-up if a ≥ CC BY-SA 4.0 source appears.
   **The `kanjivg-components` pack stays as is (CC BY-SA 3.0, derived data bundled since v0.3.x): flagged for the owner**
   — it is what makes anatomy work for Japanese; Chinese has no bundled components pack (CHISE/IDS are GPL), so
   anatomy shows only where an administrator installed a local pack.
9. Ruling: **Pictures: ask `entryPicture` for the card on screen, remember the answer per session, offer the hint only
   once a picture is known** — the Hint button must not appear and then reveal nothing — the first view of a card
   whose picture request is slow shows no Hint button for that picture until it arrives (tens of milliseconds on a
   normal connection); offline no picture is offered.
10. Ruling: **The answer shows the picture unless the Picture hint is already on view** — a picture twice on one card
    is noise; a hint answered before the answer already taught the word — none.
11. Ruling: **`hintsForEntry` gains an optional second argument; `resolveHints`, `HINT_REGISTRY` and the settings API
    are unchanged** — the parallel Starter mode (#214) uses them — a caller that passes nothing gets `hasPicture: false`
    as before.
12. Ruling: **Card faces change by three one-line `<AnswerAids>` additions and one picture row in `HintShown`** — the
    parallel #214 edits the same cards; small additive hunks merge — `HintShown`'s prop type is widened with an optional
    `id`; every card already passes the full entry.
13. Ruling: **New catalogue keys live in `settings.aids.*` and `study.aids.*`** — the key areas are a closed list
    pinned by the i18n contract; a new area `aids` would change the contract and Android's converter — none.
14. Ruling: **Contract 9** (contract 8 is #216's, in the base when this branch was made) — new folder `aids/` with three
    fixtures; the `visualAids` key in the settings table; the picture hint now ready — renumber above the base if
    another change lands first (CHANGELOG heading, `version.json`, `api.ContractVersion`).
15. Ruling: **Pictures are not in the settings preview** — a bundled sample picture would add a file and a credit for a
    preview; the tone colours and an anatomy example are drawn (own text, no image) — the picture switch has only its note.

## File map

- `apps/web/src/lib/aids/`: `visualAids.ts` (setting), `tones.ts` (segments, contours, colours, tone names),
  `anatomy.ts`, `pictures.ts` (+ `PictureCache` in `context/caches.ts`), `useAids.ts` (what a component sees),
  `ToneText.svelte`, `EntryPicture.svelte`, `Anatomy.svelte`; tests next to them and `aids.contract.test.ts`.
- `lib/features/flashcards/face/AnswerAids.svelte`, `HintShown.svelte` (picture), `lib/study/hints.ts` (`ready`,
  `hintsForEntry`), the session page (`hasPicture`), `ReadingText.svelte`, `ReadingTable.svelte`, `EntryView.svelte`.
- `lib/settings/VisualAidsSettings.svelte`, `routes/settings/+page.svelte` (Study tab), `i18n/messages/en.json`.
- `docs/contracts/aids/`, `settings/`, `cards/README.md`, `CHANGELOG.md`, `version.json`, `api/version.go` (9).
- `apps/web/e2e/tests/visual-aids.spec.ts`; docs: wiki Settings tour and Flashcards pages, ROADMAP, `sources.md`.

## Tasks

- [x] 1. Setting: keys, defaults, read, patch (tests first).
- [x] 2. Tones: segments, contours, colours readable on every shipped theme (tests first).
- [x] 3. Anatomy and the picture cache (tests first).
- [x] 4. Components: `ToneText`, `EntryPicture`, `Anatomy`, `AnswerAids`; wired into readings, entry page, cards, session.
- [x] 5. Picture hint ready; `hintsForEntry` option; settings note.
- [x] 6. Settings group with preview.
- [x] 7. Contract 9 (fixtures, README rows, CHANGELOG, version), catalogue keys, e2e spec, docs.
- [ ] 8. Owner: look at it in a browser (nothing was drawn here); decide the questions below.

## Follow-ups (not built)

Pitch-accent lines (#182, no data yet), grammar diagrams, word maps, gender and case colours (#201), the user's own
picture per card, hanzi coloured by tone, part highlighting inside the glyph, an offline data package for pictures,
a colour (non-outline) OpenMoji choice for dark themes.

## Open questions for the owner

1. Account-wide switches instead of per-workspace (ruling 1)?
2. `kanjivg-components` (CC BY-SA 3.0) is bundled although the rule is ≥ CC BY-SA 4.0 (ruling 8): keep, or move it to
   local-only and lose anatomy for Japanese?
3. Is the contour under every syllable too busy in running text (entry page, answers)? A "colours only, no lines" option
   would drop the non-colour cue, so it was not added.
4. Mulberry's coloured pictures on dark themes (from #216) now actually show on cards.

## Not verified

- Nothing was drawn in a browser (no local browser automation by the owner's rule): the tone contour layout, the
  picture sizing, forced-colours rendering and the settings preview are covered by DOM tests and string checks only.
- The new e2e spec (`visual-aids.spec.ts`) was written and type-read but not run (Playwright is not installed here); it
  runs in CI. The e2e fixture packs have no images pack, so no picture flow is covered end to end; the picture UI is
  covered by DOM tests with a mocked `entryPicture`.
- No contrast check for the colours against `raised`/`chrome` surfaces, only `panel` (the card and entry surfaces).
