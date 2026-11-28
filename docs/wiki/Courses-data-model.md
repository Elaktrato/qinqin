# Courses data model

How a course is stored, filled with words and followed (#221). The screens, the roadmap and the lesson player (#222),
are on the [Courses](Courses) page; later work brings the real Chinese and Japanese courses (#223) and the full unit
tests and section exams (#224). The rules are contracts: [docs/contracts/courses](https://github.com/Elaktrato/qinqin/tree/develop/docs/contracts/courses).

## Three layers

1. **The course pack** (pack type `course`, see [Data pack format](Data-pack-format)) is written by the project
   under CC BY 4.0: sections that follow the levels (≈ HSK 1–4, ≈ N5–N3, plus a start section), units with a stable
   id, a title, themes (the [topic ids](https://github.com/Elaktrato/qinqin/tree/develop/docs/contracts/topics)),
   grammar lessons, the hanzi or kanji the unit introduces, a short reading text and an optional listening or speaking
   focus, and the checkpoint rules (unit test 80 %, section exam 75 % by default). **It lists no words.**
2. **The filled course** is made by the server from what it has installed: the words of each section's level (from
   the course's level pack, such as `hsk-words` or `jlpt-words`; without one, levels are estimated from the frequency
   pack), placed into units by theme first, then by frequency, each unit getting a fair share, and never before the
   unit that introduces their characters. Each unit gets its lessons: script, word lessons of at most 7 words,
   grammar, practice, listening or speaking, reading. Words the rule cannot place are listed and logged. The result
   is kept in memory until a pack changes and is served at `GET /api/courses/{id}`.
3. **Progress** is study events of type `course` in the event log, like reviews: a lesson started or finished (with
   the words it taught), a unit test or section exam (passed or not; a unit test taken early), a placement. They sync
   and are backed up with the other events. Every client works out the same path state from them: which units and
   lessons are done, which one is next, which are unlocked or locked.

## Rules worth knowing

- **Locked path, tests to skip ahead.** A unit is done when its unit test is passed. Passing a unit test early, a
  section exam, or a placement skips everything before it; the skipped units' words are marked known rather than made
  into cards.
- **Content can change.** Unit ids never change meaning; lesson ids (`words-2`, `grammar-…`) are worked out within a
  unit. Words added to a unit the learner has finished come as a short catch-up lesson; a unit added before the
  learner's position is open but not in the way; words the learner met stay met even if they move.
- **Licences.** The course pack holds only the project's own writing; the level-list words (the HSK list has no
  reuse licence) are never copied into it: they come from the packs installed on each server.

## In the web app (#222)

- `lib/features/courses/`: `courseData.ts` holds the installed courses and the filled course for the session and in a
  device copy per user (`qinqin.course.v1.<user>.…`, removed at sign-out), since the service worker does not keep
  the routes; `progress.ts` replays the study history's `courseEvents` with `deriveCourseState` (known marks by entry
  id become word keys); `roadmap.ts` and `flow.ts` are the pure roadmap and lesson models; `cards.ts` writes the
  course deck (`d-course-<course id>`), its cards and their first reviews through the study core, and the known marks
  of skipped words as one declaration (`source: "placement"`).
- The courses feature never imports the flashcards feature (`tests/repo/folderRules.ts`, `FLASHCARDS_FREE`).
- Rulings: `docs/superpowers/plans/2026-11-28-222-course-roadmap.md`.
