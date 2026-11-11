# Flashcards Phase — Design

Date: 2026-11-12
Status: Round 1 shipped 2026-11-12; Rounds 2–3 pending — [#24](https://github.com/Elaktrato/qinqin/issues/24), [#25](https://github.com/Elaktrato/qinqin/issues/25). Design agreed in conversation; build order fixed (three rounds).

## Intent

Turn the platform into a study system: Anki-like spaced repetition over dictionary
content, with several exercise types per language, level-driven study, a character
mastery map, a review-driven heatmap, and light gamification. The flashcard feature
is a **web feature plugin**; the mobile client (phase 3 of the main design) later
implements the same contract in Dart. The plugin owns the learning model; the core
backend stays generic.

## Architecture (agreed)

- **Event-sourced scheduling.** The only durable study facts are:
  - card/deck definitions in the workspace-scoped plugin data store
    (`plugin_data`, plugin id `qinqin-flashcards`),
  - `review` events in the append-only study-event log.
  Scheduling (FSRS) is a deterministic function of a card's review history and is
  never stored or synced. Offline reviews on two devices merge by event id; no
  conflict resolution is needed.
- **FSRS via `ts-fsrs`** (MIT, reference JS implementation). Grades are Anki-style:
  Again / Hard / Good / Easy (1–4). Default parameters; no optimizer UI in v1.
- **Plugin surfaces.** The flashcard plugin owns the home widget(s): study status,
  the review-driven heatmap, and (Round 2) the hanzi/kanji map is a plugin view.
  The old generic heatmap widget is retired.
- **Mastery is derived, never stored** (option 1): a character's mastery is an
  aggregate over every reviewed card involving it — word cards, sentence cards,
  writing cards, tone cards. No separate character SRS state; a character with no
  cards is untouched even if its words are mature.
- **EXP/level are derived** from review events (per workspace). Cosmetic only.

## Data model (plugin data, workspace-scoped)

- `deck:<id>` → `{id, name, createdAt}`. The implicit deck id `general` always exists.
- `card:<id>` → `{id, kind, entryId, sentenceId?, deckIds: string[], createdAt}`.
  `kind` ∈ `vocab | sentence | writing | tone` (Round 1 implements `vocab`).
- Review event payload: `{cardId, mode, grade: 1|2|3|4}`. Type `review`.

## Session types (all rounds)

1. **Vocab repetition** (R1): front = word + optional example sentence with the
   word blanked + readings (pinyin/bopomofo/furigana); back = translation plus
   everything from the front.
2. **Word Salad** (R3): one card per example sentence. Progressive tiers:
   T0 tokens jumbled, translation visible → T1 translation behind a reveal-cloze →
   T2 tokens jumbled within words too. Tokenisation: dictionary longest-match for
   zh/ja, per-character fallback, whitespace for alphabetic scripts. Tier rises
   with card progress.
3. **Writing** (R3): Hanzi/Kanji production, Skritter-style stroke checking via
   `hanzi-writer` quiz mode (stroke order + direction, hints after misses).
   Chinese-oriented stroke data; most kanji share it; kana unsupported.
4. **Tone** (R3): swipe the tone for each syllable of a word.

Session setup lets the user choose decks and opt out of card types; queue limits
(new/day, reviews) are configurable.

## Level study (R2)

Level packs (HSK 1–6, JLPT N5–N1, Jōyō, curriculum tables) can start a study
session over their tagged words without a deck. Cards finished in a level session
are added to the general deck. Custom decks remain the explicit path.

## Mastery map (R2)

A grid of Hanzi/Kanji (per workspace language), filterable by level scheme, shaded
by derived mastery. Mastery score per character: aggregate of the FSRS states of
all cards containing it, mapped to Anki-like stages (unknown/fresh/mature/learned)
and a 0–100 score. Exact aggregation formula fixed in the Round 2 design.

## Heatmap (R1)

Review-driven, per workspace, one cell per UTC day (review counts). Lives in the
flashcard plugin's home widget. The generic session/view heatmap is removed.

## EXP and levels (R1 stub, R3 polish)

Derived from reviews: base XP per graded review with a small grade bonus; simple
level curve. Per workspace. Mascot art is out of scope until the owner draws it.

## Rounds (build order)

- **Round 1 — core study loop** (shipped 2026-11-12): plugin scaffold + registration,
  decks (general + custom), `+` add-from-entry, session setup (decks, card-type
  opt-out, limits), vocab repetition cards, 4-grade FSRS scheduling, review-driven
  heatmap home widget, session summary with derived EXP/level. No backend logic
  beyond the plugin-registration change.
- **Round 2 — levels and the map**: level sessions feeding the general deck,
  per-character mastery aggregation, Hanzi/Kanji map grid with filters.
- **Round 3 — remaining exercises and polish**: Word Salad (+ tokenizer), writing
  (stroke quiz), tone swipe, richer EXP/mascot hooks.

## Non-goals

- No server-side scheduler; no authoritative scheduling state.
- No FSRS parameter optimization UI (defaults only).
- No mobile implementation in these rounds (the phase-3 mobile client later).
- No media/audio, no sharing decks between users.
