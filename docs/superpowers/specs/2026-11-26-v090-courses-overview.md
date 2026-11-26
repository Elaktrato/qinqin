# v0.9.0 — courses: overview, order and open decisions

Status: **proposal for the owner** (2026-11-26). Planning only: no code was written. Builds on the approved design
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
| 219 | Estimated JLPT word list (`jlpt-words`) | data + generator | A | JLPT kanji estimate (done), JMdict, Jiten (bundled) | licence of the base list; per-level counts |
| 220 | Topic labels for words | data + generator + review file | A | #216 picture mapping (v0.8.0) | **owner reviews every shipped label** |
| 237 | Mandarin recordings (moved from v0.8.0, owner said "later") | data + audio | A, optional | existing `fetch-audio-commons.mjs` | licence snapshot; native listening |
| 221 | Course pack format, fill rule, progress contracts | server + contracts | B | #219, #220 files (not their review) | none (rules and fixtures) |
| 222 | Roadmap, lesson player, progress (web) | web | C | #221 | UI check on a phone |
| 223 | Chinese and Japanese skeletons and reading texts | content | C | #220 labels, #221 format and fill rule | **owner reviews the skeleton; native review of texts** |
| 224 | Unit tests and section exams | web + contracts | C | #221, #222 | question quality; pass marks |
| 225 | Milestones, home widget, onboarding | web + contracts | D | #221, #222, #224 | wording |
| 226 | Exam target and study plan | web + contracts | D | #219, #221 (course lessons), level lists | the pace model's wording |
| 183 | "Read next" suggestions | server cache + web | R | #68 coverage rule (done) | none |
| 231 | Graded reading library | pack type + content | R | #183 scoring, text format of #221/#223 | **owner reviews; native review of texts** |
| 218 | Epic | — | — | all of the above | — |

