# Reverse and cloze cards — design (issue #65, v0.3.0 item 3)

Status: Draft (2026-11-15), written unattended. Every non-obvious call is a **Ruling: what — why — cost
if wrong** and can be overruled. Nothing is built. Direction: `docs/superpowers/directions/2026-11-15-v0.3.0-web-build.md`
item 3. Built **before** the decks view (item 3b, `2026-11-15-v030-decks-view-design.md`), which hosts
the per-deck switch this design defines. Depends on the learner's day (item 1, #84, spec
`2026-11-15-v030-study-day-design.md` on `docs/v030-study-day`): this design only uses its
`StudyDay.dayOf(ms) -> "YYYY-MM-DD"` (`lib/time/studyDay.ts`, obtained from `currentStudyDay()` in
`lib/time/zone.ts`) and passes it in as a `dayOf` argument, so it never computes a day itself.

## Intent

Two card kinds on the existing deck/card/review model: **reverse** (meaning → word, words only) and
**cloze** (an example sentence of the entry with the word blanked). Both are **opt-in per deck**:
a deck that never turns them on behaves exactly as today, byte for byte in its queues and numbers.
Siblings (cards of the same entry) are **buried until the learner's next day** once one is answered
when a reverse or cloze card is involved. History stays the append-only event log; ids stay
deterministic so two devices never create two cards for one thing.

## Non-goals

