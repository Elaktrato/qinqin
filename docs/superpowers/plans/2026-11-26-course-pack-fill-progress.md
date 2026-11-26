# Course pack, unit fill rule and progress contracts — plan (issue #221)

Overview: `docs/superpowers/specs/2026-11-26-v090-courses-overview.md` (stage B, the keystone). Design:
`docs/superpowers/specs/2026-11-24-courses-design.md` §5, §7, §9. Pack-type steps: `docs/architecture/0008-pack-types.md`
("How to add a pack type"). Contract: new folder `docs/contracts/courses/` (expected contract 14; it also pins the `resume` position, the section gate and the deck-membership rule decided on 2026-11-26). Builder: one agent
for the server half and one for the web derivation, **after the fixtures (task 1) are agreed**; branch
`feature/v090-course-core` from `develop`.

## Shape

- **Pack type `course`**, one per language (`languages` shape *One*), not uploadable. Files (all project content,
  CC BY 4.0, **no level-list words**): `course.json`, `texts/<id>.json`, `topics.json`, `labels.tsv`, `manifest.json`,
  `LICENSE`, `ATTRIBUTION.md`.
- **`course.json`**: `{version, language, sections: [{id, name, level, passMark?, units: [{id, topics: [topicId],
  grammar: [{pack, lesson}], chars: [form], text: textId | null, focus?: "listening" | "speaking", lessons?: [authored
  lessons]}]}], script: [{id, label, after: unitId, needs: [form]}], checkpoints: {unitPassMark, sectionPassMark}}`.
  `level` is the **name of a level in an installed levels pack** (e.g. `HSK 2`, `≈ N4`); section 0 has `level: null`
  and no filled words (it holds the Starter set and script steps). Stable authored ids (`s1`, `s1.u03`).
- **Filled course** (server only): `GET /api/courses/{language}` → `{courseId, version, hash, sections: [{id, name,
  units: [{id, topics, lessons: [{id, type, art?, ...}], textId, unplaced?}]}], report}`. `art` is an optional image
reference for the lesson's circle on the roadmap (#222 reserves the slot); no art ships in v0.9.0, the field is
reserved so adding it later is not a contract change. Lesson types: `words` (5–7
  words, each `{entryId, key}`), `script`, `grammar`, `practice`, `reading`, `check`. ETag = `hash`.
- **Routes** (need a user, workspace of the caller, like grammar): `GET /api/courses` (installed courses with their
  language), `GET /api/courses/{language}` (filled), `GET /api/courses/{language}/texts/{id}`, `GET
  /api/courses/{language}/report` (admin: unplaced and unlabelled words). Errors follow the existing error contract.
- **Core feature `courses`** added to the features list (ids and order are fixed by the features contract:
  append `courses`), nav entry and switch come with #222.
- **Events**: type `course` (payload kinds in overview §3.2), written through the normal outbox; no server code
  inspects them. Backups already include events; add the kinds to `backup/` fixtures so a restore keeps them
  (payloads hold unit ids and word keys, never database ids, so no remap).

## The fill rule (server, deterministic, a pure function of its inputs)

Inputs: the course pack, the level packs named by the sections, the labels, a rank function `rank(key)` (Jiten for
Japanese; the fallback of decision 7 for Chinese: character frequency plus word length), the characters each unit
introduces (`chars`, cumulative). Output: the units' word lessons and a report.

1. **Candidates of a section:** the words of its level in the level pack, **only that level's** (words of other
   levels never enter this section). Section 0 gets none.
2. **Readiness:** a word is *ready in unit k* when every Han/kanji character of it is in the `chars` of units ≤ k
   (kana and Latin always ready). `earliest(word)` = the first ready unit; a word never ready within the
   section is `unreadiable` (placed in the last unit, reported).
