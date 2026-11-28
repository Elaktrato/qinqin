# The conjugation trainer: a Japanese drill for verbs and adjectives (#178, 2026-11-28)

Milestone v0.9.0, phase 5 (plan §3 "Drills framework", §4). The first Japanese drill on the drills framework
(`docs/superpowers/plans/2026-11-28-drills-framework.md`, `docs/contracts/drills/`). Branch
`feature/v090-178-conjugation` from `feature/v0.9.0` (3834cc8f, ContractVersion 28).

## What (issue and owner decisions)

- **A drill** (`conjugation`) in the Practice area: an item is **word × form family**, with its own FSRS schedule
  replayed from its `drill.conjugation` events, outside the flashcard queue; it joins "Practise weakest" and counts
  in the heatmap, the weekly summary, goals, EXP and the streak (the framework does all of that once registered).
- **Two directions:** produce the form ("食べる → polite past: ＿＿", typed through the IME, with a multiple-choice
  fallback) and recognise it ("食べられなかった → which form?").
- **Words** come from the learner's decks: Japanese vocabulary cards, verbs and adjectives only, by JMdict's parts
  of speech (v5*, v1, vk, vs-i, vs-s, adj-i, adj-ix, adj-na; the irregulars 来る, する, 行く, ある, 問う and the
  honorific v5aru verbs).
- **Learners choose the form families** they practise.
- **One rules table, shared:** the conjugation engine and the reader's lemmatizer (#165) understand the same forms;
  the engine's fixtures are checked against the lemmatizer's table.
- **Phone first:** 360 px, no sideways scroll, hidden romaji respected, the Android WebView keyboard kept up between
  items and IME composition handled (Enter while composing never submits).
- **Content review:** the generated forms are reviewed by two Japanese teacher agents; findings applied, notes below.

## The design

### The engine (server, `internal/conjugation`; contract `docs/contracts/conjugation/`)

- **Class** of an entry: the first part-of-speech tag, sense by sense in order, that is one of the engine's classes
  (`v1`, `v1-s`, `v5u`, `v5u-s`, `v5k`, `v5k-s`, `v5g`, `v5s`, `v5t`, `v5n`, `v5b`, `v5m`, `v5r`, `v5r-i`, `v5aru`,
  `vk`, `vs-i`, `vs-s`, `adj-i`, `adj-ix`, `adj-na`). No such tag: not eligible.
- **Forms** (`classes.json`, `forms.json`): per class, the dictionary ending and per form the suffixes that replace
  it (first one canonical, the others accepted). A form is computed on the written form and on the kana reading;
  for the two-kana endings of 来る and いい a written form with a kanji (来る, 良い) keeps the kanji.
- **Form families** (`families.json`): `polite` (polite, polite negative, polite past, polite past negative),
  `negative`, `past` (past, past negative), `te-form`, `potential`, `volitional` (plain and polite), `conditional`
  (ば, たら), `passive`, `causative`. Defaults on: the first six; off: the last three.
- **Item key** `<entryId>:<family>` (`1234:te-form`), as the drills README planned.

### The route

`POST /api/drills/conjugation/words {"ids": [...]}` (1 to 500 entry ids): for each eligible entry its class, written
form, kana reading, readings (romaji included, for the romanisation switch), the families it has and every form
with its accepted answers and their romaji. The caller's own entry patch applies as for `POST /api/entries/bases`.

### The web drill (`lib/features/practice/conjugation/`)

- Candidates: the workspace's Japanese vocabulary cards that have a review, in the order of their first review,
  through the route; then word × enabled family.
- A question picks the form inside the family by the item's answer count (it rotates) and the direction by its
  history (recognise first and after an Again, then produce).
- Produce: a text field (IME composition aware), Check; "Show choices" swaps the field for four choices. Right
  typed = Good, right from the choices = Hard, wrong = Again. Recognise: four form names; right = Good.
- Settings → Study → Conjugation (Japanese workspaces): one switch per family, the workspace-settings key
  `conjugation: {families: {<family>: boolean}}`, merge patch per switch.

## Tasks

1. This plan.
2. Contract and engine (Go, test first): `docs/contracts/conjugation/` (README, `families.json`, `classes.json`,
   `forms.json`), `internal/conjugation` (Classify, Conjugate, Families), the lemmatizer round trip.
3. Content review of the generated forms by two Japanese teacher agents; findings applied (fixtures and engine).
4. Server: the route, the registry (`drills.IDs`, contract `registry`, `events/activity.json`), ContractVersion 29.
5. Web core: the settings key (`lib/exercises/conjugationSettings.ts`), the registry `DRILL_IDS`, activity words.
6. Web drill: the words client, the items, the answer check, the question component, the drill definition, Settings
   → Study → Conjugation; DOM tests first.
7. e2e: a spec with a small JMdict pack seeded on its own server: a round at 360 px through typed and chosen
   answers, the events on the server, the paths in `phone-width.spec.ts`.
8. Docs: contracts README index and CHANGELOG, settings README row, drills README, wiki, `docs/releases/NEXT.md`.

## Rulings

(Filled in while building; each `Ruling: <what> — <why> — <cost if wrong>`.)

## Content review (teacher agents)

(Filled in after the review.)

## Execution record

(Filled in at the end.)

## Local follow-up

(Filled in at the end.)
