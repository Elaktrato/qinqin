# Course milestones, Home widget and onboarding — plan (issue #225)

Overview: `docs/superpowers/specs/2026-11-26-v090-courses-overview.md` (stage D). Design: courses design §7–§8. Needs #221
(events, path derivation, `script` milestones in `course.json`), #222 (roadmap, `/course`) and #224 (tests, for
the unit and section milestones). Uses the milestone system (`docs/contracts/milestones/`, `lib/milestones/`),
the goals/heatmap/weekly rules, Starter mode (#214) and the placement offer (#74, `lib/placement/offer.ts`).
Contract: milestone catalogue and weekly rows change (expected contract 16). Builder: one agent, branch
`feature/v090-course-home` from `develop`. Test first in every task; one commit per task.

## Shape

- **Course milestones** in the existing catalogue: new families `course-lesson` (first lesson), `course-unit`
  (each unit, id includes the unit id), `course-section` (each section, section id), `course-script` (from
  `script` in `course.json`: "all hiragana", "first 100 hanzi"), `course-words` (word counts 100/300/500/1000/2000
  of *course* words met or known, thresholds as the existing word families). Required feature `courses`
  (catalogue `enabled` rule). Ids and titles in `catalogue.json`; message keys under `milestone.course.*`.
  Reached = derived from `course` events and the replay like the others; shown once, then in the history.
- **Goals, heatmap, weekly summary:** a finished lesson counts as study activity in the activity rules (one
  fixture case per rule in `events/activity.json`); the weekly summary gets a "Course" line (lessons finished,
  units completed, the current section) behind the `courses` feature (`weekly/week-summary.json`).
- **Home:** a "Continue course" widget (`lib/widgets/`): the next lesson's title, the unit and section, one tap to
  start (`/course?lesson=<id>`); hidden when the feature is off, no course is installed or the course is finished;
  on a finished course it shows the graduation card once (below).
- **Workspace creation:** the "I'm new to this language" choice offers *Start the course (with Starter mode)*;
  "I know some already" offers the **placement test** (#74) and, after it, "Start the course at the placed
  section" (a `placement` event marks earlier units skipped, words known via #74's batch). Where the existing
  onboarding lives: read `lib/workspace` and `lib/placement/offer.ts` first; add to the same decision point, not a new wizard.
- **Graduation:** after the last section is done (or skipped), a "graduation" milestone and a short guide to free
  study (decks, level sessions, the reader and graded library #231, grammar beyond the course), shown once and
  kept reachable from the course page.

## Tasks

1. **Catalogue rows + fixtures** (`catalogue.json`, `reached.json` cases for each new family: first lesson, a unit
   completed by test, a skipped unit counted or not — **skipped units do not earn the "unit done" milestone but
   their words count as known**, a section by exam, script milestones, word counts, feature off hides them).
2. **Reached rules** in `lib/milestones/replayReached.ts` (or a new `courseReached.ts`) reading `course` events;
   the three fixtures decode in web tests; no server code (milestones are derived).
3. **Activity and weekly rules**: fixture cases and code; the heatmap counts a lesson once per day at least; the
   weekly summary line.
4. **Home widget** + jsdom tests: loading, no course, current lesson, finished course, feature off.
5. **Onboarding:** the new-language flow and the placement follow-on; jsdom tests for both paths; no change to
   the flow when the course is not installed.
6. **Graduation card and guide**; a test that it shows once (a seen row like the other milestone cards).
7. **Docs:** wiki `Courses` and `Milestones` pages, `docs/contracts/milestones/README.md`, CHANGELOG (expected 16),
   ROADMAP.
8. **E2E** `e2e/tests/course-home.spec.ts` (CI only): new workspace → course offered → widget on Home → continue.
9. **Verify:** `npm run check`, `npm test`, Go contract test for the version agreement, merge `origin/develop`,
   PR; core emulator job passes.

## Rulings

- Ruling: **skipped units earn no unit milestone** but their words count towards word milestones — a milestone
  for something the learner did not do would be hollow, while the words really are known — if wrong, a learner
  who tests out sees fewer celebrations (cost: a catalogue rule; the history list still shows the section
  milestone when a section exam is passed).
- Ruling: milestones stay **derived**, nothing stored but the "seen" rows — the existing rule of the milestone
  system — if wrong, a content update that renames a unit id loses its milestone (cost: the new id is reached
  again and shown once; unit ids are stable by contract).
- Ruling: the Home widget is on by default for a workspace with an installed course and an unfinished course;
  the roadmap entry in the bottom bar is the learner's choice (#188) — decision 10 of the overview — if wrong, the
  roadmap is harder to find (cost: a default change).
- Ruling: onboarding extends the existing decision point instead of adding a wizard — fewer new screens to
  verify without a browser — if wrong, the offer is easy to miss (cost: a Home nudge, as the level check has).

## Needs human review

The wording of the milestones, the graduation guide and the onboarding choices (English strings in `en.json`),
and how the Home widget looks next to the other widgets on a real phone. No native-speaker review.

## Done when

The new families appear in the catalogue and are reached from events under fixtures; the Home widget continues
the course; a new workspace can start it or be placed; the weekly summary shows course progress; CI green.
