# #222 — courses: roadmap, lesson player and progress (web) (2026-11-28)

Milestone v0.9.0, phase 4 (courses), the second of the chain #221 → #222 → #223 → #224 → #225 (tracker #218).
Branch `feature/v090-222-course-roadmap` from `feature/v0.9.0` at `fb1560a5` (contract 24, migrations up to 058).
Design: `docs/superpowers/specs/2026-11-24-courses-design.md` (approved). Binding owner answers: the v0.9.0 plan §4
(#224: unit test 80 %, section exam 75 %, lessons of 5–7 words, unreached words in reading texts get a reading and a
gloss) and the courses row (§11 "left to the builder" is the builder's call, written down as rulings). Issue #222 has
no comments. The data and the rules come from #221 (`docs/contracts/courses/`, `docs/wiki/Courses-data-model.md`,
plan `2026-11-28-221-course-pack.md`).

## What

- **Courses is a core feature** (`courses`, the #294/#295 pattern): a per-user switch, nav entry with the `map` icon,
  pages under `/courses`, a pin in the default bottom bar.
- **The course of a workspace:** the installed courses of the workspace's language (`GET /api/courses?language=`),
  the first by pack id unless the learner picked another on this device.
- **The filled course offline:** held in the session and in a device copy per user (record 0009, #290 pattern:
  shown at once, refreshed behind); entries of the words the learner is about to meet are fetched while online so the
  service worker keeps them.
- **Progress:** the workspace's `course` events (now part of the study history, like grammar runs) replayed with
  `deriveCourseState`; the state's `known` words are marked known; the roadmap offers "Add these as cards" for the
  words of skipped units.
- **Roadmap** (`/courses`): sections and units as a path, the current lesson highlighted, done / current / unlocked /
  locked states, word-count milestones along the path, "Take the unit test" on the current or a locked unit and
  "Take the section exam" on a section not yet done.
- **Lesson player** (`/courses/play/<course>/<unit>/<lesson>`): full screen (no bottom bar), a thin progress line,
  docked actions; lesson kinds `words` (and catch-up), `script`, `grammar`, `practice`, `listening`, `speaking`,
  `reading`; unknown kinds are skipped by the decoder; each lesson ends with its short check and a summary. Plus a
  first, simple unit test and section exam (the entry point #224 replaces).
- **Course words join normal study:** a finished word lesson adds vocab cards for its words to the course's deck and
  records each card's first review from the lesson's check, so course words never wait for a daily new-card limit.
- **Shared study core only:** the course code reads `lib/studycore`, `lib/exercises` and grammar's public pieces; a
  guard keeps `lib/features/courses` from importing `lib/features/flashcards`.

## Tasks

1. This plan.
2. The feature `courses`: `features.IDs` (Go), `docs/contracts/features/` (seven ids), the default bottom bar
   (`docs/contracts/settings/nav-layout.json`), ContractVersion 25, CHANGELOG; the web registry, a feature page,
   the route folder, the frame (icon, the player without the bar). Tests first (Go and web contract tests, frame).
3. Progress data: `StudyHistory.courseEvents`; `lib/features/courses/progress.ts` (load the course state of a
   workspace, the known keys from the known marks), the event builders and their recording. Tests first.
4. The course store: list and filled course, session-held and device copy, offline; the chosen course per device.
   Tests first.
5. The roadmap model (`roadmap.ts`, pure): rows of sections and units with their states and actions, the
   milestones along the path, the lesson labels. Tests first.
6. The lesson flows (`flow.ts`, pure): the steps and check questions of every lesson kind, the unit test and the
   section exam, scoring, the words and grades a finished lesson writes. Tests first.
7. Writes: the course deck and its cards with first reviews, the known marks of skipped words, "Add these as cards"
   (`cards.ts`). Tests first.
8. Screens: `CoursesPage`, `Roadmap`, `LessonPlayer` and its step views; DOM tests.
9. e2e: a fixture course on the e2e levels pack; a learner opens the roadmap, finishes the first word lesson, sees
   the next lesson and a card in the course deck; the paths in `phone-width.spec.ts`.
10. Docs: wiki (a Courses page for learners, `Courses-data-model.md`, Finding your way), record 0006 and 0009 "Touched
    by", `docs/releases/NEXT.md`; gates.

## Rulings

Format: `Ruling: <what> — <why> — <cost if wrong>`.

### Feature, navigation, routes

1. Ruling: **Courses is a core feature switch** (`courses`, per user like the others, on by default, after `scripts`
   and before `stats` in the order) — the #294/#295 pattern gives a switch, a hidden nav entry and the switched-off
   notice for free; a learner who uses only the toolbox can hide it — cost if wrong: one id in `features.IDs`, a
   contract change.
2. Ruling: **Courses applies to every language** (no `appliesTo`); a workspace whose language has no installed
   course shows "No course for this language yet" — whether a course exists is server data (installed packs), not
   the language profile — cost if wrong: a Courses entry that leads to an empty page for German or Korean until
   #201/#223 bring courses.
3. Ruling: **the default bottom bar becomes Home, Courses, Decks, Search** (Reader moves to More) — the issue asks for
   a bottom-bar entry and the bar holds four pins and More; the dictionary (Search) stays, the Reader is one tap
   further — cost if wrong: learners who never changed their bar find the Reader in More; a saved bar is untouched.
4. Ruling: **routes** `/courses` (the roadmap of the workspace's course), `/courses/<courseId>` (the roadmap of that
   course, used by the course picker), `/courses/play/<courseId>/<unitId>/<lessonId>` (the player; `lessonId` may be
   `test` for the unit test) and `/courses/play/<courseId>/section/<sectionId>/exam` (the section exam); the bar is
   hidden under `/courses/play` — a course pack id may be `play`; that course's roadmap is then reached only through
   `/courses` — cost if wrong: one unreachable roadmap URL for a course named `play`.
5. Ruling: **steps of a lesson do not push history**; the Android back button and the browser's Back leave the lesson
   to the roadmap (the shell's back handler walks history, record 0010) — a lesson is a few minutes; a step history
   would make Back undo answers — cost if wrong: a learner who presses Back mid-lesson restarts it (its `started` is
   kept, nothing else).

### Data, offline, progress

6. Ruling: **the course is picked per workspace language: the learner's choice on this device, else the first course
   by pack id** (#221 ruling 3); the choice is a per-device convenience in localStorage (`qinqin.course.pick.<user>`,
   by workspace id), not synced — the real courses are one per language (#223); a second course is rare — cost if
   wrong: a learner with two courses picks again on another device.
7. Ruling: **the filled course is held in the session and in a device copy** (localStorage
   `qinqin.course.v1.<user>.<courseId>`, the decoded answer as JSON), shown at once and refreshed behind (#290); the
   copy is replaced when `fill` changes and removed at sign-out with the Home copies — #221 serves it to signed-in
   users only and the service worker does not cache it, so the app must keep it (record 0009 allows a device copy of
   non-sensitive data keyed by the user id); the course holds level-list words, which every user of the server sees
   alike — cost if wrong: a device keeps up to a few hundred KB per course until sign-out; storage full keeps it in
   memory only.
8. Ruling: **no hand-made conditional request**: the route answers `Cache-Control: private, no-cache` with an ETag, so
   the browser revalidates by itself and a 304 comes back to the page as the cached 200 — the API client has no
   header option and needs none — cost if wrong: none (one full answer when the browser's HTTP cache was cleared).
9. Ruling: **offline lessons:** while online, the roadmap fetches the dictionary entries of the current unit and the
   next one (`GET /api/entries/{id}`, which the worker keeps) — the lesson needs each word's gloss; the course itself
   is in the device copy — cost if wrong: a lesson further ahead opened offline shows words without glosses (the
   check then leaves those words out).
10. Ruling: **the study history carries the workspace's course events** (`StudyHistory.courseEvents`, the raw events of
    type `course`, queued ones included), like `grammarRuns` — one read of the log feeds the roadmap and the player,
    and a lesson finished offline shows at once — cost if wrong: none.
11. Ruling: **the known keys for the derivation are the course words whose entry has a known mark** (`known:` rows are
    by entry id; the course's words carry both key and entry id) — the derivation takes keys — cost if wrong: a word
    known under another entry of the same key counts as not known (it is then marked once more, harmlessly).
12. Ruling: **the state's `known` words are marked known as one declaration** (`setKnownMarks` with a batch `source:
    "placement"`, scope "Course: <course title>") when the roadmap loads, then the state is derived again — the
    declaration batch exists for exactly this (marks that can be undone together, #74); the derivation's input then
    holds them, so they are marked once — cost if wrong: the batch shows as a placement in the known-words history.

### Lessons

13. Ruling: **a word lesson (and a catch-up lesson):** each word is introduced (form, its reading through
    `useRomanisation`, its first gloss, a play button with the device voice), then the check: one "what does it mean?"
    question per word, then "which word means …?" questions up to the course's `checkpoints.lesson.questions` (at most
    two per word); three wrong choices from the other words of the unit, then of the section — the design's Starter
    stages and pictures belong to the flashcard faces, which the course may not import (#278 guard); a meaning-first
    check is what a lesson check needs — cost if wrong: no pictures or hints in lessons until they move to the study
    core.
14. Ruling: **the gloss is the first sense's text up to its first `;`** — short enough for a choice button — cost if
    wrong: a word whose first sense is a cross-reference shows that.
15. Ruling: **a lesson never fails** (#221 ruling 25): a wrong answer shows the right one and the question comes back
    once at the end of the check; the score counts first tries — the check is short practice, the unit test is the
    gate — cost if wrong: none.
16. Ruling: **finishing a word lesson adds a vocab card for each word to the course's deck and records the card's
    first review: Good when every check question on the word was right the first time, else Hard** — the lesson is the
    introduction, so the card never sits as a new card behind a daily limit (design §7: "the course is never blocked");
    `dayCounts` counts new cards per deck, so only the course deck's count grows; Hard keeps a shaky word due soon
    without putting it into today's queue — cost if wrong: reviews from lessons count in the learner's EXP and the
    day's review count (the design wants course reviews to count normally).
17. Ruling: **the course deck is a stored deck with a derived id** `d-course-<slug of the course id>`, named after the
    course's title, created by the first lesson that needs it; a word that already has a vocab card keeps its card and
    decks and gets no lesson review — system decks are computed from packs and cannot hold cards; a derived id keeps
    two devices on one deck — cost if wrong: a learner who deletes the deck gets it back with the next lesson.
18. Ruling: **"Add these as cards" on a skipped unit adds new vocab cards (no first review) to the course deck and keeps
    the known marks** — removing the marks would make the derivation output the words as known again; new cards then
    come through the usual daily limit, the learner's choice — cost if wrong: the words show as known in the reader
    while they are being learnt.
19. Ruling: **a script lesson** shows each of the unit's characters (form, reading, gloss of its character entry when
    the dictionary has one) and, for `scripts` (kana), a link to the writing-system trainer; its check asks the meaning
    of each character with a gloss — the writing pad and the trainer belong to the scripts and flashcards features;
    the trainer keeps its own events — cost if wrong: no handwriting inside the course lesson.
20. Ruling: **a grammar lesson** shows the grammar lesson's pattern, explanation and examples (grammar's
    `loadDisplayLesson`), then its cloze exercises with grammar's `ClozeChoice`, and records a `grammar` run (#277,
    `recordRun`) besides the course event; word-order exercises are left out (their board is flashcards') — a lesson
    whose grammar pack is not installed (`available: false`) is shown as unavailable and can be skipped by finishing
    it with score 0 of 0 — cost if wrong: fewer exercises than on the Grammar page, which is linked.
21. Ruling: **practice** mixes three question types over the unit's words the learner has met: meaning, form and (with
    a device voice) listening, twice the lesson's question count — "all card kinds" of the design are flashcard
    faces; the core exercises a lesson can host are these — cost if wrong: no tone or writing practice in the course
    until #223/#224 add them.
22. Ruling: **listening** asks "which word did you hear?" over the unit's words with the device voice (no voice: the
    lesson says so and can be finished); **speaking** shows each word with the model voice and the learner says it,
    marking "I said it" (no speech grading); a unit without words gets a short note — the course's sound units are
    #223's content — cost if wrong: the start section's "Sounds and tones" lesson is a placeholder until #223.
23. Ruling: **reading** shows the unit's text with a reading over every word the learner has not reached (not met, not
    known) and a list of those words with their glosses below, and the translation behind a button; no questions —
    plan §4 (#224): "unreached words in texts get a reading and gloss"; words are found with the server's segmenter —
    cost if wrong: a segmenter miss shows a word without help.
24. Ruling: **the words a finished lesson records are the words it taught:** word and catch-up lessons their words;
    every other kind none (`words: []`) — #221 ruling 21; practice and reading reuse met words — cost if wrong: none.
25. Ruling: **the unit test and section exam here are an entry point, not #224's tests:** a meaning/form quiz over the
    unit's (section's) words, `checkpoints.unit.questions` (`section.questions`) questions at most, judged against
    `passPercent`, recorded as `unit-test {early}` / `section-exam`; a unit with no words passes its test with 0 of 0
    — the path is locked behind unit tests (#221 ruling 22), so without a test the course would end after the first
    unit ("Continue course can never be a dead end"); #224 replaces the question set — cost if wrong: #224 rewrites
    `flow.ts`'s test part.
26. Ruling: **milestones along the path are the words-met marks 50, 100, 250, 500, 1000, 1500, 2000, 3000** placed after
    the unit where the course's cumulative word count reaches them, plus each section's end; reached ones are shown
    done — the milestone system (seen once, history) is #225; the roadmap shows where they are — cost if wrong:
    #225 may pick other counts.
27. Ruling: **no new strings outside `en.json` and no written course content** (unit titles and texts come from the
    packs, #223) — the teacher review of the brief applies to written content; this issue writes only interface
    strings, and de/ja catalogues are #144/#145 — cost if wrong: none.

## Execution record

(filled in as the tasks land)

## Gates

(filled in at the end)

## Local follow-up

(filled in at the end)
