# Flashcards: one "open page" layout for six kinds (issue #101) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (fresh implementer
> per task or per few tasks, independent review on the strongest model, one fix wave, whole-branch review).
> Steps use checkbox (`- [ ]`) syntax. Strictly test-first: write the test, run it, see it FAIL, implement,
> see it PASS.

**Goal:** the study session looks and works like design §9 "Flashcards — open page": no card box; every kind
(Recognise, Recall, Fill the gap, Build the sentence, Write, Tones) has the same four parts in the same places
(kind label with deck and level on the right, prompt, answer area, the answer below a hairline); the session top is
close, a thin progress line and a count; actions are docked at the bottom — before the answer one soft-accent
button (Show answer / Check / Show strokes), after it four grade buttons as coloured text with a thin underline in
their grade colour, **each showing its next interval computed by the same scheduler** (`<1m`, `6m`, `1d`, `4d`);
the suggested grade gets a faint wash. Kinds are not colour-coded. What the session does (queue, grading, XP,
re-shows, burying, notes, audio, keys) does not change.

**Design (binding):** `docs/superpowers/specs/2026-11-16-visual-rework-design.md` §5 (rules), §6 (tokens), §9
"Flashcards" and §10 ("Grade buttons show the next interval; kinds are not colour-coded; the kind label uses the
accent"); mockups `docs/superpowers/specs/assets/2026-11-16-visual-rework-mockups.html` section "Flashcards: one
layout, six kinds, open page" with the **Lighter** weight (CSS `.lite .fc-*`, `.lite .gb*`, `.lite .acts .main`;
the "Round 3" weight and the "Raised card" style are rejected). Direction:
`docs/superpowers/directions/2026-11-17-visual-rework.md`.

**Builds on:** #96 themes/tokens, #97 fonts (`--font-hanzi`), #98 PART A base components (`lib/ui`: Button,
IconButton, Tooltip, Field, Chip, Icon …) **and #98 PART B** — a concurrent agent (branch `feature/vr-tokens`)
moves every component's literal colours onto tokens (batch B2e is exactly the flashcards cards, decks, scheduling
and the `study/session` route). **Build on the token-migrated tree:** start only after `feature/vr-tokens` is
merged into `feature/visual-rework` (check `git log feature/visual-rework` for the B2e/B2h commits and that
`apps/web/src/lib/ui/lint/pending.json` no longer lists any file this plan touches). If it is not merged yet, stop
and report — do not migrate colours a second time. Also after #99 (frame) and #100 (home), per the direction's
order; nothing here depends on their APIs.

## Architecture

- **Scheduler preview (pure, contract).** `apps/web/src/lib/study/scheduler.ts` gains `nextIntervals(cardId |
  null, reviews, now, w, clock) → Record<ReviewGrade, number>` (milliseconds from `now` to the due instant each
  grade would give). It replays the card exactly as `scheduleFor` does (the same `replay` helper, so the same
  ts-fsrs instance, weights and study clock) and asks ts-fsrs `repeat(card, fedNow)` for the four outcomes;
  `null` (a virtual item, no card yet) previews an empty card. A new text rule
  `apps/web/src/lib/study/intervalText.ts` turns milliseconds into the short label (`<1m`, `6m`, `3h`, `1d`,
  `4d`, `2mo`, `1.4y` in English; locale units through `Intl`) and the long label for screen readers ("in 6
  minutes"). Both rules are contract fixtures in `docs/contracts/scheduler/` (`next-intervals.json` generated from
  plain ts-fsrs like `fsrs.json`; `interval-text.json` hand-written) so Android shows the same numbers.
