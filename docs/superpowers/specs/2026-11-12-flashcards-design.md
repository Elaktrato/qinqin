# Flashcards Phase — Design

Date: 2026-11-12
Status: Round 1 shipped 2026-11-12; Round 2 (level sessions and the mastery map) shipped 2026-11-12; Round 3 shipped 2026-11-13 ([#25](https://github.com/Elaktrato/qinqin/issues/25)). Design agreed in conversation; build order fixed (three rounds).

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
session over their tagged words without a deck. Each graded card is added to the
general deck (`deckIds: ['general']`) before its review is recorded; a virtual
word that is never graded is never created, so abandoning a level session leaves
no cards. Words that already have a card reuse it, and an existing card added to
study but never reviewed joins the level's new bucket with its real id, sharing
the new limit with the virtual words. Custom decks remain the explicit path.

## Mastery map (R2)

> Redesigned on 2026-11-13: the map now lists every character of the language, grouped by grade, JLPT, frequency, strokes or an installed scheme, instead of a scheme/level picker. The scoring below is unchanged. See [the character grid plan](../plans/2026-11-13-character-grid.md).

A grid of Hanzi/Kanji (per workspace language), filterable by level scheme and
level, shaded by derived mastery, with a level-progress list of mastered counts.
Mastery is derived, never stored. For a character, each reviewed vocab card whose
written form contains it contributes a per-card strength
`m = clamp(log2(1+S)/log2(1+365), 0, 1)`, where `S` is the card's FSRS stability
in days; a year of stability therefore counts fully. The character's score is
`round(100 × mean(m))` over those cards, and no reviewed cards means score 0.
Stages: `0 unknown`, `1–24 fresh`, `25–49 learning`, `50–79 mature`,
`80–100 learned`. A level's summary counts characters with score ≥ 80 as
mastered.

## Heatmap (R1)

Review-driven, per workspace, one cell per UTC day (review counts). Lives in the
flashcard plugin's home widget. The generic session/view heatmap is removed.

**Moved to core 2026-11-13** (plan:
[core activity heatmap](../plans/2026-11-13-core-activity-heatmap.md)). The heatmap is
now `ActivityHeatmap.svelte` on the home page, between the search and the plugin
widgets; the flashcards widget keeps due/new counts, level, XP, streak and mascot but
no grid. It is multi-source: each cell sums activity points per UTC day over 13 weeks,
per workspace. Sources today:

- `review` — 1 point per review event.
- `read` — the reader posts `{bookId, seconds}` per reading burst (active, visible
  time; idle gaps capped at 2 minutes; bursts under 30 s are not posted), credited to
  the book's workspace (books belong to a workspace; an older server without one falls back to the workspace of the book's language); 1 point per
  started 5 minutes, at most 24 per event. Tooltips show real minutes.

Cell levels keep the widget's absolute thresholds (0, 1, 2-3, 4-6, 7+ points). Other
event types are ignored. To add a source: emit a study event with a new type and add
one entry (type, label, unit, `points`, `raw`, `describe`) to `ACTIVITY_SOURCES` in
`apps/web/src/lib/activity/activity.ts`; the tooltip and the grid's aria-label pick it
up.

## EXP and levels (R1 stub, R3 polish)

Derived from reviews: base XP per graded review with a small grade bonus; simple
level curve. Per workspace. Mascot art is out of scope until the owner draws it.

## Rounds (build order)

- **Round 1 — core study loop** (shipped 2026-11-12): plugin scaffold + registration,
  decks (general + custom), `+` add-from-entry, session setup (decks, card-type
  opt-out, limits), vocab repetition cards, 4-grade FSRS scheduling, review-driven
  heatmap home widget, session summary with derived EXP/level. No backend logic
  beyond the plugin-registration change.
- **Round 2 — levels and the map** (shipped 2026-11-12): level sessions feeding the
  general deck, per-character mastery aggregation, Hanzi/Kanji map grid with
  filters.
- **Round 3 — remaining exercises and polish**: Word Salad (+ tokenizer), writing
  (stroke quiz), tone swipe, richer EXP/mascot hooks.

## Round 3 design decisions (decided 2026-11-13, unattended)

Taken under the rule "avoid licensing issues first, then the best experience for
the learner, even at higher implementation cost". No new data or dependencies are
needed: stroke data and `hanzi-writer` are already bundled, the tokenizer is the
existing lookup-engine-backed `POST /api/segment`, tones come from the tone-marked
pinyin readings already stored.

- **Card kinds** `sentence`, `writing`, `tone` join `vocab`. Every card keeps the
  `{id, kind, entryId, written?, sentenceId?, deckIds, createdAt}` shape; `written`
  is always snapshotted (it is what feeds mastery). Review events carry
  `payload.mode = card.kind` and an optional `meta` object
  `{tier?, mistakes?, hints?, durationMs?}` (the server stores payloads verbatim;
  nothing is validated server-side).
- **Companion cards are created lazily.** Enabling a card type in session setup plans
  *virtual* companion cards for the vocab cards in the chosen decks that lack one of
  that kind (shared new-limit, same pattern as level sessions); a companion is
  created only when it is first graded, so abandoning a session leaves nothing.
  Companions exist in deck sessions only (level sessions stay vocab-only). Deduplication
  is by `(kind, entryId, sentenceId)`.
- **Eligibility** is decided when the card is shown: a word needs a sentence for
  `sentence`; at least one Han character with stroke data for `writing`; a Chinese
  word with a pinyin reading for `tone` (Japanese has no pitch-accent data, so `tone`
  is Chinese-only; kana have no stroke data, so kana-only words get no `writing`
  card). An ineligible companion is skipped silently and never created.
- **Card-type opt-out is real**: the queue honours the selected types (until now the
  list was stored but ignored). A session needs at least one type; `vocab` is no
  longer mandatory.
- **Word Salad** (kind `sentence`, one card per example sentence): tokens come from
  `POST /api/segment` (longest dictionary match), gaps and unmatched runs fall back
  to single characters, alphabetic scripts split on whitespace; trailing punctuation
  stays attached to the previous token. Tier is derived from the card's FSRS
  stability `S` (no stored state): `S < 4` days (or new) → T0 (jumbled tokens,
  translation visible); `S < 21` → T1 (translation hidden behind a reveal-cloze);
  otherwise T2 (jumbled within words as well: tokens are split into characters).
  The learner taps tokens to build the sentence. Suggested grade: right on the first
  check = Good; right after 1–2 wrong checks = Hard; revealed/gave up or more wrong
  checks = Again. The learner can always override with the four grade buttons.
- **Writing** (kind `writing`, one card per word): `hanzi-writer` quiz mode, one
  character at a time in order, stroke order and direction enforced, a hint after
  3 misses (`showHintAfterMisses: 3`), a reveal button counts as a failed
  character. Suggested grade from totals: no mistakes and no reveal = Good; mistakes
  ≤ 25 % of strokes = Hard; otherwise (or any reveal) = Again.
- **Tone** (kind `tone`, Chinese words): for each syllable the learner swipes the
  tone (up = 1, up-right = 2, down then up = 3, down-right = 4, tap = neutral) or
  presses 1–5; checked against the entry's pinyin readings (any listed reading with
  the same syllable count counts, so polyphones like 行 are not marked wrong).
  Suggested grade: all right = Good; one wrong = Hard; more = Again.
