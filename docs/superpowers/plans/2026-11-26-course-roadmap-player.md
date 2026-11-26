# Course roadmap, lesson player and progress (web) — plan (issue #222)

Overview: `docs/superpowers/specs/2026-11-26-v090-courses-overview.md` (stage C; §3.8 holds the owner's roadmap design).
Design: courses design §7–§8. Needs #221 (filled course route, `lib/course/path.ts` with the `resume` position and the
section gate, event builders, `courses` feature id, the deck-membership helper). Web only: the Android shell gets it
through the web app (ADR 0010); no native code, no `@capacitor/*` import. No contract change of its own (it uses
#221's). Builder: one agent, branch `feature/v090-course-ui` from `develop` (after #221 is merged, or on top of it
with fixtures only: build against `path.json` and a test course).
Test first in every task; one commit per task; UI strings only in `en.json` (hardcoded-text lint); buttons through
the shared `Button` (the colour-control lint rejects raw styled buttons).

## What the owner asked for (2026-11-26, decision 10)

The roadmap is displayed as an **almost infinite vertical scroll** down to the final lesson. **Each lesson is a
circle** (an illustration may come later: reserve a slot). The circles are joined by a **zig-zagging connection
going down**. **Section tests are blockades** between sections, for now **visibly different as a rectangle or wall**;
you cannot get to the next section until you pass it. **"Continue course"** brings the learner to the last lesson
they started, or to the next one to start if the last one was finished. **Each lesson's flashcards are also added
to the general deck.**

## Shape

