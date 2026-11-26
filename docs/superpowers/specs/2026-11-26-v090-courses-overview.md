# v0.9.0 — courses: overview, order and decisions

Status: **decided by the owner on 2026-11-26** (section 5 records the answers and rulings; nothing blocks building).
Planning only: no code was written. Builds on the approved design
`docs/superpowers/specs/2026-11-24-courses-design.md` (epic #218) and does not reopen its decisions (approach C,
locked path with tests to skip ahead, course words join normal study, never blocked by daily limits, skipped
units mark words known, the course pack holds only project content under CC BY 4.0). Where this overview adds
a rule, it says so as a *Ruling* with the cost if wrong. Each issue has its own plan in `docs/superpowers/plans/`.

Branch rule: v0.9.0 work branches from `develop` once PR #265 (v0.8.0) has been merged, or from
`feature/v0.8.0` before. It never enters the v0.8.0 integration branch. Contract numbers below are expected, not
reserved: ContractVersion is 13 today and parallel branches are renumbered at merge, as in v0.8.0.

## 1. The twelve issues at a glance

| # | Issue | Kind | Stage | Needs first | Human review of content |
|---|---|---|---|---|---|
| 219 | Estimated JLPT word list (`jlpt-words`), **estimate only, no base list** | data + generator | A | JLPT kanji estimate (done), JMdict, Jiten (bundled) | per-level counts |
| 220 | Topic labels for words | data + generator + review file | A | #216 picture mapping (v0.8.0) | **owner reviews every shipped label** |
| 237 | Mandarin recordings — **parked: moved to "After v1.0" (owner, 2026-11-26)** | data + audio | — | — | — |
| 221 | Course pack format, fill rule, progress contracts | server + contracts | B | #219, #220 files (not their review) | none (rules and fixtures) |
| 222 | Roadmap, lesson player, progress (web) | web | C | #221 | UI check on a phone |
| 223 | Chinese and Japanese skeletons and reading texts | content | C | #220 labels, #221 format and fill rule | **owner reviews the skeleton; native review of texts** |
| 224 | Unit tests and section exams | web + contracts | C | #221, #222 | question quality; pass marks |
| 225 | Milestones, home widget, onboarding | web + contracts | D | #221, #222, #224 | wording |
| 226 | Exam target and study plan | web + contracts | D | #219, #221 (course lessons), level lists | the pace model's wording |
| 183 | "Read next" suggestions | server cache + web | R | #68 coverage rule (done) | none |
| 231 | Graded reading library | pack type + content | R | #183 scoring, text format of #221/#223 | **owner reviews; native review of texts** |
| 218 | Epic | — | — | all of the above | — |