Counts: the milestone has 12 open issues including the epic (#218) and #237; the epic has no plan of its own,
this overview is its plan.

## 2. Recommended order

Three tracks, the first two joined at stage C:

```
Stage A (parallel, no dependencies between them)
  #219 jlpt-words ─┐
  #220 labels ─────┤                         Track R (parallel to B–D, needs only #68, #216)
  #237 recordings  │ (optional, any time)      #183 read next ──► #231 graded library
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
  because both are slow, review-bound data jobs (the owner reviews labels; the JLPT list needs a licence check)
  that run while the code is built.
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

Suggested stage sizes (agent days, one agent each, my estimate): A 3 + 3 + 3; B 5; C 5 + 4 (content) + 4;
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
- **Course deck:** `d-course-<ja|zh>` (a plain system deck like `d-starter-*`, decks contract). Cards are created
  by the lesson on first exposure.
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
| 14 | #221 | `courses/` contract (pack, routes, fill rule, events, path derivation, content-change cases), `course` pack type row, `courses` feature switch, course deck id, limits exemption |
| 15 | #224 | none if #221 already defines the test events; otherwise the test and pass-mark rules |
| 16 | #225 | milestone catalogue families for the course; weekly summary rows |
| 17 | #226 | `plan/` contract (target setting, pace rule, status rule) |
| 18 | #183 | `reader/read-next.json` (scoring rule) and the token-count route |
| 19 | #231 | `graded-readers` pack type row |
| 20 | #237 | audio syllable/word playback order, if syllables ship |

No contract change: #219 (a `levels` pack is a known type), #220, #222 (screens over #221), #223 (content).
Each builder takes the next free number and records the numbers it actually took in the CHANGELOG; the merge
step renumbers, as in v0.8.0.

### 3.6 Licensing under the owner's rule

Only data under CC BY-SA 4.0 or more permissive is bundled, with notices; each source is checked at download time
and recorded in `docs/sources.md` and the pack's `ATTRIBUTION.md`.

| Material | Source and licence | Pack licence | Note |
|---|---|---|---|
| Course skeletons, texts, topic list and labels | project-written, CC BY 4.0 | CC BY 4.0 | labels see Ruling 3 |
| `jlpt-words` | Waller lists (reuse repos state CC BY; licence to be confirmed from an archived copy) plus Jiten ranks (CC BY-SA 4.0) | **CC BY-SA 4.0** | Ruling 4; if the Waller licence cannot be confirmed the base list is dropped and the whole list is frequency/kanji estimated |
| Labels derived from OpenMoji groups | OpenMoji CC BY-SA 4.0 | CC BY 4.0 with OpenMoji credit, or BY-SA 4.0 | open decision 4 |
| Mandarin recordings (#237) | Lingua Libre words: 2,976 CC BY-SA 4.0 + 1,132 CC0; syllables mixed 3.0/2.0 (fail) | CC BY-SA 4.0 (words) | as v0.8.0 audit |
| HSK words | official list, no reuse licence, bundled at the owner's decision | unchanged | **never copied into a course file** |

- **Ruling 3: labels cover a frequency band, not a level list.** The label file is keyed by `form|reading` and
  labels the most frequent N words (target 8,000 per language by Jiten rank for Japanese, by character-and-word
  frequency for Chinese, see decision 7), not "HSK 1–4". Level membership is only ever read from the installed
  level packs at fill time. Why: a file that carries exactly the HSK 1–4 words would reproduce a list that has no
  reuse licence, which the owner excluded from the course pack. Cost if wrong: if the cut-off misses some HSK
  words they have no topic and are placed by frequency (reported as "unlabelled" by the coverage report); a
  higher cut-off costs review time.
- **Ruling 4: `jlpt-words` is CC BY-SA 4.0** because the gap fill is derived from Jiten's frequency ranks
  (CC BY-SA 4.0) and the base list (CC BY) may be included in a BY-SA work. Cost if wrong: the pack may not be
  combined into a CC BY pack; it is a levels pack served separately, so nothing else is affected.
- `LICENSING.md` gets one paragraph for the course pack (CC BY 4.0, project content, no level-list words) and
  one for `jlpt-words`; `docs/sources.md` gets the Waller, OpenMoji-labels and Lingua Libre entries;
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
   owner can review only the low-confidence ones (decision 3); the skeleton ships even if texts are partly
   unreviewed.
2. **Chinese word frequency is not bundled** (only Jiten for Japanese). The fill rule needs an order inside a
   level. Fallback exists (character frequency from Unihan/`hsk-chars` plus word length), but quality is lower
   (decision 7).
3. **A self-reported "exam" is no exam** (decision 2): the level check (#82) is self-assessed, and a test out must
   be graded.
4. **Content updates vs learners' progress** (word lessons moving): handled by Ruling 1, covered by fixtures.
5. **Scale of one event stream:** a course adds ≈ 10–20 events per session; the event log is append-only and
   already paged. Not a risk at this size, measured in #221.
6. **Flaky emulator job** still blocks merges (core job re-runs); unrelated to courses.
7. **Lesson player scope creep:** six lesson types hosted from existing components. Mitigation: #222 builds the
   player and three types first (new words, grammar, reading) and treats script and practice as follow-up tasks
   in the same plan.

## 5. Open owner decisions

Each has a recommendation; the plans assume the recommendation.

1. **Is #237 (Mandarin recordings) part of v0.9.0 at all?** You said "later" for v0.8.0 and it sits in the v0.9.0
   milestone. Options: (a) keep in v0.9.0 as an independent stage-A job, words only; (b) move to "After v1.0".
   *Recommendation (a)*: it is independent, does not block the course, and gives Chinese real audio. Syllable
   playback depends on decision 6.
2. **How should a "test out" be graded?** (a) real questions from dictionary glosses (multiple choice, distractors
   from the same level and part of speech), seeded; (b) self-report like #82/#74. *Recommendation (a)* for unit
   tests and section exams; keep self-report for placement (#74) and the level check. Cost of (a): distractor
   quality needs checking and the tests only cover what the dictionary can gloss.
3. **Label review scope.** Review all ~8,000 labels per language, or only the low-confidence ones (OpenMoji-
   derived labels and agent suggestions above 0.85 confidence ship after a 10% sample)?
   *Recommendation*: low-confidence only plus a 10% sample; ship `reviewed` flags in the file.
4. **Licence of the labels file.** OpenMoji-derived topic assignments: (a) CC BY 4.0 with an OpenMoji credit,
   treating the assignment (word → topic) as project content, (b) CC BY-SA 4.0 for the labels file.
   *Recommendation (a)*, with the emoji group names kept out of the file. If you prefer certainty, (b) costs
   nothing but a second licence in the course pack.
5. **Waller's JLPT lists.** The reuse repository states "Creative Commons BY" and the archived copy exists
   (Wayback, 2026-09-04), but the licence text was not found on the archived index page in a quick check. Do
   you accept the reuse repository's statement plus the archived copy as evidence? *Recommendation*: yes if the
   archived download page or readme names the licence; otherwise drop the base list and use the estimate only
   (the plan covers both).
6. **BY-SA 3.0 audio (Zh syllables).** You accepted 3.0 for KanjiVG. Does that extend to the Mandarin syllable
   recordings (mixed 3.0, 2.0, 2.0-UK, and CC0), as a separate BY-SA pack? *Recommendation*: no. Ship the 4.0
   and CC0 words and the few passing syllables only; no syllable-by-syllable playback until a source with a clean
   licence exists.
7. **Chinese word frequency.** Options: (a) character frequency from Unihan and `hsk-chars` plus word length, no
   new data; (b) add a Chinese word frequency pack if a source passes the licence rule (candidate: wordfreq data;
   its sources' terms must be checked first); (c) the HSK list's own order. *Recommendation (a)* for v0.9.0 and a
   separate data issue for (b).
8. **Unit and level sizes.** Default targets: 5–7 words per lesson, 10–20 units per section. Accept?
   *Recommendation*: yes, tune after the first fill report.
9. **Pass marks:** unit test 80 %, section exam 85 %, free retries, kind feedback. Accept? *Recommendation*: yes;
   they live in the pack so they can change without code.
10. **Where "Continue course" sits:** Home widget only, or also a bottom-bar entry (the roadmap)?
    *Recommendation*: the roadmap is a bottom-bar section the learner can choose (#188); the widget is on Home by
    default for a workspace with an active course.
11. **Study plan scope (#226):** word and character counts plus course lessons only, or also grammar lessons?
    *Recommendation*: words, characters and course lessons first; grammar lessons only where the pack tags a
    level (today's grammar packs may not).
12. **"Read next" sources (#183):** library books, graded pack texts and imported texts only (text already on the
    server), or also on-demand Aozora/Gutenberg catalogue texts (needs a fetch and a licence line per text)?
    *Recommendation*: only text already on the server in v0.9.0; catalogue texts later.

## 6. What blocks building

Nothing blocks starting **#219, #220, #221, #183**. Blockers for the rest:

- **#219:** the Waller licence evidence (decision 5); the plan has the no-base-list fallback.
- **#220:** the owner's review time; a Chinese frequency source for the cut-off (decision 7 has a no-data
  fallback).
- **#222–#226, #231:** #221 (fixtures first).
- **#223:** owner review of the skeleton (content gate, not a code blocker).
- **#237:** decision 1 and a download of about an hour.

## 7. Not in v0.9.0

An authoring UI; courses beyond ≈ HSK 4 / ≈ N3; languages beyond Chinese and Japanese (#201 is after v1.0); the
Google Play / F-Droid work (#149); listening and speaking lesson types beyond what exists (#135, #136, #213 are
after v1.0: the player skips a lesson type whose card kind is not installed).