- **Suggested grades are suggestions**: the card shows them preselected and the
  learner confirms or overrides (keys 1–4). Easy is never suggested automatically.
- **Mastery** now counts every reviewed card kind through its `written` snapshot
  (sentence cards count for the characters of the target word they were created
  for), with the existing per-card strength formula.
- **EXP polish**: base XP by kind (`vocab` 10, `sentence` 15, `writing` 20, `tone` 8)
  plus the existing grade bonus (`+0/+0/+5/+10`) plus +10 for the first review of each
  UTC day; still derived from the event log per workspace. Level curve: the XP to
  go from level `L` to `L+1` is `100·L`. A review streak (consecutive UTC days with a
  review) is derived and shown in the widget and the session summary.
- **Mascot hooks only**: a pure `mascotState` (stage 1–4 from level, mood from
  streak/today) and a placeholder component that renders a neutral glyph or an image
  from `static/mascot/<stage>-<mood>.svg` when the owner supplies one (art out of
  scope; nothing to license).
- **Heatmap** stays in the flashcards widget in this round; moving it into core is a
  separate follow-up (it will aggregate reading sessions and other plugins' activity).
  Done 2026-11-13, see the Heatmap section.

### Implementation notes (Round 3 as shipped)

Where the build differs from or refines the decisions above, and the known limits:

- **One sentence card per word.** Planning dedupes companions by `kind:entryId`, and
  grading uses the word's first sentence that has no card yet, so a deck does not
  fill up with one card per example sentence. This replaces "one card per example
  sentence" above; lifting it is a later round.
- **Tone is Chinese only, with no pitch accent.** The Tone type is hidden in non-Chinese
  workspaces (a saved selection stays stored but never reaches the queue). Japanese
  pitch accent is not modelled: there is no pitch data.
- **Swipe directions as built.** A swipe draws the tone's shape. A swipe within 25
  degrees of horizontal, either way, is flat: tone 1. Rising (up-right, up, up-left) is
  tone 2. A path that goes down at least 24 px and comes back up at least 24 px is
  tone 3. Falling (down-right, down, down-left) is tone 4. A move shorter than 24 px is
  a tap, which means the neutral tone. Keys 1–5 work too. Any listed reading with the
  same syllable count is accepted. After a swipe the recognised contour draws in over
  120 ms (instantly under reduced motion). Pads show the word's Han characters when
  every character is Han and the count equals the syllable count (`tonePadLabels`);
  erhua such as 花儿 and mixed scripts fall back to toneless pinyin. With characters
  shown, aria-labels never name the pinyin ("Syllable 2: no tone yet").
- **Writing needs Han characters and bundled stroke data.** Only characters with a
  file in `static/hanzi/` are drawn. Kana stay visible as context, and a word with no
  drawable character is skipped silently. The pad is our own (`WritingPad`, see the
  writing-feel design), no longer hanzi-writer's quiz: a pure matcher judges shape
  and direction with wide position and size tolerance, one motion may cover up to
  three flowing strokes (了), an accepted stroke snaps onto the reference outline in
  about 140 ms and a rejected one flashes red and fades. Order is still enforced; a
  reversed stroke is a miss. After 3 misses on one stroke it glows with its start
  marked and the outline stays for that character (one auto hint per character).
  **Hint** shows the next stroke (one hint per press); **Reveal character** fades the
  remaining outlines in 150 ms apart (instant under reduced motion) and counts as a
  failed character. Only the primary pointer draws, so a palm or second finger is
  ignored; a new stroke may start while the previous snap still animates.
  `hanzi-writer` remains only for the entry page's stroke-order player.
- **Companions exist in deck sessions only.** Level sessions stay vocab-only, and setup
  blocks a level session that has no Vocab selected.
- **Eligibility is decided when a card is shown.** The progress counter ("1 / N")
  counts planned companions that may still be dropped (no sentence, no stroke data,
  no pinyin). A dropped companion is replaced from a reserve when one is left, at most
  `max(30, 2 × new limit)` times per session, so a deck of mostly unsuitable words
  cannot make a session fetch every entry. A smaller new-card limit therefore cannot
  be used up by the oldest ineligible words.
- **Unsuitable words are remembered per tab.** A companion found ineligible for a
  definite reason (the word has no sentence, no Han character, or no clean pinyin
  reading) is remembered per workspace in sessionStorage as `kind:entryId`, and later
  sessions and the setup counts in that tab skip it. Missing stroke data and failed
  loads are not remembered, since they may be transient. A new tab checks again.
- **Cards added before snapshots** (Round 1 vocab cards without `written`) get
  companions too; the entry's written form is used when shown and snapshotted when
  the companion is created.
- **A retired sentence does not orphan its card.** When a sentence card's stored
  sentence is gone (deleted, or retired by a pack update), the card shows the word's
  first sentence instead. Nothing is written; reviews stay on the same card.
- **The translation reveal counts as a hint** (`meta.hints`). It does not change the
  Word Salad suggestion, which depends only on wrong checks and giving up.
- **Mascot art is not bundled.** The placeholder probes `/mascot/<stage>-<mood>.svg`
  with HEAD and accepts only an `image/*` response, so the SPA fallback's HTML is not
  mistaken for art.
- **Heatmap** moved into core on 2026-11-13 (see the Heatmap section); the streak is
  still flashcards-only.
- **Setup persistence.** Card-type, deck and limit choices are saved per tab
  (sessionStorage) when a session starts. Changes made without pressing Start are not
  kept across a reload. The card types last started are also remembered per workspace
  in localStorage and preselected in a tab without its own setup, so opted-in types do
  not reset to vocab in a new tab. The home widget counts due and new cards of the
  same types (this tab's setup, else the remembered types, else vocab); it does not
  count companions that are not created yet.

## Non-goals

- No server-side scheduler; no authoritative scheduling state.
- No FSRS parameter optimization UI in v1 (defaults only); it is designed separately in `docs/superpowers/specs/2026-11-15-fsrs-optimizer-design.md`.
- No mobile implementation in these rounds (the phase-3 mobile client later).
- No media/audio, no sharing decks between users.