3. **Capacity:** `target = ceil(candidates / units)`, `cap = ceil(1.25 × target)`.
4. **Placement**, words in order of (`rank` ascending, `form`, `reading`): the units ≥ `earliest` whose `topics` hold
   one of the word's labels form the *preferred* set (the primary topic wins ties); choose the preferred unit
   with the lowest fill that is under `cap` (ties: the earliest unit); with no preferred unit with room, choose the
   non-preferred unit ≥ `earliest` with the lowest fill under `cap`; all full → the last unit (reported
   `overflow`). A word with no label is *unlabelled* (placed by the same rule, as if every unit were preferred).
5. **Lessons in a unit:** words sorted by (`rank`, `form`, `reading`), split into `k = ceil(n / 7)` lessons whose
   sizes differ by at most one (a unit with fewer than 5 words has one lesson). Lesson ids `w1`, `w2`, ….
6. **Without a level pack** (not installed): the section's words are the frequency band
   `[start, start + size)` of the rank list, sizes from the skeleton (`wordsPerSection` default), and the course says
   so in `report.fallback`.
7. **Report:** per section `{candidates, placed, overflow, unlabelled, unreadiable, lessonSizes}` and the
   forms of the first 50 of each list. Deterministic order.

Authored lessons (grammar, script, practice, reading, check) are placed by the skeleton, not the rule: unit `u`
has `[w1…wn, g1…, s1, p1, r1, c1]` in that order (script steps only where the skeleton lists them).

## Progress derivation (web, pure: `apps/web/src/lib/course/path.ts`)