- **Readable grade text (theme contract).** Grade colours as small text can miss 4.5:1 (Latte's yellow-ish
  `gradeHard`, Gruvbox's). Like `readingAccent`/`readableBad`, four derived tokens `readableGradeAgain|Hard|Good|
  Easy` = the grade colour when it reaches 4.5:1 on `panel`, else `text`; CSS `--readable-grade-again…easy`. The
  underline keeps the raw `--grade-*` (a line needs 3:1, which the theme contrast report already checks).
  Web `lib/theme/derive.ts` and Go `server/internal/themes/derive.go`, fixture `docs/contracts/themes/derive.json`.
- **The face (feature components).** `apps/web/src/lib/features/flashcards/face/`:
  - `cardFace.svelte.ts` — a context created by the session: `provideCardFace()` returns a `CardFace` object
    (`$state` fields `primary: {label, run, disabled} | null`); cards call `useCardFace().setPrimary(...)` from an
    `$effect` (and clear it on destroy). No provider → `useCardFace` throws (a card is only ever rendered inside a
    face; tests use the harness).
  - `StudyFace.svelte` — the session layout: `SessionTop` (close IconButton → `/study`, progress line, count),
    `FaceHeader` (kind label in `--reading-accent`, chips for tier / re-show / new, deck · level on the right), the
    card (children), the learner's note slot, and the bottom `ActionDock` (the registered primary as one
    `Button variant="primary"`, or the `GradeBar` once done, plus the keys line).
  - `FacePrompt.svelte`, `FaceWork.svelte`, `FaceAnswer.svelte` — the three card-owned regions (children
    snippets), so every kind puts its parts in the same places with one stylesheet: prompt centred (CJK 4rem
    regular for a word, 1.5rem for a sentence, meaning 1.375rem weight 500), work area centred, max 33.75rem
    (540px), answer below a 1px `--hair` line.
  - `GradeBar.svelte` — four buttons in a 4-column grid; each: grade name (`--readable-grade-*`, weight 600) over
    the short interval (`--readable-muted`, weight 400, `tabular-nums`), a 2px underline in
    `color-mix(in srgb, var(--grade-*) 35%, transparent)`; the suggested one: full-strength underline plus a 10%
    wash of its grade colour; no box, no fill otherwise.
  - `testing/CardHarness.svelte` — provides the face and renders `StudyFace` around one card for the card dom tests
    (lives in a `testing/` folder: excluded from the i18n lint and from shipping like `lib/ui/testing`).
- **Cards.** The six card components (`lib/features/flashcards/cards/*`) keep their logic, props, `onDone`
  results and their own keys; they move their markup into `FacePrompt`/`FaceWork`/`FaceAnswer`, register their
  main action with the face instead of rendering it, and are restyled per the mockup's lighter weight (underline
  fields via `lib/ui/Field`, hairline choices/tiles/pads, no fills). Secondary actions (Show reading, Undo, Show
  answer as give-up, Hint) stay in the work area as `Button variant="plain"` / `secondary`.
- **Session route.** `apps/web/src/routes/study/session/+page.svelte` renders `StudyFace`, computes the
  intervals when a card is done, announces each grade in a polite live region and moves focus to the next card.
  The completion summary, loading and error states are restyled with §5 (Section/Stat/Button) without new content.

**Tech stack:** SvelteKit 2 / Svelte 5, vitest + jsdom, ts-fsrs 5.4.2 (already a dependency), Go for the derive
contract only. **No new dependency.**

**Branch / worktree:** `feature/vr-flashcards` at `/home/user/www/github/qinqin/.claude/worktrees/vr-flashcards`
(`<wt>`), cut from `feature/visual-rework` after #98 PART B, #99 and #100 are merged into it (record the commit).
The orchestrator merges and pushes; never push, merge, tag, rewrite history or touch `main`, the `qinqin`
container or `/home/user/qinqin-deploy`.

## Gates

- Toolchain: `export PATH=/home/user/qq-tools/goroot/bin:/home/user/qq-tools/node-v26.13.1-linux-x64/bin:$PATH`.
- Web: `npm --prefix <wt>/apps/web ci` once; per task `cd <wt>/apps/web && npx vitest run <paths>` (fail first,
  then pass); `npm run check` before each commit that touches Svelte; the doc tests
  `npx vitest run src/lib/contractsDocs.test.ts src/lib/wikiDocs.test.ts` when a contract or wiki file changes;
  the colour lint `npx vitest run src/lib/ui/lint` after every restyle task; the i18n tests
  `npx vitest run src/lib/i18n` after every task that adds keys; full `npx vitest run` and `npm run build` (Node 26)
  before the last commit. Never two builds in one worktree at once. Read exit codes (never behind `| tail`).
- Go (Task 4 only), from `<wt>/server`: `flock /tmp/qinqin-go.lock env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy
  -u http_proxy -u NO_PROXY -u no_proxy GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false sh -c 'gofmt -l . ; go vet
  ./internal/themes/... && go test -count=1 -p 2 -timeout 30m ./internal/themes/...'`; the full `./...` once before
  the last commit (the `internal/ai` IPv6 test and the known timing tests may fail only under load / without IPv6 —
  rerun them alone and record).
- Fixture generator: `node <wt>/scripts/contracts/gen-scheduler-fixtures.mjs` reproduces the committed files
  byte for byte (its existing self-check; Task 2 extends it).
- One commit per task, explicit `git add <files>`, conventional message ending with a blank line and exactly
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git status` clean after each commit.

## Global constraints

- **Tokens only** (the #98 colour lint is live): no hex/rgb/hsl literal, no `prefers-color-scheme`; grade colours
  `--grade-*` for lines, `--readable-grade-*` for text; accent text `--reading-accent`; secondary text
  `--readable-muted`, never `opacity`; separators `--hair` 1px; motion `--motion-*` only.
- **§5:** no card box, no filled choice/tile/pad, fields are an underline, one primary action per view in the soft
  accent tint (`Button variant="primary"`), type tops out at 600, labels sentence case (no `text-transform`, no
  letter-spacing caps), kinds are not colour-coded (the old `kind-sentence/writing/tone` border colours go).
- **Never colour alone:** correct/wrong keep their text (`Correct!`, `Not quite…`) and gain a shape (✓ / ✕ icon
  from `lib/ui/Icon`, `check` / `close`); grade buttons carry their names; the suggested grade is named
  "(suggested)" and has the full-strength line; the re-show chip says "Again, look n of m".
- **Strings:** every new string in `apps/web/src/lib/i18n/messages/en.json` (sorted) via `t()` / `<Msg>`, used
  literally in non-test `src/`; no fixed-locale formatting (intervals go through `lib/i18n/format.ts`), no literal
  `lang`. Keys this plan adds are listed in "i18n keys".
- **Keyboard (unchanged behaviour):** Space/Enter reveal (vocab, reverse outside the field); 1–4 grade after
  done; P plays after the reveal; cloze 1–4 pick a choice before done; tone 1–5 / ←/→ / Backspace / Enter; Enter
  checks in the reverse and cloze fields; grade keys never fire into a field or `[data-card-input]`. The docked
  primary button is a real button (Enter/Space on it work too). `KEY_HINTS` text stays and sits under the dock.
- **Accessibility:** focus ring `--focus-ring` everywhere; forced colours: grade buttons get a `ButtonText`
  bottom border (the suggested one `Highlight`, 3px), the progress line a `CanvasText` outline with a `Highlight`
  fill, choices/tiles/pads `ButtonText` borders, the correct state a `Highlight` border plus the ✓ icon; hit areas
  ≥ `--hit` on coarse pointers (grade buttons, tiles, tone buttons, choices); `prefers-reduced-motion`: the progress
  line's width transition and any fade use `--motion-*` (0ms under reduce) — no new animation beyond those.

## i18n keys (new; English text)

| Key | Text |
| --- | --- |
| `study.session.kind.vocab` | Recognise |
| `study.session.kind.reverse` | Recall |
| `study.session.kind.cloze` | Fill the gap |
| `study.session.kind.sentence` | Build the sentence |
| `study.session.kind.writing` | Write |
| `study.session.kind.tone` | Tones |
| `study.session.deckLevel` | {deck} · {level} |
| `study.session.count` | {position} / {total} |
| `study.session.progressBar` | Cards done in this session |
| `study.session.gradeNext` | {grade}, next review {when}, key {key} |
| `study.session.gradeNextSuggested` | {grade} (suggested), next review {when}, key {key} |
| `study.session.gradePractice` | {grade}, practice only, key {key} |
| `study.session.graded` | {grade}. Next review {when}. |
| `study.session.gradedPractice` | {grade}. Practice only, not counted. |
| `study.session.practice` | practice |
| `study.interval.under` | <{value} |
| `flashcards.writing.showStrokes` | Show strokes |

`study.session.gradeKey`, `study.session.gradeSuggested`, `study.session.press` and `study.session.suggested`
are removed when nothing uses them any more (the catalogue test fails on unused keys; remove them in Task 12).
The `study.cardType.*` names (Vocab, Reverse, Cloze, Word Salad, Writing, Tone) stay for deck settings, the setup
page and the XP breakdown.

## Rulings

- Ruling: the session's kind label uses the task names of the design (Recognise, Recall, Fill the gap, Build the
  sentence, Write, Tones — new `study.session.kind.*` keys), while settings, decks and the XP breakdown keep the
  card-type names (`study.cardType.*`) — the design names the exercise the learner is doing; the card types are
  stored names people configure — cost: two names per kind exist; the wiki maps them in one table.
- Ruling: the card's accessible name becomes "{task} card" ("Recognise card") — it is the visible label; the
  existing session test's `findByLabelText('Vocab card')` changes to `'Recognise card'` (a test change forced by
  the design, recorded in the Execution record) — cost: none.
- Ruling: intervals are computed by `nextIntervals` in `scheduler.ts` with ts-fsrs `repeat` on the replayed card
  — the same instance, weights (`activeWeights`) and study clock as the real grade, so the label and the
  schedule after grading agree exactly (a test grades and compares) — cost: one replay per revealed card
  (microseconds; the history is already in memory).
- Ruling: the preview `now` is the moment the card was finished (`onCardDone`), fed through the study clock like
  a review (`max(v(now), last fed instant)`) — the grade's real timestamp is a few seconds later; at minute
  granularity this never changes the label — cost: a label could be off by one minute when a learning step
  boundary falls inside those seconds.
- Ruling: a re-show (practice, never recorded) shows "practice" instead of intervals and its live message says
  "Practice only, not counted" — grading it changes no schedule, so an interval would be false — cost: none.
- Ruling: a virtual item (companion or level card not created yet) previews an empty card — that is exactly the
  card `gradeItem` creates before recording the review — cost: none.
- Ruling: interval text buckets: `≤ 60 s` → `<1m` (Anki's display of the 1-minute learning step, as the mockup shows it); `< 60 min` → minutes (rounded, min 1); `< 24 h` → hours
  (rounded); `< 30 d` → days (rounded); `< 365 d` → months (`days / 30`, rounded, min 1); else years with at most
  one decimal (`days / 365`). Units via `Intl.NumberFormat` `style: 'unit'`, `unitDisplay: 'narrow'` in the format
  locale (English: `6m`, `3h`, `1d`, `2mo`, `1.4y`); the long form via `formatRelative` ("in 6 minutes") —
  Anki's well-known buckets, and `Intl` gives every interface language its own unit letters without catalogue
  plurals — cost: narrow unit letters differ per locale (German `6 Min.`); the fixture fixes the bucket and value,
  not the string.
- Ruling: four derived tokens `readableGrade*` join the theme contract (grade colour when ≥ 4.5:1 on `panel`, else
  `text`) — the design wants grade-coloured names, small text must stay readable (design §7, the rule
  `readingAccent` already follows) — cost: a contract change (Go + web + fixture) and in weak themes a grade name
  reads in `text` with only its underline coloured.
- Ruling: the before-answer action is one docked primary button registered by the card through a face context
  (not rendered inside the card) — the design puts it in the same spot as the grade bar for every kind; a context
  keeps the cards' logic where it is — cost: card dom tests render through `testing/CardHarness.svelte` (their
  assertions stay; the render call changes — recorded as forced by the design).
- Ruling: the primary per kind — Recognise: Show answer; Recall: Check (Show answer while the field is empty;
  both call `finish()` as today); Fill the gap: Check in type mode (disabled while empty), Show answer (give up)
  in choose mode, where picking a choice is the answer; Build the sentence: Check (disabled until a tile is
  placed); Write: Show strokes (= today's "Reveal character" on the current character: the design's label; the
  give-up path and its suggested grade are unchanged); Tones: Check (disabled until every syllable has a tone) —
  the mockup's labels with today's behaviour — cost: "Reveal character" text becomes "Show strokes".
- Ruling: before done the dock shows the primary only and the grade bar appears on done (the old row of disabled
  grade buttons before the reveal goes) — the mockup shows exactly one or the other,
  and disabled buttons announced before the answer are noise — cost: none; `gradeButtons` binding and the
  suggestion focus keep working because the bar renders before `onCardDone` focuses (it awaits `tick()`).
- Ruling: the per-kind icon of the mockup's kind label is left out — the mock reused navigation icons as
  placeholders, kinds are not colour- or icon-coded by decision, and adding icons would grow the vendored set for
  no meaning — cost: none; easy to add later with `vendor-icons.mjs`.
- Ruling: deck · level on the right of the kind label: deck = the name of the card's first deck (or the virtual
  item's first `deckIds`, "General" for `general`) from the session's loaded decks; level = the level session's
  `levelName` with its scheme name, else the entry's first badge (`badgeText`), else nothing — data the session
  already has; no request is added — cost: a word in several decks shows one.
- Ruling: the frame stays during a session (no "focus mode") — #99's frame has no such mode and the mockup's
  crop shows only the panel; the session top (close, line, count) is inside the page — cost: a little less height
  on the phone; a follow-up can hide the bar if the owner wants it.
- Ruling: the learner's note keeps `NoteAnswer` (its role and label) and is restyled to the mockup's lighter note
  (a 2px `color-mix(in srgb, var(--warn) 60%, transparent)` start border, no fill, `--readable-muted` text with
  the "Your note" label in `--text`) — cost: none.
- Ruling: the completion summary keeps its content and moves onto `Section` + `Stat` (reviews, XP, level, streak
  as large light numbers) — "pages not mocked: apply §5–§6 and the base components" — cost: none.
- Ruling: after a grade, focus moves to the next card's face heading (`tabindex="-1"`, its accessible name
  "Recognise card, 13 of 50") instead of being dropped to `<body>` — screen-reader users hear the new card,
  keyboard users keep Space/Enter because a focused non-interactive heading does not block them (`isInteractive`
  only matches controls) — cost: a visible focus ring is suppressed on that heading (`:focus:not(:focus-visible)`
  rule), it shows only for keyboard focus.

## Review focus

The interval numbers equal what grading then schedules (test in Task 3 and the session test); the fixture is
generated from plain ts-fsrs; keys unchanged (every existing key test still green); the suggestion focus and
`shouldIgnoreGrade` still guard double grades; live region wording and focus move after a grade; the derived
token change in Go and web is identical (fixture); no literal colours, no opacity on text; forced colours; the card
tests' assertions unchanged (only the harness render); no change to what is recorded (`recordReview` arguments).

## Tasks

### Task 1: This plan

- [x] Written in the planning commit `docs: plans for flashcards and the reader (#101, #102)`.

### Task 2: Contract — next intervals and interval text

Files: `scripts/contracts/gen-scheduler-fixtures.mjs`, `docs/contracts/scheduler/next-intervals.json`
(generated), `docs/contracts/scheduler/interval-text.json` (hand-written), `docs/contracts/scheduler/README.md`
("Next intervals" and "Interval text" sections + the fixture table), `docs/contracts/README.md` /
`overview.md` only if they list fixture files.

- [ ] Generator: `nextIntervals` cases from **plain ts-fsrs** (`createEmptyCard`, `next` for the history,
  `repeat(card, now)` for the preview), default weights and one custom 21-weight set: a new card; after one Again
  (learning step 1); after Good (step 2); a review card at 4 days; a review card reviewed early (same day); a
  relearning card; a card at the maximum interval; one case with a vacation run between the last review and `now`
  (plainly shifted dates, as `vacation-schedule.json` does). `expected`: per grade 1–4 the `due` instant and
  `ms = due − now`.
- [ ] `interval-text.json`: `{ms, unit, value}` cases on both sides of every bucket edge (59 999 ms, 60 000 → `<1m`, 60 001 → `1m`,
  3 599 999, 86 399 999, 30 d − 1 ms, 365 d − 1 ms, 1.44 y, 0, negative → `<1m`).
- [ ] README: the rules (Ruling text above, as contract), "Fixtures win over code", Android implements both.
- [ ] Test first (fails: no files): extend `apps/web/src/lib/contractsDocs.test.ts` expectations only if it
  enumerates fixtures; the generator's byte-for-byte self-check passes.
- [ ] Commit `docs(contracts): next intervals and interval text (#101)`.

### Task 3: `nextIntervals` in the scheduler

Files: `apps/web/src/lib/study/scheduler.ts`, test `apps/web/src/lib/study/nextIntervals.test.ts`.

- [ ] Tests (fail first): `decodes next-intervals.json: every case's four ms values`; `null previews an empty
  card`; `uses the same weights instance as scheduleFor` (spy on `fsrs` options: only `{w}`);
  `grading then scheduleFor gives the previewed due for each grade` (append a review at `now` with each grade
  and compare `scheduleFor(...).due`); `a study clock run shifts the due exactly as the replay does`.
- [ ] Implement with the private `replay` (capture the last `Card` and last fed instant), `repeat`, `clock.inverse`.
- [ ] Commit `feat(web): preview the next interval of each grade (#101)`.

### Task 4: Readable grade tokens (theme contract, Go + web)

Files: `server/internal/themes/derive.go` (+ test), `docs/contracts/themes/derive.json`,
`docs/contracts/themes/README.md` (derived table rows, CSS table rows), `apps/web/src/lib/theme/derive.ts`
(`Derived.readableGrades`, `TOKEN_NAMES` `--readable-grade-again|hard|good|easy`, `cssVariables`),
`apps/web/src/lib/theme/derive.test.ts`, `apps/web/src/lib/theme/fallback.ts` + `apps/web/src/app.html` if they
inline the compiled Latte/Mocha tokens (first paint).

- [ ] Fixture cases first: a grade at 4.49 and 4.5 on `panel` (both sides), Latte and Mocha and Gruvbox real
  values. Go test `TestDeriveFixture` and web `derive.test.ts` fail (missing members), then pass.
- [ ] The first-paint fallback carries the four new properties (its existing test lists every `TOKEN_NAMES`
  entry — it fails first).
- [ ] Commit `feat(themes): readable grade text tokens (#101)`.

### Task 5: Interval text

Files: `apps/web/src/lib/study/intervalText.ts`, test `intervalText.test.ts`, `en.json` (`study.interval.under`).

- [ ] Tests (fail first): `decodes interval-text.json (unit and value)`; `short labels in English: <1m, 6m, 3h,
  1d, 4d, 2mo, 1.4y`; `long labels: in 6 minutes, in 1 day` (via `formatRelative`); `a German format locale gives
  German unit letters` (install a catalogue with locale `de`); `the pseudo locale wraps the under-a-minute text`.
- [ ] `intervalParts(ms)`, `shortInterval(ms)`, `longInterval(ms)`; formatting only through
  `lib/i18n/format.ts` (`formatNumber` with unit options, `formatRelative`).
- [ ] Commit `feat(web): interval labels for the grade buttons (#101)`.

### Task 6: Face context, StudyFace, the three regions, CardHarness

Files: `apps/web/src/lib/features/flashcards/face/cardFace.svelte.ts`, `StudyFace.svelte`, `SessionTop.svelte`,
`FaceHeader.svelte`, `FacePrompt.svelte`, `FaceWork.svelte`, `FaceAnswer.svelte`, `ActionDock.svelte`,
`face/testing/CardHarness.svelte`, test `face/StudyFace.dom.test.ts`, `en.json` (`study.session.kind.*`,
`deckLevel`, `count`, `progressBar`).

- [ ] Tests (fail first): `renders session top, header, card regions and dock in this order`; `the close button is
  an IconButton named End session that links to /study, with a tooltip`; `the progress line is a progressbar with
  aria-valuenow / valuemax and the count text`; `the header shows the kind in the accent, deck · level on the
  right, and the re-show and tier chips`; `a registered primary renders one primary Button in the dock and runs
  on click`; `no primary and not done: the dock shows only the keys line`; `useCardFace outside a face throws`;
  `the face heading has tabindex -1 and the card's accessible name`; source assertions: no literal colours, the
  progress line's transition uses `--motion-medium`, a `forced-colors` block exists.
- [ ] Layout (mockup `.sess`, `.fcwrap`, `.fc`): column max 33.75rem centred; the page grid is `auto 1fr auto`
  so the dock stays at the bottom of the viewport (`position: sticky; bottom: 0` with
  `padding-bottom: max(var(--space-3), env(safe-area-inset-bottom))`, `--panel` background so text scrolls under
  it, a `--hair` top line only while content is under it); progress line 3px, `--raised` track, `--accent` fill,
  radius 3px; count `--font-size-label`, `--readable-muted`, `tabular-nums`; kind label `--font-size-label`,
  weight 500, `--reading-accent`; deck · level weight 400 `--readable-muted`.
- [ ] Commit `feat(web): the open-page study face (#101)`.

### Task 7: GradeBar

Files: `apps/web/src/lib/features/flashcards/face/GradeBar.svelte`, test `GradeBar.dom.test.ts`, `en.json`
(`gradeNext`, `gradeNextSuggested`, `gradePractice`, `practice`).

- [ ] Props: `{intervals: Record<ReviewGrade, number> | null (null = practice), suggested: ReviewGrade | null,
  busy: boolean, ongrade(grade, source), buttons = $bindable()}`.
- [ ] Tests (fail first): `four buttons in grade order named "Good, next review in 1 day, key 3"`; `each shows the
  short interval as visible text`; `the suggested one is named "(suggested)" and carries data-suggested`;
  `practice: names say practice only and the interval text is "practice"`; `busy disables all four with
  aria-busy on the group`; `detail 0 click reports activation, a pointer click reports click`; `role group named
  Grade this card`; source assertions: text colours are `--readable-grade-*`, lines `--grade-*`, no `title`
  attribute, a forced-colours block with `ButtonText` / `Highlight`.
- [ ] Commit `feat(web): grade buttons with their next interval (#101)`.

### Task 8: Recognise and Recall onto the face

Files: `cards/VocabCard.svelte`, `cards/ReverseCard.svelte`, their dom tests, `cards/audioButton.test.ts`.

- [ ] Tests first: switch the render to `CardHarness` (assertions unchanged — they fail until the cards register
  their primary and use the regions); add `VocabCard: registers Show answer as the primary before the reveal`;
  `ReverseCard: the primary reads Show answer while empty and Check once something is typed`; `ReverseCard: the
  field is an underline Field with its visible label`.
- [ ] Vocab: prompt = the word (4rem, `--font-hanzi`, weight 400) and, when shown before the reveal, nothing else;
  answer = readings row (reading `--reading-accent` weight 500 + the play button as an outlined round
  IconButton `sound`), glosses, source line (`--font-size-label`, `--readable-muted`). Recall: prompt = part of
  speech (muted) + meaning (1.375rem, 500); work = `Field` (underline) with "Type the word", "Show reading" plain
  button; answer = word + readings + glosses; ✓/✕ icon next to the status text.
- [ ] Commit `feat(web): Recognise and Recall cards on the open page (#101)`.

### Task 9: Fill the gap onto the face

Files: `cards/ClozeCard.svelte`, `components/ClozeChoice.svelte` (if it renders the choices), dom tests.

- [ ] Tests first via harness, plus `type mode: primary Check disabled while empty, Show answer is a plain button
  in the work area`; `choose mode: primary Show answer gives up; choices are buttons with their digit`.
- [ ] Prompt: sentence 1.5rem `--font-hanzi`, line height 1.6, the gap a 2px `--accent` underline (correct:
  `--good` line + ✓); translation muted below. Choices: 2-column grid, max 22.5rem, transparent, 1px `--hair`
  outline, radius `--radius`, digit small muted; correct: 1.5px `--good` outline + ✓ icon.
- [ ] Commit `feat(web): Fill the gap on the open page (#101)`.

### Task 10: Build the sentence onto the face

Files: `cards/SentenceCard.svelte`, `cards/WordSaladBoard.svelte`, new `cards/SentenceCard.dom.test.ts`.

- [ ] Tests (fail first): `prompt is the translation and "Uses <word>"`; `tiles move from the pool to the
  slots and back`; `primary Check is disabled until a tile is placed and checks`; `Undo and Show answer are
  secondary in the work area`; `the live feedback text is unchanged`.
- [ ] Slots: a row with a 1px `--hair` bottom line (no box); tiles transparent with a 1px `--line` outline, radius
  `calc(var(--radius) * 0.7)`, 1.125rem CJK; solved: `--good` outline + ✓ next to the feedback.
- [ ] Commit `feat(web): Build the sentence on the open page (#101)`.

### Task 11: Write onto the face

Files: `cards/WritingCard.svelte`, `cards/WritingPad.svelte`, new `cards/WritingCard.dom.test.ts`, `en.json`
(`flashcards.writing.showStrokes`; `flashcards.writing.reveal` removed if unused).

- [ ] Tests (fail first, `WritingPad` stubbed like the session test stubs stroke data): `prompt shows the word with
  the current character as a box and the reading · meaning below`; `primary Show strokes reveals the current
  character (same outcome and suggestion as before)`; `Hint is a secondary button`; `the progress dots are a list
  with the existing labels`; `the canvas keeps role img and its label`.
- [ ] Pad: 12.5rem square, transparent, 1px `--hair` outline, the guide lines in `--hair` dashed; the stroke colour
  reads `--accent` (and `--good` once correct) from computed style (canvas cannot use `var()`: read
  `getComputedStyle(pad).getPropertyValue('--accent')` once per draw; the colour lint does not apply to `.ts`).
  Dots: 8px, `--line` / `--accent` (current) / `--good` (done) with their labels (shape + text, not colour alone).
- [ ] Commit `feat(web): Write on the open page (#101)`.

### Task 12: Tones onto the face

Files: `cards/ToneCard.svelte`, new `cards/ToneCard.dom.test.ts`.

- [ ] Tests (fail first): `one pad per syllable with role img and its tone in the name`; `1–5 sets the highlighted
  syllable, ←/→ move, Backspace clears, Enter checks (keys unchanged)`; `primary Check is disabled until every
  syllable has a tone`; `the selected tone number is pressed (aria-pressed) and underlined, not filled`.
- [ ] Pads: 6.875rem squares, transparent, 1px `--hair` outline; current 1.5px `--accent`; correct 1.5px `--good`
  + ✓; the contour stroke `--accent`/`--good` via `currentColor`; tone numbers plain text buttons, selected:
  `--reading-accent` + a 1.5px underline.
- [ ] Commit `feat(web): Tones on the open page (#101)`.

### Task 13: The session runs on the face

Files: `apps/web/src/routes/study/session/+page.svelte`, `routes/study/session/page.dom.test.ts`,
`apps/web/src/lib/notes/NoteAnswer.svelte` (restyle), `en.json` (`graded`, `gradedPractice`; remove
`gradeKey`, `gradeSuggested`, `press`, `suggested` when unused).

- [ ] Tests (fail first): `shows the next interval on each grade button once the card is done` (default weights,
  a new card: Again `<1m`, Hard `6m`, Good `10m` — take the expectations from the generated fixture, never adjust
  the fixture to the test); `the label equals the schedule the grade
  produces` (grade Good, then read the card's `scheduleFor` due from the recorded review); `announces "Good. Next
  review in 10 minutes." in a polite status after a grade`; `a re-show says practice and announces practice
  only`; `moves focus to the next card's heading after a grade`; `Space reveals and 1–4 grade (unchanged)`; `the
  kind label reads Recognise and the deck · level shows the level`; existing test `'Vocab card'` →
  `'Recognise card'` (forced by the design).
- [ ] Implement: `provideCardFace()`; `intervals = $derived(done && resolved ? (reshow ? null :
  nextIntervals(...)) : null)` with `finishedAt` set in `onCardDone`; the live region (one `role="status"
  aria-live="polite"` element outside the `{#key}`, text replaced per grade); focus the face heading after
  `index` changes (await `tick()`); remove the old `.card`, `.badges`, `.grades`, `.grade-*` styles.
- [ ] Summary and states: `Section` + `Stat` + `Button`/links per §5 (no dashed boxes); the XP progress bar on
  tokens; the 🔥 emoji stays decorative (`aria-hidden`).
- [ ] Commit `feat(web): the study session on the open page (#101)`.

### Task 14: Docs and wiki

Files: `docs/wiki/Flashcards-study-sessions.md` (layout, the six task names ↔ card types table, the grade bar with
its intervals, "practice" on re-shows, keys unchanged), `docs/wiki/Scheduling-and-FSRS.md` (the interval preview
and its buckets), `README.md` (only if it describes the session screen), `docs/contracts/themes/README.md` (if
the component list should name the face: it is a feature, not a base component — leave it out, say so).

- [ ] `npx vitest run src/lib/wikiDocs.test.ts src/lib/contractsDocs.test.ts` green. Commit
  `docs: flashcards open page and grade intervals (#101)`.

### Task 15: Visual check (Playwright, permitted for this run)

- [ ] Build the web app, embed and start the Go server on a free 127.0.0.1 port (not 8080/8085/8300) from a
  scratch data dir in the scratchpad (`scripts/smoke-embed.sh` shows the staging; seed `qinqin seed --packs
  plugins/samples` for `zh-mini` / `hsk-mini`, and the strokes pack from `scripts/prepare-strokes-pack.mjs` for
  Write); register a user via the API, create a Chinese workspace, add words to a deck, enable all six card types
  in the setup, start a session (`sessionStorage` config as the setup page writes it).
- [ ] Library only: `require('/home/user/qq-tools/pw/node_modules/playwright-core')`, Chromium at
  `/home/user/.cache/ms-playwright/chromium-1161/chrome-linux/chrome`. For each kind that the sample data makes
  eligible, screenshot **before** and **after** the answer at 360, 1024 and 1440 px in Catppuccin Latte (light),
  Catppuccin Mocha (dark), Gruvbox and Nord (appearance row PUT through the API), plus `forcedColors: 'active'` and
  `reducedMotion: 'reduce'` at 1024 px. Compare by eye with the mockup (open the mockup HTML with Playwright, kind
  and moment switches, Lighter weight) — same four parts in the same places, dock at the bottom, grade underline
  colours, suggested wash.
- [ ] Measure and record: the grade names' contrast against `--panel` via `getComputedStyle` (≥ 4.5:1 in all four
  themes), the dock stays inside the viewport at 360×640 with the on-screen content scrolled, no horizontal
  scroll at 360 px, the interval labels match `nextIntervals` for the shown card, no console errors or failed
  requests, `--motion-medium` computes to `0ms` under reduce.
- [ ] Keep `docs/superpowers/handoffs/assets/vr-flashcards-before-1440-latte.png` (from the merge base) and
  `vr-flashcards-after-1440-latte.png`, `vr-flashcards-after-360-mocha.png` (PNG, each under 200 kB); delete every
  other screenshot and the scratch data dir. Kinds the sample data cannot produce: say so ("not verified
  visually") — never fake data in the repo for them.

### Task 16: Gates and Execution record

- [ ] Full `npx vitest run`, `npm run check`, `npm run build` (Node 26), the Go gate `./...`,
  `node scripts/check-sources.mjs`; fill the Execution record (commits, gate commands with exit codes, test-first
  evidence, adaptations, rulings added while building, measured numbers, changed existing tests and why, what was
  not verified); commit `docs(plan): flashcards execution record (#101)`.

## Task dependencies

2 → 3; 2 → 5 (5 needs only the text fixture); 4 independent; 6 independent of 3–5; 7 needs 4 and 5; 8–12 need 6 (any order); 13 needs 3, 7 and 8–12; 14 after 13; 15 after 14; 16 last.

## Execution record

(empty — filled by the builder)