- **Route** `/course` (`apps/web/src/routes/course/`), feature `courses` (`lib/features/course/`, registered in
  `lib/features/index.ts` and `switches`), bottom-bar entry in the section list (#188; users choose their sections),
  hidden when the feature is off or no course is installed for the workspace language. `?at=<ref>` optionally
  names a row to open on; without it the page opens on `resume`.
- **Rows.** A pure function `buildRows(filledCourse, path)` (`lib/course/roadmap/rows.ts`) flattens the course into
  one list of rows, in reading order; each row has a stable `ref` (`s1`, `s1.u03`, `s1.u03.w2`, `s1.u03.test`,
  `s1.exam`) and a state from `path.ts`:
  - `section` header row (name, level, progress "12 of 20 units"), 72 px;
  - `unit` label row (small caption "Unit 3 · Food"), 40 px;
  - `lesson` circle row (types `words | script | grammar | practice | reading | check`), 96 px; state `done | current |
    started | todo | locked | skipped`;
  - `unitTest` circle row at the end of each unit (the circle with a check badge; Ruling 5 of the overview), 96 px;
  - `exam` wall row at the end of each section except the last (the last section's exam closes the course; it is a
    wall too, with the finish line after it), 96 px; state `closed | passed | skippedPast`;
  - `end` row: the finish ("Course complete") and the pointer to free study, 120 px.
  Heights are **constants, not measured**, so the whole layout is arithmetic and testable without a DOM.
- **Zig-zag layout.** `layoutRows(rows, width)` (`layout.ts`) returns, per row, `top` (prefix sum of the heights) and,
  for circle rows, `cx` (centre x). The x offset cycles through the S-curve `[0, +1, 0, −1]` × `amplitude`, counted
  per section so each section starts centred; `amplitude = min(72 px, (width − 2·radius − 2·margin) / 2)` (a narrow
  phone gets a gentler zig-zag, never a clipped one); circle radius 36 px. A wall row spans the full content width
  (minus the margin) and is centred, so the path "runs into" it. The connection between two consecutive circles
  is one cubic Bézier from the bottom of the first to the top of the next with vertical control points at the
  middle (`connectorPath(a, b)`), drawn in one SVG per visible window segment, `aria-hidden`. Connector state follows
  the later circle: solid when it is `done` or `skipped`, dashed when it is `current` or `todo`, dim dashed when
  `locked`. Pure function, table tests with fixed widths (320, 360, 412, 768) including the first and last row,
  a unit with one lesson, a section with an odd count, and a width too narrow (amplitude 0, still valid).
- **Windowed list (the "almost infinite" scroll).** About 130 units give roughly 700 circles (about 70,000 px); only
  the rows in `[scrollTop − overscan, scrollTop + viewport + overscan]` are in the DOM (overscan one viewport).
  `windowRows(layout, scrollTop, viewport, overscan)` binary-searches the prefix sums and returns the index range;
  a spacer element of the full height keeps the scrollbar honest. The scroll container is the page's main scroller
  (as the other long lists do, check `lib/ui/` for the existing scroll helper before adding one); a scroll
  listener batched with `requestAnimationFrame` updates the range. Width changes (`ResizeObserver`) re-run
  `layoutRows`. Jumping to a row (`scrollToRef(ref)`) is arithmetic: the target `top` minus a third of the viewport,
  clamped; no DOM measurement and no layout shift. A learner sees no list "page" and no "load more".
- **Circles.** A lesson circle shows the type icon (vendored icon set, `lib/ui/icons`) and, once done, a check; the
  current one is larger, has a ring and the label "Start" or "Continue" (when `started`); locked ones show a lock;
  skipped ones a small "skipped" mark. **Illustration slot:** the circle component takes an optional `art`
  prop (an image reference from the course pack's lesson data, absent in v0.9.0); when present it fills the circle
  under the state mark. No art is built or bundled now. State is never colour alone (icon + ring + text label);
  fills use theme tokens (`--chrome`, surface and accent tokens), **tone colours are not used for state**.
- **Walls.** A section exam is a full-width rectangle with a brick-like hatch (CSS gradient, no image), a lock
  icon and the text "Section exam: <section> · pass 85 % to continue" (`passMark` from the pack). States: `closed`
  (the section's lessons beyond it are drawn locked), `passed` (the wall is drawn open: split with a gap, a check),
  `skippedPast` (a later exam or placement passed: drawn open with "skipped"). The wall is a real
  button ("Take the section exam") in every state but `skippedPast` ("Retake" after passing); retries are free.
- **Blocked state of what lies behind a wall.** The circles of the next section are drawn and focusable but
  `locked` (dim, lock icon), and their accessible name says why ("locked: pass the exam of <section> first"); they
  can be browsed, never started (activation opens a short dialog "Pass the section exam to continue, or take a unit
  test to skip ahead" with the buttons to the exam and the unit test). The section gate is the derivation's
  (#221 `path.ts`, Ruling 6 of the overview); the screen only draws it.
- **Continue course.** A button at the top of the page ("Continue course") and in the Home widget (#225) scrolls to
  and focuses `resume.ref` (the last started lesson, else the next to start; #221). When the `resume` row is
  outside the window a floating "Back to current lesson" button appears (it replaces nothing and is hidden when the
  row is visible). The initial scroll position is set before the first paint (no flash from the top).
- **Lesson player** (`lib/course/player/`): a full-screen flow like the study session (thin progress line, docked
  actions, no bottom bar, Back asks to leave through the shared dismiss stack, `lib/ui/dismissStack`). A pure state
  machine `playerMachine.ts` (steps, answers, result) with table tests; the Svelte shell only renders it. Starting
  a lesson writes `lesson-start` (the roadmap shows `started`); leaving mid-lesson saves nothing else.
- **Lesson types** (each a small component hosting an existing one):
  - `words`: the unit's 5–7 words as cards using the existing card view with Starter stages, pictures and hints
    where they exist (#214, #215, #216); on first exposure the card is created and **joins `d-course-<lang>` and
    General** through the shared helper `lib/course/cards.ts` (#221: rules there: existing cards are reused, decks
    are only added to, never removed), graded in the lesson; the `lesson-done` event carries `wordKeys`;
  - `script`: the writing-system trainer (#204) and the writing card; only for units that list script steps;
  - `grammar`: a shipped grammar lesson and its exercises (existing grammar views; progress also written to
    `/api/grammar/progress` as today);
  - `practice`: a mixed round over the unit's words with every card kind the language has (reuse the session
    mixer `lib/study/sessionMix.ts`); listening/speaking items only when their card kind exists (none today);
  - `reading`: the unit's text opened as a **pack text** in the reader (see overview §3.3), readings forced on for
    words beyond the learner's progress, a "done reading" button;
  - `check`: a short check (3–5 items of the lesson) and a summary; never fails the lesson.
- **Course words and daily limits:** first reviews inside a lesson are exempt from the new-card limit (#221 task 6);
  the lesson pace is the limit; "Continue course" is never a dead end. A card created by a lesson but not graded
  (the learner left) is an ordinary new card in General and then counts against the new-card limit like any other.
- **Skipped units:** the roadmap offers "Add these as cards" on a skipped unit (the existing batch add; the cards
  join `d-course-<lang>` and General by the same rule) and the known marks carry `source: "course"` with the skip's
  batch id so Undo works. Undo removes the known marks of that batch only; cards already created stay.
- **Offline:** "Prepare the course" step in the offline preparation: the filled course JSON, the texts and the
  entries of the current section into the existing cache; lessons work offline once prepared; progress events and
  the card rows go through the outbox. The roadmap itself needs only the filled course and `path.ts` (no network).
  Measure the cached size in the emulator job's storage report.

## Accessibility (the roadmap is a list, not a picture)

- **Structure.** The visible window is a `role="list"` of `role="listitem"` rows in document order = visual order =
  reading order (section header, unit caption, lessons, unit test, wall). Because rows outside the window are not in
  the DOM, every listitem carries `aria-posinset` and the list `aria-setsize` (the full row count), so assistive
  technology announces "item 245 of 712". The section header row is an `<h2>`, the unit caption plain text.
- **Names and states.** Each circle is one button (shared `Button`) whose accessible name is the full sentence:
  "Lesson 2 of 4, Food, Unit 3 of 14, Section 1: words, done" / "…current" / "…started, continue" / "…locked: finish the
  earlier lessons or take the unit test to skip ahead" / "…skipped". The wall is "Section exam, Section 1, pass 85
  percent, not passed yet" / "…passed". Locked ones use `aria-disabled="true"` (still focusable, so the reason is
  heard), never `disabled`. Connectors and the illustration slot are `aria-hidden`.
- **Keyboard.** Roving tabindex: **Tab** enters the list once, on the `resume` row (or the focused row); **Up/Down**
  move by one row, **Home/End** to the first and last, **PageUp/PageDown** by about a viewport; **Enter/Space**
  activates. Moving past the window scrolls the target in (`scrollToRef`) and focuses it after the next frame. A
  "Sections" disclosure above the list (a real, short list of the sections as links) jumps to a section header, and
  "Continue course" jumps to `resume`; both work without the list. Focus is visible (the shared focus ring).
- **Screen reader order and live text.** A polite live region announces results of jumps ("Lesson 3, current") and
  the dialog for a locked row; nothing announces scrolling.
- **Reduced motion.** With `prefers-reduced-motion: reduce`: jumps are instant (no smooth scrolling), the current
  circle does not pulse, the wall "opening" is a state change without animation. Without the preference the
  current circle pulses slowly and jumps scroll smoothly (CSS `scroll-behavior` is not used; the scroll call picks
  `behavior` from `matchMedia`).
- **Themes and contrast.** Only theme tokens (qinqin Day and Night, high-contrast themes, forced colours): shapes
  have borders (`currentColor`/`CanvasText` in forced colours), the hatch of the wall uses a border plus the lock icon
  so the wall remains a wall without colour, the connector keeps its dash pattern. Contrast of the label text on the
  circles is checked against the tokens (a unit test over the token pairs, as the theme tests do).
- **Touch.** Circles are at least 48 px targets (72 px diameter drawn); the zig-zag amplitude never moves a
  circle under the system gesture area (margin 24 px).

## Tasks

1. **Route, feature, data loader**: `/course` page, `courses` switch, `lib/course/load.ts` store with an
   "unavailable offline" state, i18n keys `course.*`; jsdom test for the empty and the loaded state.
2. **Player machine** (`playerMachine.ts`): pure, table tests for each lesson type's steps, leaving mid-lesson
   (only `lesson-start` saved), finishing (event payload), retrying.
3. **Rows and layout (pure)**: `buildRows`, `layoutRows`, `connectorPath`, `windowRows`, `scrollTarget`; table
   tests listed above (the four widths, one-lesson unit, last section, deterministic output, window edges: top,
   bottom, a jump near the end, an empty course = only the `end` row). No DOM.
4. **Roadmap components**: `CourseRoadmap.svelte` (the window, spacer, one SVG for connectors),
   `LessonCircle.svelte` (states, icon, art slot), `SectionWall.svelte`, `SectionHeader.svelte`; jsdom tests with a
   fixed viewport prop (jsdom has no layout): the right rows render, states and names, the current circle has the
   ring, locked rows are `aria-disabled`, the wall states, the art slot is empty by default.
5. **Accessibility and keyboard**: roving tabindex, arrow/Home/End/Page keys, jump past the window, the Sections
   disclosure, Continue and the floating "Back to current lesson", the polite live region; reduced-motion branch
   tests (stub `matchMedia`); a test that `aria-posinset`/`aria-setsize` are right at the window edges.
6. **Resume and deep link**: the page opens on `resume.ref` or `?at=`; the initial scroll is set before paint
   (assert the first computed `scrollTop`); a test for each case: nothing started, a started lesson, a finished
   last lesson (opens on the next), a finished course (opens on the `end` row).
7. **`words` lesson**: first-exposure card creation joining `d-course-<lang>` and General, grading, the event; test
   with a fake study store: a new word creates one card in both decks; a word that already has a card is reused
   and only gains the missing decks (never loses one); a card the learner moved out of General is not put back; the
   first review does not count against the new-card limit.
8. **`grammar` and `reading` lessons** (the two with the most reuse), then **`practice`** and **`script`**.
9. **Skip / add-as-cards / undo** on the roadmap through the declaration helpers of #74
   (`lib/placement/declare.ts`); a test that Undo only removes this batch and keeps created cards; "Add these as
   cards" joins both decks.
10. **Offline preparation step** + service worker cache entry (`lib/pwa`); a unit test of the plan (what is
    requested for a course); the e2e spec `e2e/tests/course.spec.ts` (written here, run in CI only: open the
    roadmap, start a lesson, finish a words lesson, reload, the circle shows done and the card is in General).
11. **Emulator check:** add the course page to the extended emulator suite's page list (Day and Night) — only the
    extended suite (nightly); the suite scrolls to the end once to check the window.
12. **Docs:** wiki `Courses.md` (the learner's guide: the path, walls, Continue, the General deck), `Settings-tour`
    (feature switch), `docs/architecture` only if a rule changes, ROADMAP.
13. **Verify:** `npm run check`, `npm test` in `apps/web`, merge `origin/develop`, PR; core emulator job passes.

## Rulings

- Ruling: the roadmap is a **windowed list with constant row heights** — a 700-circle scroll as real DOM would be
  slow on a phone and measuring rows would make jumps and the scrollbar unreliable — if wrong (a row grows, for
  example a larger text size), circles overlap or leave gaps (cost: rows take a height from the root font size
  once, `rem` constants, instead of measured heights; the pure functions stay).
- Ruling: the zig-zag is a **fixed S-curve per section** (`[0, +1, 0, −1]` × amplitude), not random — it is
  deterministic (same course, same picture on every device), testable, and a section always starts centred — if
  wrong, the pattern looks mechanical (cost: another table of offsets).
- Ruling: **unit tests are circles with a check badge, section exams are walls** (overview Ruling 5) — if wrong, the
  unit test needs another look (cost: a component and its states).
- Ruling: locked rows behind a wall are **visible and focusable but not startable** — the learner sees how far the
  course goes, a screen reader hears why — if wrong, a learner is frustrated by locked circles (cost: hide beyond
  the next wall).
- Ruling: **"Continue" goes to the last started lesson** even when later lessons are done elsewhere (overview
  Ruling 7) — if wrong, one extra tap (cost: none).
- Ruling: the player is a **pure state machine plus thin Svelte shells** — six lesson types in one component would be
  untestable without a browser, and no local browser is available — if wrong, the machine's step model is too
  small for a lesson type (cost: that type gets its own sub-machine; the interface allows it).
- Ruling: `practice` and `script` are the last lesson types built — they have the most variation and the least
  to show on a first release; the course works with `words`, `grammar`, `reading` and `check` — if wrong, the
  first version feels thin (cost: a flag in the skeleton skips a type; units without them still work).
- Ruling: a lesson type whose card kind is not installed (listening, speaking) is **skipped silently** — the
  skeleton does not depend on features that come after v1.0 — if wrong, a unit looks shorter (cost: none).
- Ruling: lesson cards join General **once, at first exposure** (overview Ruling 8) — if wrong, a course word may be
  missing from General sessions after a manual move (cost: a later "Re-add course cards" action).

## Needs human review

The roadmap's look and the lesson flow on a **real phone** (nothing was drawn in a browser, by rule): the zig-zag
amplitude and spacing, the wall's look in qinqin Day and Night and high contrast, whether the long scroll stays
smooth, Back behaviour, the reading lesson's readings, TalkBack reading order and the "item N of M" announcement. No
native-speaker review. The illustration slot is empty until art exists.

## Done when

A learner can open the roadmap, scroll through the whole test course in one scroll (circles joined by the zig-zag,
a wall between sections), start and finish a words lesson, a grammar lesson and a reading lesson, see them done
after a reload, find the words in General, use "Continue course" to land on the right lesson, skip a unit and undo
it; the section wall blocks the next section until its exam is passed; keyboard and screen-reader paths work;
offline works after preparing; CI green.