Leech handling (#66), handwriting inside the reverse card (the Writing kind already covers it), a
per-sentence cloze card, cloze in level sessions (level sessions stay vocab-only), a server change.

## Data model (all derived or in existing plugin data)

- `StudyCardKind` gains `'reverse' | 'cloze'`; `CARD_KINDS` = vocab, sentence, writing, tone, reverse,
  cloze (this order everywhere: tables, setup, fixtures). `OPT_IN_KINDS = ['reverse', 'cloze']`.
- Card rows keep their shape `{id, kind, entryId, written?, sentenceId?, deckIds, createdAt}`.
  Reverse and cloze rows never carry `sentenceId`.
- A vocab card row may carry **`skipKinds?: StudyCardKind[]`** (non-vocab kinds the learner removed
  for this word; see Card management). Absent = nothing skipped. `canonicalCards` merges it as a union.
- Per-deck switch: plugin-data key **`deckcfg:<deckId>`** → `{deckId, cardTypes: OptInKind[], updatedAt}`,
  workspace-scoped like `deck:`. Works for `general` (which has no `deck:` row). Absent or unparsable
  = `cardTypes: []`. Writers read-modify-write and **keep unknown fields** (forward compatibility;
  item 4b stores per-deck limits in its own `limits:deck:<deckId>` rows, see its spec).
- Ruling: settings in their own `deckcfg:` row, not inside `deck:<id>` — General has no deck row,
  and the current `parseDeck`/`renameDeck` drop unknown fields, so an older open tab renaming a deck
  would silently switch its card types off — cost if wrong: one extra key per configured deck.

## Card ids (contract)

| Kind | Stored id | Dedupe `cardKey` | Virtual (planned, not yet created) id |
|---|---|---|---|
| reverse | `c-reverse-<entryId>` e.g. `c-reverse-1201` | `reverse:1201` | `companion:reverse:1201` |
| cloze | `c-cloze-<entryId>` e.g. `c-cloze-1201` | `cloze:1201` | `companion:cloze:1201` |

- Both come from the existing `newCardId(kind, entryId)` and `freshCardId` (ULID only if the derived
  id is taken by a card with another `cardKey`, which cannot happen for these kinds in valid data).
- **One cloze card per entry, independent of sentences.** Ruling: the cloze card tests the word in
  context, not one sentence; its id never names a sentence — a pack update that retires, edits or
  adds sentences (sentence ids are stable only while entry + text are unchanged,
  `server/internal/sentences/sentences.go` `writePack`) can never orphan or duplicate it, and two
  devices always agree — cost if wrong: a learner cannot keep two cloze cards for two sentences of
  one word.
- **Which sentence, which blank** (pure, per showing; nothing stored):
  1. *Eligible sentences* = `entry.sentences` in server order (pack sentences first, then the user's
     own; `ForEntry`) whose `hanzi` is non-blank and has at least one blank span (step 2).
  2. *Blank spans* (code-point offsets, half-open) = the segmenter matches (`POST /api/segment`,
     already used by Word Salad) whose `entries[].id` contains the entry id; if none, the
     non-overlapping leftmost occurrences of `entry.written`, then of each `entry.forms[].text`,
     longest first. All spans are blanked; the **first span is the answer slot**, the others show
     the same gap marker so a repeated word does not give itself away.
  3. *Sentence of this showing* = `eligible[n mod eligible.length]`, `n` = the card's number of
     recorded (first-pass) reviews in the log (0 for a new card). Rotation keeps the learner from
     memorising one sentence; every device computes the same sentence from the same log.
  4. *Answer* = the code points of the first span in that sentence (the surface, e.g. 食べました).
- No eligible sentence → the cloze item is ineligible (dropped like any companion, remembered per
  tab by `ineligible.ts`); an existing cloze card whose sentences all vanished is skipped for that
  session, its history untouched.
- Fixtures: `docs/contracts/cards/card-ids.json`, `docs/contracts/cards/cloze.json` (see plan).

## Creation: lazy, like companions

Ruling: reverse and cloze cards are planned as **virtual items** for the vocab cards of decks that
enable them and are created by `gradeItem` on their first grade — turning a type on for a deck of
3,000 words writes nothing, abandoning a session creates nothing, and the existing virtual-item path
(`companions.ts`, `grade.ts`) is reused — cost if wrong: counts of "new" do not include not-yet-created
reverse/cloze cards (the decks view says so).

- `planCompanions` learns the two kinds; a kind is planned for vocab card V only if
  (a) the session includes the kind, (b) some deck in `V.deckIds ∩ session decks` has the kind in
  its `deckcfg` `cardTypes`, (c) `V.skipKinds` does not contain it, (d) the entry is not in this
  tab's ineligible memory, (e) V's entry has **no real item in this session's queue and was not
  answered today** (it would be buried anyway; see Burying), and (f) at most one opt-in virtual item
  per entry and session — **reverse is preferred**; cloze is planned when the word's reverse card
  exists, is skipped, not enabled, or remembered as ineligible (so an unsuitable kind never blocks the
  other for more than one session). Entry kind and sentences are checked when the item is shown.
- Filtering happens **before** the limits are applied: cards that are not allowed (switch off,
  skipped) or buried are removed from the input of `buildQueue` / excluded from `buildLevelQueue`, so
  they never use up a slot. Legacy virtual companions (sentence, writing, tone) of an entry are
  dropped too when that entry's reverse or cloze card was answered today.
- A real reverse/cloze card is queued only if some deck in `card.deckIds ∩ session decks` enables its
  kind and its vocab sibling does not skip it. Turning a type **off** keeps the cards and their
  history; they simply stop being queued and come back if it is turned on again.
- Eligibility when shown (`isEligible`): reverse needs `entry.kind === 'word'` and at least one gloss
  (direction: words only); cloze needs an eligible sentence (above). Both are remembered as
  ineligible per tab like other companions (`rememberDrop` returns true for both, except when the
  drop came from a failed segment request, which the runner marks transient and does not remember).

## Burying (contract)

Rule, with `day = dayOf` (the learner's day, item 1): card C is **buried** at instant `now` iff some *other* live card S
with `S.entryId === C.entryId` has a recorded review R with `day(R.ts) === day(now)`, and
`buries(S.kind, C.kind)` holds, where **`buries(a, b) = a ∈ OPT_IN_KINDS || b ∈ OPT_IN_KINDS`**.

- Ruling: pairs of the four existing kinds never bury each other — today a session may show a word's
  vocab and writing cards together; keeping that makes "existing decks are not changed" literally
  true, and the predicate is one function if the owner wants full Anki burying — cost if wrong: a
  one-line change plus fixture update.
- Buried cards stay due; nothing is rescheduled or written. Burying lifts at the learner's next day.
- Re-shows (`requeue.ts`) record nothing, so they never bury; a pending re-show is never removed by
  burying (it is the same card). An Again on a reverse card re-shows that reverse card as today.
- Reviews of deleted cards do not bury (their entry is unknown without the card).
- Applies in deck **and** level sessions, and to every due count (home widget, setup summary, decks
  view): `due` excludes buried cards. Ruling: counts show what can be studied now — cost if wrong: a
  learner sees fewer due cards than FSRS says until tomorrow.
- Session builder: (1) `buriedNow({cards, reviews, now, dayOf})` → buried card ids and
  `kind:entryId` keys (for virtual items); deck and level sessions exclude those **before** the limits
  are applied; (2) after each **recorded** grade, `buryAfterAnswer(plan, index, answered)` (on the
  queue as returned by `applyGrade`, `index` = the answered position) removes later items that the
  answer buries; a removed virtual item frees its new-card slot and the
  next reserve item takes it (the `dropItem` backfill rule); a removed real card frees nothing.
  The runner announces "1 related card is buried until tomorrow" in its status line.
- Ruling: two real cards of one word that are both due are not pruned at plan time; the second is
  buried when the first is answered — the first one can still turn out ineligible, and dynamic
  removal handles that without a hold list — cost if wrong: the progress total shrinks during a
  session.
- Fixture: `docs/contracts/cards/burying.json` (reviews carry a precomputed `day`, so the fixture does
  not depend on time-zone rules, which item 1 owns).

## Card management (#30) with the new types

- `rowsOfCards` already expands a vocab card to every non-vocab card of its entry, so **deleting or
  moving a word deletes or moves its reverse and cloze cards too**, undoable through `restoreCards`.
- New: **remove one sibling kind of one word** (`dropSiblingCards(ids)`): tombstones the given
  non-vocab cards and adds their kinds to the word's vocab `skipKinds`, so lazy creation does not
  bring them back; undo restores both rows (`restoreCards` without `onlyLive`). A kind whose card does
  not exist yet can be switched off for the word too (`skipKind(entryId, kind)`: only the vocab row is
  written). A stray sibling without a vocab card is simply tombstoned (nothing would recreate it). Turning a kind back on for the word removes it from
  `skipKinds`; the next first grade revives the tombstoned id with its history (same deterministic id,
  like re-adding a word today). Works for all non-vocab kinds, not only the new two.
- Moving a single sibling to another deck is not offered: siblings follow their word.
- Ruling: `skipKinds` lives on the vocab row — no new key type, and it travels with the word through
  moves and merges — cost if wrong: an older open tab that rewrites the vocab row drops the field and
  the kind is planned again.

## Mastery and stats (decided: new kinds never change mastery)

- **Word states** (`lib/stats/wordStates.ts`): vocab cards only — unchanged; reverse/cloze excluded.
- **Character mastery** (`lib/study/mastery.ts` `masteryForChars`: mean FSRS strength of every reviewed
  card whose `written` contains the character): gains a kind filter **`MASTERY_KINDS = vocab, sentence,
  writing, tone`** — reverse and cloze are excluded. Ruling: the existing kinds keep counting exactly
  as today, so enabling cloze on a deck never moves the map, and the two new kinds re-test the same
  word–meaning link (reverse) or the word in a sentence (cloze) that vocab and Word Salad already feed —
  cost if wrong: add them to the list; scores are derived, nothing to migrate.
- Decks-view "studied/mastered" use the vocab card only (decks-view spec), so they are unaffected too.
- They **do** count as reviews: XP (`BASE_XP.reverse = 10`, `BASE_XP.cloze = 15`: same as vocab and
  Word Salad), streaks, the activity heatmap, retention and "reviews in 30 days" in the decks view,
  and the FSRS optimizer's dataset (each is its own card with its own history).
- Older clients: `parseCard` drops unknown kinds (their cards are invisible there), `parseReview`
  reads an unknown mode as vocab (vocab XP). Harmless; noted for the Android contract.

## Exercise UI

**Reverse** (`ReverseCard.svelte`, new, follows `VocabCard`): the front shows the meaning
(first sense group's glosses, up to 3, with its part of speech) — never the written form; a **Show
reading** button (counts as a hint); an optional **Type the word** field (label visible, `lang` = the
workspace language, IME-safe: Enter while composing is ignored). Space/Enter outside the field, or
**Show answer**, reveals the back, which reuses `buildVocabFaces` (written, readings, glosses, audio).
Suggested grade: typed and accepted → Good (Hard if the reading was shown); typed and not accepted →
Again; nothing typed → no suggestion (self-grade, like vocab). Accepted answers (NFC, trimmed,
inner whitespace removed): `written`, every `forms[].text`, every `variants[].written`.

**Cloze** (`ClozeCard.svelte`, new): the sentence with gaps (other spans pre-masked), its translation
always shown as context (issue), its reading hidden until the answer. Two answer modes, by the card's
derived stability (`tierFor` from `wordSalad.ts`): **choose** at tier 0 (new, or stability under 4
days), the answer equals `written` or a form (not inflected) and 3 distractors exist; else
**type**. Choose reuses the grammar plugin's `ClozeChoice.svelte` (moved to `lib/components/`,
grammar imports it from there; it gains an optional parts form of `before`/`after` so every extra gap
renders as a real gap element with its hidden label — plain strings keep working for grammar), with distractors = the `written` snapshots of other vocab cards in
the session's decks, same code-point length preferred, never a string that occurs in the sentence,
shuffled with `shuffleTokens(seed = cardId:reviewCount)`. Type: one field, accepted = the surface,
plus (when the surface is `written` or a form) the other forms and variants. **Show answer** gives up.
Suggested: correct → Good; wrong or gave up → Again; never Easy (house rule). An Again re-show of a
cloze card keeps the sentence and the answer mode of its first showing (stored on the queue item like
the Word Salad `tier`); the rotation only advances with recorded reviews. Segmenting costs one
`POST /api/segment` per candidate sentence (at most the first 8 of an entry), cached per sentence for
the session and prefetched with the next item.

**A11y:** each gap renders a visually hidden "blank" label; right/wrong are text plus colour;
feedback is `role="status"`; `lang` on every target-language string; 44 px targets; the runner's key
hints gain two lines (Reverse: "Space or Enter shows the answer · type to check yourself · 1–4
grade"; Cloze: "1–4 pick a choice or type the word, Enter checks · then 1–4 grade"). The cloze
choice keys call `preventDefault`, which the runner already honours, so one key press never both
picks and grades. Focus moves to the field when a typing card appears.

## Setup and session

- `CARD_TYPES` gains Reverse and Cloze. On the setup page their checkboxes appear only when a
  selected deck enables the kind and start **checked** unless the learner unchecked that kind before
  in this workspace (remembered beside `cardTypesMemory`). Ruling: the deck switch is the opt-in; the
  session checkbox is only a per-session opt-out — cost if wrong: one more click for learners who
  want them off by default.
- `validateConfig` accepts the six kinds. Level sessions stay vocab-only (plus writing for
  character-unit levels, item 1's #57).
- **Effective kinds** (one function, `effectiveKinds`, used by the setup page, the home widget and the
  decks view): the remembered existing kinds (`cardTypesMemory`, opt-in entries in it ignored) plus
  each opt-in kind that a deck in scope enables and the learner has not unchecked in this workspace.

## Testing

Pure modules with unit tests (the fixtures above run in vitest through a small loader); jsdom tests
for `ReverseCard`, `ClozeCard`, the moved `ClozeChoice` and the setup checkboxes; a built-server curl
check that a `deckcfg:` row and a `c-reverse-` card round-trip through plugin data and sync pull.

## Risks

- The segmenter may not link an inflected Japanese form to the entry; the literal fallback then
  finds nothing and the sentence is not eligible (safe, fewer clozes).
  Decision (#288, 2026-11-27): checked. The server's segmenter deinflects (the Japanese code pack's rules and any
  installed lemma pack), so 食べた in a sentence resolves to 食べる and the card blanks 食べた, the surface, as
  `cards/cloze.json` already says. Since #288 whether a word has a cloze sentence is decided by the server when the
  session is planned (`POST /api/study/eligibility`, `cards/eligibility.json`) with the same segmenter and the same
  blank rule, so the counts and the card agree; a test pins 食べた → 食べる (`server/internal/api/handlers_eligibility_test.go`).
- Distractors from small decks: under 3 candidates the card falls back to typing.
- Item 1's `StudyDay` lands first; if its names change before merge, only the injection point changes.
