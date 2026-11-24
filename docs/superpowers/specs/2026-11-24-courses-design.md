# Courses — a guided path from beginner to ≈ HSK 4 / ≈ JLPT N3

Status: draft agreed in conversation with the owner on 2026-11-24; awaiting the owner's approval of this document.

## 1. Intent

Today qinqin is a toolbox: dictionary, reader, flashcards, grammar lessons, stats. A beginner has to decide what to
study and in what order. The owner wants a **course**, like Memrise, Chineasy or Duolingo: a roadmap of small
lessons and word lists that takes a complete beginner to solid intermediate, **≈ HSK 3–4 for Chinese and ≈ JLPT N3
for Japanese**, so that the learner is "decently proficient before being left to their own devices" with the
dictionary, reader and decks.

The course is a guide through features qinqin already has or plans: Starter mode's base set (#214), pictures
(#216), the grammar lessons (shipped), hanzi and kanji lists, the writing-system trainer (#204), listening and
speaking (#135, #136, #213), reading. It doesn't replace them; it orders them.

## 2. Goals, non-goals, anti-goals

Goals
- One course per study language, Chinese and Japanese first, with a skeleton that other languages (#201) can
  adapt later.
- A roadmap of **hundreds of small lessons**, grouped into units and sections, with **milestones at every level**:
  each lesson, each unit, each section.
- The course's vocabulary reaches the target levels: about 2,000 words for Chinese (the bundled HSK list, 2025
  edition, levels 1–4: 300 + 198 + 497 + 997 = 1,992); about 3,700 for Japanese (estimated N5–N3, see §6).
- Course words join the learner's normal spaced-repetition study, so they are kept, not just met once.
- Works offline and on Android (the shell, #200) like the rest of the app.

Non-goals
- Beyond ≈ HSK 4 / ≈ N3: the learner continues freely with decks, level sessions, the reader and grammar lessons.
- An authoring UI for courses. Content is authored as data in the repository.
- Social features, leagues, paid hearts or energy systems.

Anti-goals
- A sorted word list pretending to be a course (approach B, see §4).
- Copying a published course's or syllabus's order or texts. The selection and order are our own (licence rule;
  the HSK pack notices promise word and character lists only).
- Pressure mechanics that punish the learner (losing progress, lives). Milestones reward; nothing takes away.

## 3. Constraints

- Licence first: only data under CC BY-SA 4.0 or more permissive, with notices. Course texts written for the
  project are released openly (licence chosen by the owner).
- Shared rules for web and Android go into `docs/contracts/` with fixtures, as everywhere else.
- Builds on the architecture work in #190: core features with typed storage (no code plugins, #199), language
  profiles (#199), one pack system (#192).
- Progress must sync across devices and survive backups, like study data.

## 4. Approaches considered

- **A: fully hand-written.** Every unit designed by hand. Best quality, but a huge writing and native-review job
  for hundreds of lessons per language.
- **B: assembled automatically** from level lists, frequency and grammar lessons. Scales for free, but feels like a
  sorted list.
- **C: hand-written skeleton, filled automatically (chosen).** The structure is designed by hand: section order,
  unit themes, which grammar lesson goes where, which hanzi or kanji each unit introduces, script milestones, a
  short reading text per unit. The vocabulary of each unit is filled from the level lists by topic and frequency.
  The skeleton is tens of units; the generated lessons can be hundreds.

The owner picked C. Hundreds of lessons are fine as long as milestones mark everything in between.

## 5. Structure

**Course → sections → units → lessons.**

- **Sections** follow the levels: ≈ HSK 1, 2, 3, 4 (Chinese); ≈ N5, N4, N3 (Japanese). Section 0 is the start:
  sounds, the first script steps and Starter mode's base set (#214).
- **Units** (roughly 10–20 per section) each have:
  - a theme (food, family, travel, work…);
  - one or two grammar lessons from the shipped grammar packs;
  - the hanzi or kanji it introduces (from the level lists);
  - a short reading text written for the project;
  - optionally a listening or speaking focus.
- **Lessons** are small, a few minutes each. Types:
  - **New words:** 5–7 words of the unit, introduced as cards (Starter-mode stages and pictures where they apply),
    with audio.
  - **Script:** kana or hanzi steps (writing-system trainer #204, the writing card, components).
  - **Grammar:** one shipped grammar lesson (explanation plus its exercises).
  - **Practice:** a mixed round over the unit so far, all card kinds the language has, plus listening (#135) and
    speaking (#136, #213) where available.
  - **Reading:** the unit's text in the reader, with readings shown for words the learner hasn't reached yet.
  - **Checkpoints:** a short check closing each lesson; a **unit test** closing each unit; a **section exam**
    closing each section (built on the level check, #82).
- **Scale:** at about six words per lesson, roughly 330 word lessons for Chinese and 600 for Japanese, plus
  grammar, script, practice and reading lessons. Several hundred lessons per language, which the owner accepts.

## 6. Levels and vocabulary

- **Chinese:** the bundled HSK word and character lists (2025 edition), levels 1–4. Note: that list carries no
  reuse licence; it was included at the owner's decision (see its manifest). How the course pack refers to it is
  in §9.
- **Japanese:** no official JLPT vocabulary list exists since 2010, so build an **estimated JLPT word list** the way
  the JLPT kanji estimate was built (`docs/superpowers/plans/2026-11-14-jlpt-approx.md`):
  - **base list:** Jonathan Waller's JLPT vocabulary lists (tanos.co.uk), which reuse projects state are **CC BY**.
    The site seems to be offline: confirm the licence from an archive or a reuse repository that kept it. If it
    can't be confirmed, skip the base list;
  - **gap fill and fallback:** a level from the highest estimated JLPT level of the word's kanji, combined with the
    Jiten frequency rank (bundled), with thresholds calibrated against the base list where it exists;
  - labelled "≈ N5" and so on, approximate, like the kanji. It becomes a `levels` pack (`jlpt-words`) usable
    everywhere, not only in the course.
- **Topic labels** for filling units by theme: OpenMoji categories via the picture mapping (#216), plus labels
  suggested by an agent and reviewed by the owner. Stored as data (a labels file or pack), versioned and reviewable.

## 7. Progress and rules

- **Locked path with tests to skip ahead (owner's choice).** Each lesson unlocks the next. A learner can take a unit
  test or section exam early; passing it unlocks everything before it. The placement test (#74) can place a
  learner straight into a section.
- **Course words join normal study.** Every word a lesson introduces gets a card in a "Course" system deck, so
  daily reviews keep it alive. Lessons add new material; reviews do the remembering.
- **Daily limits (call made during design):** the course is never blocked. Words a lesson introduces don't use
  the decks' daily new-card limit; the lesson pace is the limit. "Continue course" can never be a dead end.
  Reviews of course cards count like any review.
- **Skipped content (call made during design):** words of units a learner tests out of, or skips through
  placement, are marked **known** (the known-word marks), not created as new cards, so no backlog of hundreds of
  new cards appears. The learner can add them as cards later from the roadmap. They count towards word-count
  milestones as known words.
- **Content changes (call made during design):** progress is kept per unit, with stable, authored unit ids and
  lesson ids derived within a unit. Finished units stay finished and words already met stay the learner's cards.
  Words a content update adds to a finished unit appear as a short catch-up lesson. Units added before the
  learner's position are unlocked.
- **Progress is recorded as events** (append-only, like reviews): lesson started or finished with its result, test
  passed or failed. The path state (what's unlocked, what's done) is derived from them. A contract with fixtures
  defines the events and the derivation, so web and Android agree, and sync and backups just work.
- **Milestones:** the existing milestone system (shown once, then in a history list) gets course milestones: first
  lesson, each unit, each section, script milestones ("all hiragana"), word counts. Goals and the heatmap count
  course activity. The weekly summary shows course progress.

## 8. Screens

- **Course roadmap:** a path view of sections and units, the current lesson highlighted, done and locked states,
  milestones along the way, "Take the unit test" on locked units. Phone first (bottom bar entry, #188).
- **Lesson player:** a full-screen flow like the study session (progress line, docked actions, no bottom bar). It
  hosts the existing card kinds, grammar lesson views, the reader and script trainer, and ends with a short
  summary.
- **Home:** a "Continue course" widget, the next lesson one tap away.
- **Workspace creation:** "I'm new to this language" offers the course (with Starter mode); "I know some already"
  offers the placement test.

## 9. Content and authoring

- **A `course` pack type** (via #192) per language: the skeleton (sections, units, themes, grammar lesson ids,
  hanzi or kanji ids, reading texts, checkpoint rules) plus the generated unit vocabulary, written to files by a
  deterministic generator so changes show up as diffs.
- **The generator** fills units from the level lists by topic labels and frequency, keeps each level's words inside
  its section, balances lesson sizes, and reports words it couldn't place.
- **Skeletons and reading texts** are drafted by an agent and reviewed by the owner. Native-speaker review of the
  texts happens during the owner's own use, as for the grammar lessons.
- **Other languages (#201)** get their own skeleton later; the format and generator are language-neutral.

## 10. Dependencies and order

- **Built after its dependencies (call made during design),** not against today's plugin architecture: #199
  (core features, language profiles) and #214, #215, #216 come first; #192 (pack system) is done.
- Needs: #199 (core features, language profiles), #192 (pack system), #214 (Starter mode), #216 (pictures),
  #215 (card hints); uses #204, #135, #136, #213, #82, #74 where they exist, and works without the optional ones.
- Suggested build order: (1) the estimated JLPT word list and topic labels; (2) the course pack format, generator
  and contracts; (3) roadmap, lesson player and progress; (4) Chinese and Japanese skeletons and texts;
  (5) unit tests and section exams; (6) milestones and home integration.

## 11. Left to the builder

Exact lesson sizes, the roadmap's visual design (following the visual rework rules), checkpoint pass marks, how
reading texts handle words beyond the learner's progress, the format details of the course pack, and how practice
rounds pick card kinds.