Counts: the milestone now has 11 issues including the epic (#218); #237 left it. The epic has no plan of its own,
this overview is its plan. #237's plan stays in `plans/` marked parked.

## 2. Recommended order

Three tracks, the first two joined at stage C:

```
Stage A (parallel, no dependencies between them)
  #219 jlpt-words ─┐
  #220 labels ─────┘                         Track R (parallel to B–D, needs only #68, #216)
                   │                           #183 read next ──► #231 graded library
                   ▼
Stage B   #221 course pack, fill rule, progress contracts   (the keystone: everything in C and D waits for it)
                   ▼
Stage C (parallel)
  #222 roadmap + lesson player ─┐
  #223 skeletons + texts ───────┼─► #224 unit tests + section exams (needs #222's player)
                                ▼
Stage D (parallel)
  #225 milestones, Home widget, onboarding      #226 exam target + study plan
```

Why this order:

- **#219 and #220 first** because the fill rule can only be checked against real level lists and labels, and
  because both are slow data jobs (the owner reviews the low-confidence labels and a sample of the rest) that run
  while the code is built.
- **#221 is the keystone** (pack type, fill rule, event contract and the path derivation). #222, #223, #224,
  #225 and #226 all consume its fixtures. The fixtures are written first, so web and server can be built in
  parallel against them.
- **#223 (content) runs beside #222 (screens)**: the skeleton is written against the format and checked with the
  fill rule's report, the player is built against a tiny test course. They meet in an end-to-end check.
- **#224 after #222** because a test is a lesson type in the player.
- **#225 and #226 last**: they read course progress, so they wait for the contracts, and the plan's lessons-left
  estimate needs the real skeleton size.
- **Track R is independent**: "read next" needs only the reader's coverage rule; the graded library (#231)
  feeds it with texts. Do #183 first, then #231. The course's unit texts and the graded texts share one text
  format (§3.3) so the same reader code serves both.

Suggested stage sizes (agent days, one agent each, my estimate): A 2 + 3; B 5; C 5 + 4 (content) + 4;
D 3 + 3; R 3 + 4. Content reviews by the owner are the long poles, not the code.

## 3. Shared design

### 3.1 Data model

- **Pack type `course`** (one row in the pack-type table, ADR 0008: migration, type package
  `server/internal/course`, `All` and `handlers` rows, contract row, web label). One pack per language
  (`plugins/data/course-zh`, `course-ja`), `languages` shape *One*. Not uploadable (project content). Files:
  `course.json` (sections, units, checkpoint rules), `texts/<id>.json` (unit reading texts), `topics.json` and
  `labels.tsv` (#220), `LICENSE` (CC BY 4.0), `ATTRIBUTION.md`, `manifest.json`. **No level-list words** (owner,
  2026-11-24) — see Ruling 3 on labels.
- **Filled course:** the server builds the filled course (units with their word lessons) from the installed
  course pack, the installed `levels` word packs (`hsk-words`; `jlpt-words`), the labels and the frequency
  packs, and caches it in a table keyed by a hash of those inputs' versions. `GET /api/courses/{language}`
  serves it with an ETag; a pack install or uninstall changes the hash and the cache rebuilds. Clients never run
  the fill rule.
- **Word identity** in a lesson is `entryId` (what cards use) plus the stable key `form|reading` (what events
  and labels use, so backups and re-seeded servers keep working).
- **New core feature `courses`** with a per-user switch (features contract: ids are fixed, so this is a contract
  change), nav entry on the bottom bar's section list.
- **Settings:** `studyTarget` (workspace setting, #226) and nothing else new. Course progress is events only.

### 3.2 Progress: events and the derived path

- One new event type `course` (the server never inspects types; payload kinds are pinned by the contract):
  `lesson-start`, `lesson-done {unit, lesson, result, wordKeys?}`, `unit-test {unit, score, total, passed}`,
  `section-exam {section, score, total, passed}`, `skip {unit|section, via}`, `placement {section}` and
  `add-cards {unit}`. All kinds are defined in #221 even where #224/#225 consume them, so there is one bump.
- **Derivation** (`lib/course/path.ts`, a pure function; fixtures in `docs/contracts/courses/`): events + the
  filled course → per unit `locked | current | done | skipped`, per lesson `done | todo`, catch-up lessons and the
  list of words to mark known. It runs on the client like every other statistic.
- **Ruling 1: word lessons are done by words, not by index.** A word lesson counts as done when every word it
  holds now has been met (a `lesson-done` event named it in `wordKeys`, or it is a known mark). Why: the fill rule
  can move words between lessons when a pack changes, and an index-based "done" would then lie. Cost if wrong:
  after a content update a lesson can show done though its numbering moved; only authored lessons (grammar,
  script, practice, reading) keep id-based progress. The same rule yields the catch-up lesson for free: words in
  a finished unit that were never met.
- **Skipping** reuses the v0.8.0 declaration machinery (#74): `known:<entryId>` marks with `source: "course"` and
  a `batch` id per skip, so "Undo" and "Add these as cards" are the existing batch operations.
- **Course deck and the General deck:** `d-course-<ja|zh>` (a plain system deck like `d-starter-*`, decks contract).
  A word's card is created by the lesson on first exposure and joins **both** `d-course-<lang>` and **General**
  (owner, 2026-11-26), so normal study sessions over General review course words too. Rules in §3.8.
- **Daily limits:** a card first reviewed inside a course lesson does not count against the new-card limit; the
  lesson pace is the limit. Reviews count as usual. The rule is pinned in the cards contract (`limits`); it is a
  small change in `lib/study/limits.ts` and must not change any existing limits fixture.

### 3.3 Content formats shared by the course and the graded library

- **Text** (`text.json`): `{id, title, level, language, paragraphs: [string], glossed: [{form, reading, gloss}],
  source: {unit} | {library}}`. The course's unit texts (#223) and the graded readers (#231) use the same schema,
  so one reader code path opens both. Texts open in the reader as **pack texts** (a new library source kind
  `pack`, read-only, no stored book row until the learner bookmarks or highlights, then it is copied into the
  library). The reader's smart readings already show readings by learner knowledge; the lesson forces readings
  on for words beyond the learner's progress.
- **Coverage rule** (#68, `reader/coverage.json`) is the single measure of "at level": share of tokens whose
  word is at or below the text's level. It runs in the build checks of #223 and #231 and in #183.

### 3.4 Where code lives; offline and the Android shell

- Screens, derivations (path, plan, read-next scoring) and the lesson player are **web only**
  (`apps/web/src/lib/course`, `lib/plan`, `lib/features/course`). The Android shell gets them through the web app
  (ADR 0010); nothing in `apps/web` imports a Capacitor package and no native code is needed. The fill rule,
  caches and pack code are **server only** (Go), pinned by fixtures the Go tests decode.
- **Offline:** the lesson player needs the filled course, the unit's texts and the cards' entries. The existing
  offline preparation (service worker plus `lib/pwa`) gets one more step: "prepare the course" caches the filled
  course JSON and the texts (about 0.5–1.5 MB per language) and the entries of the current section. It is the same
  mechanism as the cards' offline preparation; sizes are measured in #222. Picture and audio files stay online
  only (as in v0.8.0).
- Reminders (v0.7.0) are unaffected; "Continue course" is a Home widget (§#225), not a notification.

### 3.5 Expected contract changes

| Expected no. | Issue | Change |
|---|---|---|
| 14 | #221 | `courses/` contract (pack, routes, fill rule, events, path derivation incl. the `resume` position and the section gate, content-change cases), `course` pack type row, `courses` feature switch, course deck id and its membership rule, limits exemption |
| 15 | #224 | none if #221 already defines the test events; otherwise the test and pass-mark rules |
| 16 | #225 | milestone catalogue families for the course; weekly summary rows |
| 17 | #226 | `plan/` contract (target setting, pace rule, status rule) |
| 18 | #183 | `reader/read-next.json` (scoring rule) and the token-count route |
| 19 | #231 | `graded-readers` pack type row |

No contract change: #219 (a `levels` pack is a known type), #220, #222 (screens over #221), #223 (content).
Each builder takes the next free number and records the numbers it actually took in the CHANGELOG; the merge
step renumbers, as in v0.8.0.

### 3.6 Licensing under the owner's rule

Only data under CC BY-SA 4.0 or more permissive is bundled, with notices; each source is checked at download time
and recorded in `docs/sources.md` and the pack's `ATTRIBUTION.md`.

| Material | Source and licence | Pack licence | Note |
|---|---|---|---|
| Course skeletons, texts, topic list and labels | project-written, CC BY 4.0 | CC BY 4.0 | labels see Ruling 3 |
| `jlpt-words` | **estimate only**: `jlpt-kanji` levels plus Jiten ranks (CC BY-SA 4.0); no Waller base list (owner, decision 5) | **CC BY-SA 4.0** | Ruling 4; nothing to confirm: no third-party list is copied |
| Labels derived from OpenMoji groups | OpenMoji CC BY-SA 4.0 | **CC BY 4.0 with OpenMoji credit** (decision 4) | no emoji group names in the file |
| Mandarin recordings (#237) | parked (After v1.0). The audit stays valid: Lingua Libre words pass, syllables fail; the BY-SA 3.0 acceptance for KanjiVG does not extend to them (decision 6) | — | — |
| HSK words | official list, no reuse licence, bundled at the owner's decision | unchanged | **never copied into a course file** |

- **Ruling 3: labels cover a frequency band, not a level list.** The label file is keyed by `form|reading` and
  labels the most frequent N words (target 8,000 per language by Jiten rank for Japanese, by character-and-word
  frequency for Chinese, see decision 7), not "HSK 1–4". Level membership is only ever read from the installed
  level packs at fill time. Why: a file that carries exactly the HSK 1–4 words would reproduce a list that has no
  reuse licence, which the owner excluded from the course pack. Cost if wrong: if the cut-off misses some HSK
  words they have no topic and are placed by frequency (reported as "unlabelled" by the coverage report); a
  higher cut-off costs review time.
- **Ruling 4: `jlpt-words` is CC BY-SA 4.0** because the estimate uses Jiten's frequency ranks (CC BY-SA 4.0).
  Cost if wrong: the pack may not be combined into a CC BY pack; it is a levels pack served separately, so
  nothing else is affected.
- `LICENSING.md` gets one paragraph for the course pack (CC BY 4.0, project content, no level-list words) and
  one for `jlpt-words`; `docs/sources.md` gets the OpenMoji-labels entry and the `jlpt-words` method (Waller is not used);
  `scripts/check-sources.mjs` gets a rule that no course pack file contains a form listed in an installed
  level pack with a no-reuse licence (a test over the committed pack files).

### 3.7 Content pipeline and review gates

All content (skeleton, texts, labels) is drafted by an agent, **checked by tools** (fill-rule report, coverage
rule, schema), and **reviewed by the owner** before it ships. Reading texts are not native-reviewed before the
release; native review happens during the owner's own use, as for the grammar lessons, and the release notes say
so. Starter-style flags: course texts carry `humanReviewed: false` in the pack until the owner marks them, and
the app shows nothing different (the flag is for the maintainers and the Sources page).

## 4. Risks

1. **Review bottleneck.** Labels (8,000 per language), two skeletons (about 130 units) and about 60–100 texts need
   the owner's eyes. Mitigation: review files are diffs of small chunks; labels have a confidence column and the
   the owner reviews the low-confidence ones in full and a 10 % sample of the rest (decision 3); the skeleton ships even if texts are partly
   unreviewed.
2. **Chinese word frequency is not bundled** (only Jiten for Japanese). The fill rule needs an order inside a
   level. Decision 7: character frequency from Unihan/`hsk-chars` plus word length now; quality is lower, a word
   frequency pack is a separate data issue later.
3. **A self-reported "exam" is no exam**: the level check (#82) is self-assessed, so tests are graded questions
   (decision 2); the cost is distractor quality, checked in #224.
4. **Content updates vs learners' progress** (word lessons moving): handled by Ruling 1, covered by fixtures.
5. **Scale of one event stream:** a course adds ≈ 10–20 events per session; the event log is append-only and
   already paged. Not a risk at this size, measured in #221.
6. **Flaky emulator job** still blocks merges (core job re-runs); unrelated to courses.
7. **A long roadmap on a phone** (decision 10): hundreds of circles in one scroll. Mitigation: a virtualised list
   with a fixed row height and measured jump targets, see the #222 plan.
8. **Lesson player scope creep:** six lesson types hosted from existing components. Mitigation: #222 builds the
   player and three types first (new words, grammar, reading) and treats script and practice as follow-up tasks
   in the same plan.

## 5. Decisions (owner, 2026-11-26)

The numbers are those of the earlier question list; the plans refer to them. Every answer is binding for the plans.

| # | Question | Answer |
|---|---|---|
| 1 | Is #237 (Mandarin recordings) in v0.9.0? | **No.** Moved to "After v1.0"; its plan is parked. |
| 2 | How is a "test out" graded? | Real questions (multiple choice from dictionary glosses, seeded) for unit tests and section exams; self-report stays for placement (#74) and the level check (#82). |
| 3 | Label review scope | Low-confidence labels reviewed in full; the rest (OpenMoji-derived, agent confidence of 0.85 or more) ships after a 10 % sample; `reviewed` flags in the file. |
| 4 | Licence of the labels file | CC BY 4.0 with an OpenMoji credit; no emoji group names in the file. |
| 5 | Waller's JLPT lists | **Not used.** `jlpt-words` is the estimate only (kanji levels plus Jiten ranks). |
| 6 | BY-SA 3.0 audio (Zh syllables) | The KanjiVG acceptance does **not** extend to the syllable recordings. Moot while #237 is parked. |
| 7 | Chinese word frequency | Character frequency (Unihan, `hsk-chars`) plus word length now; a word frequency pack is a separate data issue later. |
| 8 | Unit and section sizes | 5–7 words per lesson, 10–20 units per section. |
| 9 | Pass marks | Unit test 80 %, section exam 85 %, free retries, kind feedback; in the pack. |
| 10 | The roadmap and "Continue course" | The owner's design below (3.8), a bottom-bar section the learner can choose, plus a Home widget. |
| 11 | Study plan scope (#226) | Word and character counts and course lessons; grammar lessons only where a pack tags a level. |
| 12 | "Read next" sources (#183) | Only text already on the server (library, graded pack texts, imported texts). |

### 3.8 The roadmap as an endless path, and the deck rule (decision 10, the owner's words made precise)

- **The roadmap** is one near-infinite vertical scroll from the first lesson down to the final lesson of the course.
  Each **lesson is a circle** (a slot inside it is reserved for an illustration later). The circles are joined by a
  **zig-zagging connection going down** (alternating left and right offsets). **Section exams are blockades**
  between sections: for now a rectangle across the path (a wall), visibly different from the circles; the learner
  cannot pass it until the exam is passed. Unit tests appear as a circle with a check badge at the end of their
  unit (Ruling 5). Details, layout, accessibility and the virtualisation are in the #222 plan.
- **"Continue course"** (Home widget and the roadmap's own button) opens the roadmap scrolled to the **last lesson
  the learner started**, or to the **next lesson to start** if the last started one is finished. The rule is a pure
  function of the events (`resume` in `path.ts`, fixtures in #221), so every client agrees.
- **Cards join the General deck.** Every lesson's flashcard is also in General, so normal sessions review it:
  the card joins `d-course-<lang>` and General at the first exposure. The full rule (fill rule, duplicates, progress
  by words met, undo and removal, offline) is in the #221 plan.

Rulings added with these decisions:

- **Ruling 5: unit tests are the last circle of a unit, section exams are the walls.** The owner described circles
  for lessons and a wall for section tests; the unit test is a lesson-like step, so it is a circle with a check
  badge, and only the section exam blocks. Why: a wall per unit would triple the walls on a long scroll. Cost if
  wrong: the badge needs a different look (a CSS and one test change); no contract change.
- **Ruling 6: the section exam is a real gate, units inside a section are not.** The next section stays locked
  until its predecessor's section exam is passed, or the learner skips ahead by passing a later exam or by
  placement (#74). Inside a section the lessons unlock in order as designed. Why: the owner's words ("blockades
  until you get to the next one"). Cost if wrong: a section can unlock without its exam (a derivation rule in
  `path.ts`, covered by the fixtures).
- **Ruling 7: "Continue" never skips a started lesson.** A lesson started and not finished is resumed (its state
  is only "started"; nothing partial is stored), even if later lessons were finished on another device. Why: it
  matches "the last lessons you started". Cost if wrong: a learner may be sent back one lesson (one tap to move on).
- **Ruling 8: General membership is added once, at first exposure, and never re-added.** If the learner later
  moves the card out of General, the course does not put it back. Why: respecting the learner's decks. Cost if
  wrong: a course word may not appear in General sessions after a manual move (a "Re-add course cards" action
  later).

**Still open: nothing that blocks building.** Soft items for later: the illustration style for lesson circles
(after the first release), whether unit tests should look different (Ruling 5), a word frequency pack for Chinese
(a separate data issue), and the owner's review time for the labels, the skeletons and the texts (content gates,
not code blockers).

## 6. What blocks building

Nothing blocks starting **#219, #220, #221, #183**. Blockers for the rest:

- **#220:** the owner's review time for the low-confidence labels (decision 3); the Chinese frequency order
  comes from the character-frequency fallback (decision 7), so no data is awaited.
- **#222–#226, #231:** #221 (fixtures first).
- **#223:** owner review of the skeleton (content gate, not a code blocker).

## 7. Not in v0.9.0

An authoring UI; courses beyond ≈ HSK 4 / ≈ N3; languages beyond Chinese and Japanese (#201 is after v1.0); the
Google Play / F-Droid work (#149); listening and speaking lesson types beyond what exists (#135, #136, #213 are
after v1.0: the player skips a lesson type whose card kind is not installed). Mandarin recordings (#237) and a
Chinese word frequency pack are also after v0.9.0; the JLPT base list of Jonathan Waller is not used.
