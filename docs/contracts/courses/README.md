# Courses: the pack, the fill rule, progress, tests, counting and Home (#221, #224, #225)

A course (design: `docs/superpowers/specs/2026-11-24-courses-design.md`; plan and rulings:
`docs/superpowers/plans/2026-11-28-221-course-pack.md`) is a hand-written **skeleton** (sections, units, grammar,
hanzi or kanji, reading texts, checkpoint rules) that the server **fills** with words from its installed level packs,
and a learner's **progress** is `course` events in the event log, from which every client **derives** the same path
state. The pack never holds level-list words (the HSK list has no reuse licence), so the filled course exists only on
a server, which serves it.

Owner code: `server/internal/courses` (`course.go` the format, `fill.go` the rule, `gather.go` the inputs and the
cache, `progress.go` the events and the derivation, `store.go` the pack type), `server/internal/api/handlers_courses.go`.
Web: `apps/web/src/lib/api/courses.ts` (the routes and a strict decoder), `apps/web/src/lib/studycore/courseProgress.ts`
(parse and derive), `apps/web/src/lib/events/eventPayloads.ts` (`coursePayload`).

| Fixture | Rule | Decoded by |
| --- | --- | --- |
| `pack.json` | `courses/pack`: which `course.json` files a server accepts | Go: `courses/pack_contract_test.go` |
| `fill.json` | `courses/fill`: course + level pack + frequency + labels + grammar → the filled course | Go: `courses/fill_contract_test.go` (`Fill`); web: `lib/api/courses.test.ts` (every `expect` through `decodeCourse`) |
| `derive.json` | `courses/derive`: the payload builder (`build`), and events → path state | Go: `courses/derive_contract_test.go` (`Derive`, `ParseProgress`); web: `lib/studycore/courseProgress.test.ts` (`coursePayload`, `deriveCourseState`) |
| `changes.json` | `courses/changes`: events recorded against an earlier course, replayed over the course as it is now | as `derive.json` |
| `tests.json` | `courses/tests`: how a unit test or section exam is assembled, scored and judged, a placement exam's early stop, the placement chain (#224) | web: `lib/features/courses/tests.test.ts` (a client rule: the server only stores the events) |
| `home.json` | `courses/home`: the model of Home's "Continue course" widget over a filled course and its state (#225) | web: `lib/features/courses/home.test.ts` |
| `counting.json` | `courses/counting`: which events are course steps, their activity cells, EXP and the streak (#225) | Go: `stats/contract_courses_test.go` (`activity`); web: `lib/studycore/courseCounting.test.ts` (`steps`, `xp`, `streak`) |

## The pack

Pack type `course`, format `course-json`, one language (`language`), one data file `course.json` (at most 2 MiB),
licence CC BY 4.0 for the project's courses. The server stores the file as imported (`course_packs.course_json`).
Unknown members are refused (so is a `words` list).

```
{ "version": 1, "language": "zh", "title": {"en": "…"},
  "levels": {"scheme": "<levels pack id>", "estimate": [<max rank of level 1>, <of level 2>, …]},
  "checkpoints": {"lesson": {"questions": n}, "unit": {"questions": n, "passPercent": 80},
                  "section": {"questions": n, "passPercent": 75}},
  "sections": [ {"id": "…", "level": 1 | null, "title": {"en": "…"}, "units": [
    {"id": "…", "title": {"en": "…"}, "topics": ["food"], "grammar": ["<packId>:<lessonId>"],
     "characters": ["你"], "scripts": ["hiragana"],
     "text": {"title": "…", "body": "…", "translation": {"en": "…"}},
     "focus": "listening" | "speaking", "test": true } ] } ] }
```

- **Ids** (sections and units): `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 64 bytes, unique across the course's sections
  and units, **never reused**: progress is kept by unit id. A unit renamed is a new unit.
- **Titles**: `{language code: text}`, `en` required, at most 200 bytes each.
- **`level`**: the 1-based position of a level in the scheme's level order (HSK 1 is 1; ≈ N5 is 1); `null` for a
  start section, which gets no words. Levels rise strictly from section to section.
- **`levels.scheme`** names the levels pack the words come from; **`estimate`** the rank cut-offs of the frequency
  fallback (rising). Both optional.
- **`topics`**: ids of `topics/topics.json`, at most 8. **`grammar`**: at most 6 grammar points (`grammar/README.md`),
  not checked against the installed packs (a missing one is `available: false`). **`characters`**: single Han
  characters, each in at most one unit of the course, at most 60. **`scripts`**: writing-system ids of the scripts
  trainer (`hiragana` …), at most 6.
- **`text`**: the unit's reading text in the course's language (body at most 8000 bytes), with optional translations
  (`{language code: text}`, `en` required, each at most 8000 bytes like the body).
  Words of the text the learner has not reached show a reading and a gloss (plan §4, #224); the client works that out
  from the dictionary and the state's `met` and `known`.
- **`test`** (default true): a unit test closes the unit. A start unit may have none.
- **`checkpoints`**: questions 0–200; `passPercent` 50–100, default 80 (unit) and 75 (section); a lesson check has
  no pass mark.

## The fill rule

`Fill(course, input)` is pure and deterministic. The input (`fill.json` `input`):

- `levels`: the course's level pack, if installed: its levels in order, each with its listed words (derived characters
  left out), each word `{key, form, reading, entryId}` — `key` the dictionary entry key (zh: the simplified form; ja
  `j:<ent_seq>`), the word's id in events.
- `frequency`: the first live frequency pack of the language (priority order): `{pack, rows: [{key, form, reading,
  entryId, rank}]}` — the level words' ranks, or, without a level pack, the pack's top words.
- `labels`: topic labels by key; a word's topics are every row of its key, the word row first, then the senses
  (`topics.File.TopicsForKey`).
- `grammar`: the installed grammar points.

**Source.** With the level pack: `levels`. Without it, with a frequency pack and an `estimate`: `frequency` (a row's
level is the first `i` with `rank <= estimate[i]`; beyond the last, out of scope; a key's best row counts). Else
`none`, and no unit has words.

**Candidates.** A section's candidates are the words of its level (out-of-scope levels are not reported), first
occurrence of a key only, in **teaching order**: frequency rank (lower first; no rank after every ranked word), then
the source's order, then the key.

**Characters first.** A word may go only to units at or after the last unit that introduces one of its Han
characters (characters no unit introduces do not constrain). A word whose character comes in a later section is
**unplaced** (`reason: "character-later"`).

**Placement.** The placeable words are spread over the section's units by quota (`floor(N/k)`, the first `N mod k`
units one more). Pass 1, in teaching order: a word goes, for its first topic that some allowed unit with room has, to
that topic's allowed unit with the fewest words (ties: the earlier). Pass 2, in teaching order: every word left goes to
the earliest allowed unit with room; if none has room, to the allowed unit with the fewest words (ties: the earlier).
A unit's words are in teaching order. `counts.byTopic` counts pass-1 placements.

**Lessons.** In path order: `script` (if the unit has characters or scripts: `{characters, scripts}`), the word
lessons `words-1` … (`ceil(n/7)` lessons, sizes differing by at most one, the larger first: 5–7 words from 10 words
on, one lesson of 1–7, two of 4–5 for 8 or 9), each grammar lesson `grammar-<lessonId>` (`{point, available}`) after
word lesson `ceil(j·W/G)` (`j` its 1-based place, `W` word lessons, `G` grammar lessons; right after the script when
the unit has no words), `practice` (if the unit has words), `listening`/`speaking` (its focus), `reading` (if it has a
text). A lesson's JSON carries `id`, `kind` and its kind's members only. A client skips a lesson kind it does not know.

## Routes

- `GET /api/courses[?language=<code>]` → `200 {"courses": [{id, name, version, language, license, attribution,
  notice, title}]}`, by pack id.
- `GET /api/courses/{id}` → `200` the filled course: `{id, name, version, license, attribution, notice, fill,
  language, title, source, checkpoints, sections, unplaced, counts}` (`fill.json` `expect` plus the pack's credits
  and `fill`); `ETag: "<fill>"`, `Cache-Control: private, no-cache`; a matching `If-None-Match` → `304`. Unknown or
  uninstalled course → `404 not_found`.
- Both: a signed-in user (`401 unauthorized` otherwise), no personal access token, not cached by the service worker.
  The answer holds no user data: every user of a server gets the same bytes.
- The server fills on first use and keeps the answer in memory while its inputs hold (the course, the scheme's
  version, the frequency pack's content, the installed grammar packs, the lexicon). `fill` changes exactly when the
  answer does. Unplaced words are logged once per fill.

## Progress events

Type `course`, written by the client through the outbox like `grammar` (`events/README.md`); the server stores them
as any event. Member order is part of the shape (`coursePayload`, `derive.json` `build`):

| `kind` | Members after `kind, course` |
| --- | --- |
| `lesson-started` | `unit, lesson` |
| `lesson-finished` | `unit, lesson, score, total, words` (the keys of the words the lesson taught, at most 50) |
| `unit-test` | `unit, score, total, passed, early` (`early`: taken before the unit's lessons were done) |
| `section-exam` | `section, score, total, passed` |
| `placement` | `section` (the learner starts there) |

`passed` is the result as judged when the test was taken (against the pack's pass mark then), so a later change of
the mark rewrites no history.

**Parsing.** An event is a course event when its type is `course`, its `ts` is RFC 3339 with a zone, its payload an
object whose `kind` is one of the five, `course` a pack id, `unit`, `lesson` and `section` ids, `score` and `total`
whole numbers with `0 <= score <= total <= 1000`, `passed`/`early` booleans and `words` an array of non-empty strings
of at most 128 bytes, as the kind needs. Other members are ignored. Anything else counts nowhere.

## Derivation

`Derive(course, courseId, events, known)` replays one workspace's course events of `courseId` in `(instant of ts, id)`
order. `known` is the words the learner has marked known.

- A finished lesson marks `(unit, lesson)` finished and its words **met** (any unit, even one the course no longer
  has). A started lesson marks it started.
- A passed **unit test** of unit U: not early → U is passed, *studied*; early → U and every not-yet-passed unit before
  it in the course are passed, *skipped*. A passed **section exam** skips every not-yet-passed unit of its section and
  before it. A **placement** into section S skips every not-yet-passed unit of the sections before S. A passed unit
  stays passed (studied stays studied). Failed tests and exams, and events naming unknown units or sections, change
  nothing.
- A unit is **done** when passed, or, for a unit without a test, when every lesson of it is finished.
- **Known:** the words of skipped units neither met nor in `known`, in course order: the client marks them known
  (they are not made cards).
- **Catch-up:** for a done, studied unit, its words neither met nor known become lessons `catch-up-1` … (`kind:
  words`, sized as word lessons). Finishing one makes its words met.
- **Position and status:** the learner's position is the last done unit in course order. The **current** unit is the
  first not-done unit after it (the first unit when none is done). Not-done units before the position are
  **unlocked**; units after the current one **locked**. `current` is `{section, unit, next}`, null when no unit is left
  after the position.
- **Inside an open unit** (current or unlocked): the position is the last finished lesson; the first unfinished lesson
  after it is **next**; unfinished lessons before it are **unlocked**; later ones **locked**. With no unfinished lesson
  after it, the unit's `next` is `test`, or, for a unit without a test, its first unfinished lesson. `started` is set
  on a started, unfinished lesson that is not locked. A done unit's lessons are all done; a locked unit's lessons are
  done when finished, else locked.
- **Sections:** done when every unit is; else current when it holds the current unit; else unlocked when it holds an
  unlocked unit; else locked. `examPassed` when its exam was passed.

The state's JSON (`derive.json` `expect`): `{current, sections: [{id, status, examPassed, units: [{id, status,
skipped, testPassed, next, lessons: [{id, status, started}], catchUp: [{id, kind, words}]}]}], met, known}` — the same
bytes from Go and the web.

## Content changes (`changes.json`)

A course pack changes with a new release (#223 writes the skeletons; level packs and labels change too). The rules
above already make progress survive it:

- **Unit ids are stable**; a removed unit's events are ignored, but its words stay met.
- **Lesson ids are derived within a unit** (`words-2` is "the second word lesson"); a lesson's words can change, which
  is why a finished lesson records its words.
- **Words added to a finished unit** become its catch-up lessons; the unit stays done. A word moved to another unit
  stays met.
- **A unit added before the learner's position** is unlocked, not current; **a lesson inserted before the learner's
  position in a unit** is unlocked.
- A word added to a *skipped* unit is output as known.

## Tests and exams (#224, `tests.json`)

A **unit test** closes a unit (`test: true`), a **section exam** a section (`exam`); both can be taken early to skip
ahead, and **placement** chains the section exams. Plan and rulings:
`docs/superpowers/plans/2026-11-28-224-course-tests.md`. Web: `apps/web/src/lib/features/courses/tests.ts`.

- **Questions.** `checkpoints.unit.questions` (`section.questions`) questions: **word** questions (meaning, form, how
  it is read, which word was heard), **grammar** questions (the unit's or section's installed grammar lessons' own
  fill-the-gap exercises, one per point in turn) and **text** questions (a gap in a sentence of a unit's reading text).
  The order is a seeded shuffle with no two questions in a row on the same word where that can be avoided.
- **Budget** (`budget`): grammar gets `min(G, ceil(Q/5))` and the text `min(T, ceil(Q/5))` of `Q`; the words the rest,
  at most two questions per word; what the words cannot use goes to grammar, then text, up to what they have. A test
  can be shorter than `Q`; one with nothing to ask is passed with 0 of 0.
- **The word sample** (`sample`) is the level check's planner (#82, `lib/placement/levelCheck.ts` `planCheck`): one
  stratum per word lesson of the unit (a unit test) or per unit of the section (an exam), an even share each (a small
  stratum gives all it has), seeded with the placement test's generator. Words the shared known predicate
  (`frequency/known.json`) calls known are left out while others remain; known ones fill only what is left. Every
  sampled word is asked once before any word is asked twice. Word question types rotate meaning → form → reading →
  listen, skipping a type that does not apply (listening needs a device voice; reading needs a reading the learner's
  romanisation setting shows, `settings/` `romanisation`).
- **Reading questions** (`tones`): Chinese asks the pinyin among variants with one syllable's tone changed (tones 1–4);
  Japanese asks the kana reading of a word written with kanji among other course words' readings; others none.
- **Text questions** (`sentences`, `gap`): sentences end after `。！？!?` or a line break; a sentence gives one gap, for
  the first unit word (teaching order) that occurs in it literally (`cards/` cloze `blankSpans` without segmenter
  matches), when at least two letters stay outside the gap and three wrong choices exist among the unit's, then the
  section's, then the course's word forms (none that occurs in the sentence). Each word at most once.
- **Judging** (`judge`): score = right first answers; `passed = total = 0 or score · 100 ≥ passPercent · total`, against
  the pack's mark when taken. Recorded as `unit-test {unit, score, total, passed, early}` (`early`: some lesson of the
  unit was not done) or `section-exam {section, score, total, passed}`. A failed test changes nothing (the
  derivation) and can be taken again.
- **Placement** (`decide`, `placement`): starts at the first section with an exam. A placement exam stops as soon as
  its result cannot change (the pass mark reached, or out of reach) and records the questions asked as `total`. Each is
  a `section-exam`; after a pass the learner takes the next section's exam or starts in the next section (`placement`
  of it); a fail records `placement` of the failed section, or of the course's first section when the first exam
  failed (nothing skipped). Passing the last exam ends it. A client offers placement while no unit of a section with
  an exam is done and nothing was skipped.

## Counting (#225, `counting.json`)

Course work counts like grammar lesson runs (#277) and drill answers (`drills/`). Plan and rulings:
`docs/superpowers/plans/2026-11-28-225-course-home.md`. Web: `apps/web/src/lib/studycore/courseCounting.ts`.

- **A step** is a readable course event (Parsing above) that is a `lesson-finished` whose `lesson` does not start
  with `grammar-`, a `unit-test` (passed or not) or a `section-exam` (passed or not, placement exams too). A course
  grammar lesson records a `grammar` run (`grammar/`), which counts on its own; a `lesson-started` and a `placement`
  are no step. Its identity (`steps`): `["lesson", course, unit, lesson]`, `["unit-test", course, unit]`,
  `["section-exam", course, section]`.
- **Activity** (`activity`; `events/activity.json` rule `course`, feature `courses`, `item: "course"`): one point per
  distinct step per learner day and workspace; `raw` the same number, so a daily goal `activity:course` counts steps
  ("course lessons") and the weekly summary shows them as an activity row. The server reads the members by JSON type
  only (text `course`, `unit`, `lesson`, `section`), not the full parse.
- **EXP** (`xp`): `stepXp` 20 per step, whatever its score; no daily bonus (it stays a review bonus).
- **Streak** (`streak`) and the milestones' `streak` and `days-active` families: a learner day with a step counts like a
  day with a review; vacation days are neutral.

## Home: "Continue course" (#225, `home.json`)

The widget `course-continue` (first in Home's default layout, `settings/` `home-layout`) shows the workspace's course
(as the roadmap picks it). Its model over the filled course and the derived state:

- `status`: `start` while no lesson is finished and no unit is done; `continue` while there is a next step; `done` when
  no unit and no catch-up lesson is left.
- `section`, `unit`, `next`: the state's `current` (`next` the lesson id, `test` for the unit test, with the player's
  link); with every unit done, the first catch-up lesson in course order; null when done.
- `units`: done of all; `words`: the state's `met` of all the course's words (the roadmap's "words met").
- A client shows nothing for a workspace whose language has no course.

