# The mistake notebook (`notebook` marks, items derived from the study events)

Issue #227 (plan and rulings: `docs/superpowers/plans/2026-11-28-227-mistake-notebook.md`). The notebook gathers what
the learner got wrong across the study sources into one list. It is **derived** from the study events, like every
schedule: the only events it adds are the learner's **marks** (a removal by hand, a clear). Nothing else is stored.

Owner code: web `apps/web/src/lib/studycore/notebook.ts` (the rules), `apps/web/src/lib/notebook/` (the page and the
"Practise my mistakes" round); `apps/web/src/lib/events/eventPayloads.ts` (`notebookPayload`); Go
`server/internal/backup/remap.go` (a restore remaps a card item's id).

## Sources, items and outcomes (`outcomes`)

Each readable event of a workspace says, about one **item**, **wrong**, **right** or nothing:

| Source | Item key | Wrong | Right |
| --- | --- | --- | --- |
| a `review` (`events/README.md`; live after `review-replace.json`, on the surviving card after `study/canonical.json`) | `card:<cardId>` | grade 1 (Again) | grade 2, 3 or 4 |
| a `drill.<id>` answer (`drills/drills.json` `parse`; every valid drill id) | `drill.<drillId>:<item>` | grade 1 | grade 2, 3 or 4 |
| a `grammar` run with `total > 0` (`grammar/runs.json` `parse`; `lesson` and `review` alike) | `grammar:<point>` | `100 · score < 80 · total` | `100 · score ≥ 80 · total` |
| a `course` `lesson-finished` with `total > 0` (`courses/README.md` Parsing) | `course:<courseId>:lesson:<unitId>:<lessonId>` | below 80 % (as grammar) | at or above 80 % |
| a `course` `unit-test` | `course:<courseId>:unit:<unitId>` | `passed: false` and `early: false` | `passed: true` |
| a `course` `section-exam` | `course:<courseId>:section:<sectionId>` | `passed: false`, unless the course's **next** course event (replay order) is a `placement` | `passed: true` |

Nothing: a failed early unit test (taken to skip ahead), a failed section exam that is a placement step, a grammar run
or course lesson with `total = 0`, `lesson-started`, `placement`, and every other event. The score sources record no
question, so their item is the whole run.

## Marks (`build`, `parse`)

```
{type: "notebook", payload: {action: "remove", item: "<item key>"}}     one item out, by hand
{type: "notebook", payload: {action: "clear"}}                          every item out
```

Written in the workspace, through the normal event path (the web: the session's outbox). Member order is part of the
shape. A client reads a mark when the type is `notebook`, the payload is an object (not an array), `ts` parses as an
instant and `action` is `clear` (other members ignored) or `remove` with an `item` of **1 to 400 code points** with no
white space (`White_Space`, U+3000 included) and no control character. Anything else counts nowhere. The server
stores the events as any other (no activity rule); a restore remaps the id inside a `card:` item as it remaps a
review's `cardId` (`backup/remap.json`); other items are kept byte for byte.

## The notebook (`notebook`)

Per workspace, the outcomes and the marks replay together in `(instant of ts, id)` order:

- a **wrong** answer puts the item in (if it is out) and sets its run of right answers to 0;
- a **right** answer of an item that is in adds 1 to the run; at **3** (`leaveAfter`) the item leaves; a right answer
  of an item that is out does nothing;
- a **removal** takes that item out; a **clear** takes every item out;
- a later wrong answer brings an item back with a fresh count.

An item that is in has `since` (the `ts` of the wrong answer it entered with), `last` (the `ts` of its last wrong
answer), `mistakes` (wrong answers since it entered), `right` (the run, 0–2), `ref` (what it names) and `wrong` (the
last wrong answer: `{mode, grade}` of a review or drill answer, `{mode, score, total}` of a grammar run, `{score,
total}` of a course event).

`ref`: `{source: "card", cardId, entryId, kind}` (the card's row), `{source: "drill", drill, item}`, `{source:
"grammar", point}`, `{source: "course", course, check: "lesson", unit, lesson}`, `{… check: "unit", unit}`, `{… check:
"section", section}`. An item of a card that is no longer in the study data is left out.

**Groups** (`groups`, in this order): `words` (vocab, reverse, cloze and sentence cards), `characters` (writing cards and
cards of character entries, `entryKind: "character"`), `tones` (tone cards), `grammar` (grammar points), `course`
(course lessons, unit tests and section exams); a drill item is in its drill's group (`drillGroups`), a drill not
listed in `words`. Inside a group: the last wrong answer, newest first, then the item key (UTF-16 code unit order).

## Practising

The web's notebook page (`/notebook`) lists the groups; "Practise my mistakes" (`/notebook/practise`) asks the
notebook's drill items in one mixed round (each drill's own question, as the weakest round does; an item that is no
longer a candidate is not asked) and offers a flashcards session of the notebook's cards that are **due now**
(`StudySessionConfig.cardIds`; a card is never asked before it is due); grammar points and course checkpoints link to
their lesson or test. Answers there are ordinary events and count as everywhere.

| File | Rule | Decoded by |
| --- | --- | --- |
| `notebook.json` | `constants`, `build`, `parse`, `outcomes`, `notebook` (each case's events read as workspace 1 through the study history, `cards` the study data's cards unless the case has its own) | web: `apps/web/src/lib/studycore/notebook.contract.test.ts`; Go: the `notebook` cases of `backup/remap.json` (`backup/remap_test.go`) and `backup/notebook_test.go` (a card mark's entry in the export's refs) |
