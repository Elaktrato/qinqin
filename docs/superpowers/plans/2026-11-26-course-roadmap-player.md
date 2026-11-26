# Course roadmap, lesson player and progress (web) — plan (issue #222)

Overview: `docs/superpowers/specs/2026-11-26-v090-courses-overview.md` (stage C). Design: courses design §7–§8. Needs #221
(filled course route, `lib/course/path.ts`, event builders, `courses` feature id). Web only: the Android shell gets
it through the web app (ADR 0010); no native code, no `@capacitor/*` import. No contract change of its own (it
uses #221's). Builder: one agent, branch `feature/v090-course-ui` from `develop` (after #221 is merged, or on
top of it with fixtures only: build against `path.json` and a test course).
Test first in every task; one commit per task; UI strings only in `en.json` (hardcoded-text lint).

## Shape

- **Route** `/course` (`apps/web/src/routes/course/`), feature `courses` (`lib/features/course/`, registered in
  `lib/features/index.ts` and `switches`), bottom-bar entry in the section list (#188; users choose their sections),
  hidden when the feature is off or no course is installed for the workspace language.
- **Roadmap view** (`CourseRoadmap.svelte`): sections as headers, units as a path, the current lesson highlighted;
  states done / current / locked / skipped from `path.ts`; milestones as markers (data supplied by #225, a stub
  list before that); "Take the unit test" / "Take the section exam" on locked parts (opens #224's flow; a disabled
  button with a note before #224 lands). Phone first; a long path is virtualised by section (collapsed sections
  except the current one). Visual rules: the visual rework rules, `--chrome`, tone colours not used for state.
- **Lesson player** (`lib/course/player/`): a full-screen flow like the study session (thin progress line, docked
  actions, no bottom bar, Back asks to leave through the shared dismiss stack, `lib/ui/dismissStack`). A pure
  state machine `playerMachine.ts` (steps, answers, result) with table tests; the Svelte shell only renders it.
- **Lesson types** (each a small component hosting an existing one):
  - `words`: the unit's 5–7 words as cards using the existing card view with Starter stages, pictures and hints
    where they exist (#214, #215, #216); the card is created on first exposure (`c-vocab-<entryId>` in
    `d-course-<lang>`), graded in the lesson; the `lesson-done` event carries `wordKeys`;
  - `script`: the writing-system trainer (#204) and the writing card; only for units that list script steps;
  - `grammar`: a shipped grammar lesson and its exercises (existing grammar views; progress also written to
    `/api/grammar/progress` as today);
  - `practice`: a mixed round over the unit's words with every card kind the language has (reuse the session
    mixer `lib/study/sessionMix.ts`); listening/speaking items only when their card kind exists (none today);
  - `reading`: the unit's text opened as a **pack text** in the reader (see overview §3.3), readings forced on for
    words beyond the learner's progress, a "done reading" button;
  - `check`: a short check (3–5 items of the lesson) and a summary; never fails the lesson.
- **Course words and daily limits:** first reviews inside a lesson are exempt from the new-card limit (#221
  task 6); the lesson pace is the limit; "Continue course" is never a dead end.
- **Skipped units:** the roadmap offers "Add these as cards" on a skipped unit (the existing batch add), and the
  known marks carry `source: "course"` with the skip's batch id so Undo works.
- **Offline:** "Prepare the course" step in the offline preparation: the filled course JSON, the texts and the
  entries of the current section into the existing cache; lessons work offline once prepared; progress events go
  through the outbox. Measure the cached size in the emulator job's storage report.

## Tasks

1. **Route, feature, data loader**: `/course` page, `courses` switch, `lib/course/load.ts` store with an
   "unavailable offline" state, i18n keys `course.*`; jsdom test for the empty and the loaded state.
2. **Player machine** (`playerMachine.ts`): pure, table tests for each lesson type's steps, leaving mid-lesson
   (nothing saved except started), finishing (event payload), retrying.
3. **Roadmap** component + jsdom tests for done/current/locked/skipped, the current lesson highlighted, collapsed
   sections, an empty course, keyboard (path is a list; focus goes to the current lesson on open).
4. **`words` lesson**: first-exposure card creation, grading, the event; test with a fake study store; verifies
   the first review does not count against the new-card limit.
5. **`grammar` and `reading` lessons** (the two with the most reuse), then **`practice`** and **`script`**.
6. **Skip / add-as-cards / undo** on the roadmap through the declaration helpers of #74
   (`lib/placement/declare.ts`); a test that Undo only removes this batch.
7. **Offline preparation step** + service worker cache entry (`lib/pwa`); a unit test of the plan (what is
   requested for a course); the e2e spec `e2e/tests/course.spec.ts` (written here, run in CI only: start a
   lesson, finish a words lesson, reload, the roadmap shows it done).
8. **Emulator check:** add the course page to the extended emulator suite's page list (Day and Night) — only the
   extended suite (nightly).
9. **Docs:** wiki `Courses.md` (the learner's guide), `Settings-tour` (feature switch), `docs/architecture` only if
   a rule changes, ROADMAP.
10. **Verify:** `npm run check`, `npm test` in `apps/web`, merge `origin/develop`, PR; core emulator job passes.

## Rulings

- Ruling: the player is a **pure state machine plus thin Svelte shells** — six lesson types in one component would be
  untestable without a browser, and no local browser is available — if wrong, the machine's step model is too
  small for a lesson type (cost: that type gets its own sub-machine; the interface allows it).
- Ruling: the roadmap collapses every section but the current one — hundreds of lessons would be a very long
  page on a phone — if wrong, a learner cannot see the whole path at once (cost: a "Show all" button).
- Ruling: `practice` and `script` are the last lesson types built — they have the most variation and the least
  to show on a first release; the course works with `words`, `grammar`, `reading` and `check` — if wrong, the
  first version feels thin (cost: a flag in the skeleton skips a type; units without them still work).
- Ruling: a lesson type whose card kind is not installed (listening, speaking) is **skipped silently** — the
  skeleton does not depend on features that come after v1.0 — if wrong, a unit looks shorter (cost: none).

## Needs human review

The roadmap's look and the lesson flow on a **real phone** (nothing was drawn in a browser, by rule): path
density, the current-lesson highlight in qinqin Day and Night, Back behaviour, the reading lesson's readings.
No native-speaker review.

## Done when

A learner can start the test course, finish a words lesson, a grammar lesson and a reading lesson, see them done
after a reload, skip a unit and undo it; offline works after preparing; CI green.