Input: course events of the workspace (replayed in time order, duplicates by id already dropped), the filled
course, the learner's known marks. Output: for each unit `locked | current | done | skipped`, for each lesson `done
| started | todo`, for each section exam `closed | passed | skippedPast`, `current` (the first unit not done/skipped in
order), `resume` (below), catch-up lessons and `markKnown` (the words of skipped units to mark with `source: "course"`).

- A unit is **done** when all its lessons are done and its unit test is passed; **skipped** when a `skip` or a
  `placement` event covers it (or a later unit test/section exam was passed: it unlocks and skips everything
  before it); the path is **locked** beyond the first unit that is not done, except passed tests (overview §3.2).
- **Word lessons are done by words** (Ruling 1 of the overview): done when every word of the lesson is in the union
  of `wordKeys` of `lesson-done` events or in the known set.
- **Catch-up:** words of a done unit that are neither met nor known form one `catchup` lesson at the unit's
  end; units added before the learner's position are unlocked (they appear with state `current` after a
  re-derivation, never `locked`).
- **Section gate (owner, 2026-11-26):** the first unit of section n+1 stays `locked` until section n's exam is passed,
  or the learner passed a later section exam or a later unit test, or was placed past it (`placement`, `skip`). Inside a
  section the lessons unlock in order as before. A passed exam never locks again.
- **Resume ("Continue course"):** `resume = {ref, kind, why}` where `kind` is `lesson | unitTest | sectionExam | end` and
  `why` is `started | next | finished`. Rule: among lessons with a `lesson-start` event and no finishing event (neither a
  `lesson-done` naming the lesson nor all its words met or known), take the one with the **latest** `lesson-start`
  (ties by event id) → `started`; else the first lesson in path order that is not done or skipped, or the unit test /
  section exam when only that is left → `next`; when the whole course is done or skipped → `end`, `why = finished`.
  A started lesson is resumed even if later lessons were finished on another device (overview Ruling 7). Locked
  rows are never returned (the gate above is applied first).
- **Failed tests** change nothing (never take progress away), retries unlimited.

## Course cards and the General deck (owner, 2026-11-26)

Every word a lesson introduces gets a card that is in **both** `d-course-<lang>` and **General**, so normal study
sessions over General review course words. Implemented once in `lib/course/cards.ts` (`joinCourseDecks(entryIds)`),
used by #222 (`words` lessons, "Add these as cards"); the rule is pinned in `docs/contracts/courses/decks.json`:

- **When:** at the first exposure of a word in a `words` lesson (the lesson creates the card before the first
  grading), and when the learner presses "Add these as cards" on a skipped unit. Never on a skip alone (skips write
  known marks, not cards, as designed).
- **Duplicates:** the card id is `c-vocab-<entryId>`, one per word and workspace. If the card exists (from a deck,
  Starter mode, the reader, a level deck) it is **reused**; only the missing deck ids are added to its `deckIds`
  (`d-course-<lang>`, `general`). Existing decks are never removed. A word that appears twice in the fill output
  cannot (each candidate is placed exactly once), and two words with one entry resolve to one card.
- **Once only:** the deck ids are added at the first exposure and **never re-added**: a card the learner later moved
  out of General stays out (overview Ruling 8). The event `lesson-done {wordKeys}` is the record of "exposed".
- **Fill rule:** unchanged. It places words in lessons; it knows nothing about cards. A content update that moves a
  word to another lesson changes no card and no deck; a word met earlier is done by words (Ruling 1) and its card is
  already in both decks.
- **Progress by words met:** unchanged and independent of cards. Deleting a card or moving it out of General never
  undoes lesson progress; a lesson's "done" comes from events and known marks only.
- **Undo and removal:** Undo of a skip removes that batch's known marks only; cards already created by lessons (or by
  "Add these as cards") stay, they are ordinary cards. Uninstalling the course pack (or switching the `courses`
  feature off) deletes no card, event or deck: the roadmap and the Home widget disappear, `d-course-<lang>` remains
  a system deck with the cards that joined it, and reinstalling restores the roadmap because progress is derived
  from events. There is **no "reset course"** in v0.9.0 (cost if wrong: a learner cannot replay a course; a later
  action can write a `course-reset` event).
- **Daily limits:** first reviews inside a lesson stay exempt from the new-card limit (existing rule). A card created
  by a lesson and not graded (the learner left) is an ordinary **new card in General** and counts against the
  new-card limit in normal sessions.
- **Offline:** the lesson writes the card rows (and the deck ids) through the normal outbox with the other review
  rows; nothing needs the network after the course is prepared. Two devices adding the same word concurrently merge
  by the decks contract's row-level last-write-wins (a deck id may be lost on one device; there are never duplicate
  cards); the next lesson event or the learner's own move repairs it (cost: a word may be missing from one deck until
  then).

## Tasks

1. **Contract and fixtures first** (`docs/contracts/courses/`): `README.md`; `fill.json` (small packs in, units out,
   incl. each numbered rule above: readiness, capacity, overflow, unlabelled, no level pack, determinism);
   `path.json` (event histories → states: fresh learner, skipping by test, by section exam, placement, failed
   test, catch-up, unit added before the position, duplicate events, unknown event kinds ignored; **the section gate**:
   section 2 locked until exam 1 is passed, unlocked by passing a later exam, by placement; **`resume`**: nothing
   started → the first lesson (`next`), a started unfinished lesson (`started`), two started lessons → the latest,
   a finished last lesson → the next one, a started lesson while later ones are finished elsewhere → the started
   one, only an exam left → `sectionExam`, a finished or fully skipped course → `end`);
   `decks.json` (the card-deck rule above: new word → two decks, existing card in another deck → union, card moved
   out of General → not re-added, the same word in two skipped units, "Add these as cards", uninstall keeps cards);
   `content-change.json` (a pack update moves words between lessons; the done state follows words);
   `events.json` (payload kinds, which are valid, how a client builds them); `routes.json` (request/answer shapes).
   Reviewed by the owner or the review agent before code starts.
2. **Migration and type package** `server/internal/course` (registry `course_packs`, a `course_fill_cache`
   table keyed by `(language, hash)`), `Import`/`Uninstall` per ADR 0008 steps 1–4, `All` and `handlers` rows,
   `pack-types.json` row, web `PackType` + label + `en.json`, the table tests listed in step 7 of the ADR.
3. **Loader and validation** (`course.json` schema): reject unknown topic ids (against `topics.json`), duplicate
   unit ids, a `grammar` reference to a lesson that is not in an installed grammar pack (a warning, not a
   failure: packs can be installed later), a `level` that names no level in the installed pack (the fill falls
   back, see rule 6).
4. **Fill rule** (`course/fill.go`) with table tests against `fill.json`; property test: every candidate word is
   placed exactly once; sizes within the bound; same output on a shuffled input.
5. **Routes + cache + admin report**; ETag; hash = the versions of the course pack, level packs, labels, rank pack;
   test: installing a level pack invalidates; an unchanged re-import writes nothing (`reimport_noop`).
6. **Features and decks contract:** `courses` appended to `features/`; `d-course-<ja|zh>` in
   `decks/system-deck-ids.json`; the course cards' first reviews are exempt from the new-card limit (fixture in the
   cards limits contract, **existing limits fixtures unchanged**).
7. **Path derivation** `lib/course/path.ts` + `path.contract.test.ts` over `path.json` and `content-change.json`
   (no DOM, no network, no clock), including the section gate and `resume`.
   **Deck helper** `lib/course/cards.ts` + `cards.contract.test.ts` over `decks.json` (pure planner: given the existing
   cards and the entry ids it returns the rows to write).
8. **Event builders and outbox** `lib/course/events.ts` (`lessonDone`, `unitTest`, … ), `events.contract.test.ts`.
9. **Client data layer** `lib/course/load.ts`: fetch the filled course with the ETag, keep it in the offline
   preparation cache (the step itself is #222).
10. **Docs:** contracts CHANGELOG (expected 14), `docs/wiki/` (Data-pack-format: the `course` type; API routes),
    ADR 0008 touched-by list, `docs/sources.md`, `LICENSING.md` paragraph for the course pack, a
    `check-sources` test that no course file contains a form from a no-reuse level pack, ROADMAP.
11. **Verify:** Go tests with `-race` on `course` and `packs`, web `check` and `test`, merge `origin/develop`, PR.

## Rulings

- Ruling: the fill rule runs **only on the server** and clients receive its result — a TypeScript copy would have to
  be kept in step byte for byte and the shell gets it through the web app anyway — if wrong, an offline-only start
  without a cached course shows "prepare the course first" (cost: the first open needs the network once).
- Ruling: placement prefers topic match, then lowest fill, with a 25 % cap — pure topic matching leaves popular
  topics (food) huge and others empty — if wrong, units are slightly uneven (cost: the report shows it; the cap is
  a constant).
- Ruling: a word never ready within its section is **placed and reported**, not dropped — losing a level word
  silently would break the "course reaches the level" promise — if wrong, a learner meets a word before its
  character (cost: one reading hint; the reading lesson shows readings anyway).
- Ruling: `course` events are a single type with a `kind` field rather than several types — the server stores any
  type, and one type keeps the replay and the pull filter simple — if wrong, a split later needs a migration of
  stored rows (cost: low; events are append-only and parsed leniently).
- Ruling: course cards join **both** `d-course-<lang>` and General at the first exposure and are never re-added —
  the owner wants lessons to feed normal study, and a learner's own deck moves must stick — if wrong, a word may be
  absent from General after a manual move (cost: a "Re-add course cards" action; the helper is one pure function).
- Ruling: the section exam is a **gate**, and `resume` is derived from events by a pure function with a fixture —
  every client (web, the Home widget, the Android shell through the web app) must land on the same lesson — if
  wrong, a learner is sent to a lesson they would not choose (cost: a rule change plus fixtures, no stored data).
- Ruling: course packs are **not uploadable** — the course is project content with a fixed contract — if wrong, an
  administrator cannot add their own course (cost: none for v0.9.0).

## Needs human review

The fixtures (they are the specification) and the first fill report on real data (#223 produces the skeleton).
No native-speaker review.

## Done when

A server with a tiny test course and the bundled level packs serves `GET /api/courses/zh`; the Go fill tests and
the web path tests (gate, `resume`) and deck-helper tests decode the same fixtures; the contract is documented; CI green.
