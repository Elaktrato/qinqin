# Flashcards: study sessions

Flashcards are part of the app (you can switch them off for yourself in [Settings → Features](Settings-tour#features)). To add a word, open any word or character entry and press **Add to deck**; the card joins the General deck and keeps the entry's first example sentence for context (**Choose a deck** picks another deck). Words also come in from the Reader popup, the Reader's Words tab, the lookup history, and the starter and level decks on the [Decks page](Flashcards-decks-limits-vacation).

## Starting a session

A session starts from **Study** on a deck of the Decks page, from the flashcards widget on the home page, or from the study setup (`/study`).

The setup opens with **This session** and **Limits** at the top: what the session will hold ("Today: 18 reviews and 5 new"), the limits for new cards and reviews (a session stops after these counts, reviews first), the **Order of new cards**, **Start studying** and **Study all**. **Study all** ignores the limits and each deck's daily limit for that one session, so every due review and new card is included. The line **Scheduling: …** opens the [scheduling page](Scheduling-and-FSRS).

Below that:

- **Session source**: **My decks** (choose the decks to draw from) or **By level** (see below).
- **Card types**: pick at least one. A session queues only the types you selected, so a Tone-only session never shows a vocab card, and a type with nothing to study says so ("Tone: nothing to study in the selected decks right now"). Your last choice is preselected in new tabs of the same workspace, and the home widget counts the same types.
- **Advanced settings → Per-deck card types**: the Reverse and Cloze switches of a single deck.
- **Decks**: **Create deck**, **Rename** and delete your decks (a deleted deck's cards stay in your other decks, or move to General).
- **Manage cards**: every card of the workspace, filtered by deck, to **Move** or **Delete** several at once. Deleting a word removes it from every deck with its sentence, writing and tone cards; moving puts it and those cards in the chosen deck only. A ten-second **Undo** follows both.

### Order of new cards

The order decides which new cards come first; reviews always come first and in due order, and the daily limits are unchanged. The default is **Random**: the new cards (and, in a level session, the words or characters of the level) are shuffled, so you do not meet them in dictionary or list order. The shuffle is fixed when you press Start: reloading the same session shows the same order. Levels themselves stay in sequence, since a level session studies one level. Other choices: in a deck session "As each deck is set" (each deck's own setting, deck Settings, New cards), "In the order added", "Most frequent first (<list name>)" or "By level: <scheme>"; in a level session **Level order** or, for a word scheme, **Most frequent first** (word frequency does not rank kanji). When the selected decks use different orders and you chose "As each deck is set", the session uses the order added and says so. The frequency choice appears only when a frequency list of the workspace language is installed. The ranks need the server: offline, or when the request fails, the session keeps the order added and shows "Frequency order needs a connection; using the order added". A deck's own setting is unchanged: its default is still the order added.

### Level sessions

Choose **By level**, pick an installed scheme (HSK, JLPT, Jōyō grades, a curriculum pack) and one of its levels; each level shows how far you are ("HSK 2 — 3 of 80 learned", by the same rule as Stats → Characters). A word that already has a card reuses it; the rest get a card in the General deck when you first grade them, so abandoning a level session creates nothing.

- **Word levels** study vocab cards only; the other card types apply to deck sessions.
- **Character levels** (JLPT kanji, Jōyō grades, 通用规范汉字表) have two cards per character: **Vocab** (recognition: the glyph alone, then its readings and meanings) and **Writing** (the readings and meanings, then write the glyph). A character's writing card joins a session only from the learner day after its recognition card was first reviewed; a writing-only session has no such wait. Characters without stroke data or meanings get no writing card. The new-card limit counts cards, not characters.

## Card types

| Type | What you do | Needs |
|---|---|---|
| Vocab | See the word; press **Show answer** for its reading (with play), meanings and the example sentence with the word blanked | any word |
| Word Salad | Rebuild the example sentence from shuffled tiles: tap a tile to place it, tap a placed tile to remove it, **Undo**, then **Check** (or **Show answer**) | an example sentence |
| Writing | Draw each Han character stroke by stroke (order and direction are checked); **Show strokes** reveals the current character; kana stay visible | Han characters with stroke data from the installed strokes pack |
| Tone | Swipe the tone's shape on each syllable pad, use the tone buttons, or press 1 to 5 | a Chinese word with pinyin (Chinese workspaces only) |
| Reverse | See the meaning, recall the word; optional **Show reading** hint and typing, then **Show answer** | a word (not a character) with a meaning |
| Cloze | Fill the gap in an example sentence of the word (choose at first, type once learned); the translation is shown, the reading after the answer | a word with an example sentence that contains it |

- **Word Salad** gets harder as a card settles: new or short-memory cards (stability under 4 days) show word tiles with the translation; middle cards (under 21 days) hide the translation behind **Show translation**, which counts as a hint; long-memory cards (21 days or more) split every word into single characters. The tier is named on the card. If the sentence cannot be cut into words, each character becomes a tile.
- **Writing** shows the character's outline as a hint after 3 misses on one stroke; each new character starts again without it.
- **Tone** swipes: up = 1; up-right or right = 2; down then back up = 3; down-right, down, down-left or left = 4; a tap = neutral (5). A character with several readings accepts any of them (行 can be háng or xíng).

### Companion cards

Sentence (Word Salad), writing and tone cards are **companions** of the vocab cards in the chosen decks. They share the new-card limit and each one is created only when you grade it for the first time, so abandoning a session creates nothing. A word that does not qualify (no sentence, no drawable character, no pinyin) is skipped silently and the next planned companion takes its place (at most `max(30, 2 × new-card limit)` times per session); the tab remembers such words and skips them in later sessions. A word gets at most one sentence card, built from its first example sentence (if that sentence later disappears, its first sentence is used instead). Companions are planned in deck sessions only.

### Reverse and cloze cards

They appear once in the setup's **Card types** list. Checking one enables it on every deck at once; **Advanced settings → Per-deck card types** has the switches for a single deck. A deck with neither enabled behaves as before. They are created the first time you grade them, at most one reverse or cloze card per word and session (reverse first). After you answer a reverse or cloze card of a word, the word's other cards are buried until your next learner day, and the other way round ("2 related cards are buried until tomorrow"): they stay due but are left out of the queue and counts. Vocab, sentence, writing and tone cards do not bury each other. Reverse and cloze reviews give XP and count for streaks and the heatmap but not for character mastery.

## The session screen

A session is an open page, not a card in a box. At the top: a close button (back to the study setup), a thin progress line and the count ("4 / 20", with "3 to repeat" when cards come back). Every card type then has the same four parts in the same places: the **task name** in the accent colour (with the deck and level on the right, and small labels such as the Word Salad tier, "Again, look 2 of 3" on a re-show, or "new"), the **prompt**, the **answer area** (nothing, an underlined field, choices, word tiles, the writing pad or the tone pads) and, below a thin line, the **answer** (reading and play button, meanings and source, your note). The card types are not colour-coded.

The session names each exercise by what you do; settings, decks and the XP breakdown keep the card type names:

| On the card | Card type |
|---|---|
| Recognise | Vocab |
| Recall | Reverse |
| Fill the gap | Cloze |
| Build the sentence | Word Salad |
| Write | Writing |
| Tones | Tone |

The actions sit at the bottom of the screen. Before the answer there is one button: **Show answer** (Recognise; Recall while the field is empty; Fill the gap when choosing, where picking a choice is the answer), **Check** (Recall once something is typed, Fill the gap when typing, Build the sentence, Tones) or **Show strokes** (Write; only once the character's stroke data has loaded). After the answer the four grade buttons take its place. **End session** stops early; what you graded is kept.

### Keys

| Card | Keys |
|---|---|
| Recognise | Space or Enter shows the answer, then 1 to 4 grade; P plays the word after the answer |
| Recall | type the word and press Enter to check; Space or Enter outside the field shows the answer; 1 to 4 grade |
| Fill the gap | 1 to 4 pick a choice, or type the word and press Enter; then 1 to 4 grade |
| Build the sentence | tap the tiles in order (or Tab and Enter), then **Check**; 1 to 4 grade once checked |
| Write | draw with mouse, pen or touch; 1 to 4 grade once every character is done |
| Tones | 1 to 5 set the highlighted syllable's tone (5 is neutral), ← and → move, Backspace clears, Enter checks; then 1 to 4 grade |

## Your notes on the answer side

When a card's answer is shown, your note on the word (see [Searching and entries](Searching-and-entries#your-note)) appears below the card, for every card type, level sessions included. It never shows before the answer, since a mnemonic often gives it away. Notes are loaded once when a session starts, so a note edited meanwhile in another tab appears in the next session; an offline session shows none, and a session never waits for them. Turn them off per workspace in Settings → Study: **Show my notes on the answer side**.

## Grading

Grade each card **Again**, **Hard**, **Good** or **Easy** (keys 1 to 4). Under each grade its button shows when the card would come back with it (`<1m`, `6m`, `10m`, `1d`, `4d`, `2 mths`, `1.4y`): the same scheduler computes it from the card's history, so the label is the schedule the grade gives. Screen readers hear it in full ("Good, next review in 10 minutes, key 3"), and after a grade a short message confirms it ("Good. Next review in 10 minutes."); focus then moves to the next card's name. A re-show of a card you already graded in this session is practice: its buttons say **practice** instead of an interval, and nothing is recorded.

After a check the exercise suggests a grade: the suggested button gets a faint wash and a full-strength line, is focused and is named "(suggested)"; it never submits one, and never suggests Easy.

| Type | Good | Hard | Again |
|---|---|---|---|
| Word Salad | right on the first check | right after 1 to 2 wrong checks | 3 or more wrong checks, or Show answer |
| Writing | no mistakes | mistakes on at most 25 % of the strokes | more mistakes, or a revealed character |
| Tone | all tones right | one tone wrong | two or more wrong |

## The end of a session

**Session complete** shows the reviews you made (and re-shows, which are practice and not counted), the XP this session by card type and the daily bonus, the progress to your next level and your streak.

## Scheduling, XP and streaks

Each grade is written to your study history; the next due date is derived from the card's whole review history with FSRS (see [Scheduling and the FSRS optimizer](Scheduling-and-FSRS)). Nothing schedule-shaped is stored, so two devices merge cleanly.

XP, level and streak are derived from the history per workspace:

- base XP per review: Vocab 10, Word Salad 15, Writing 20, Tone 8 (Reverse and Cloze count too);
- a grade bonus: Good +5, Easy +10, Again and Hard nothing;
- a daily bonus of +10 for each learner day with at least one review.

Level L to L+1 costs 100 × L XP, so level 2 starts at 100 XP, level 3 at 300 and level 4 at 600. The streak counts the learner days in a row with a review (vacation days neither extend nor break it). All days are your days in your time zone ([Settings tour](Settings-tour#study)).

A study-buddy mascot appears in the flashcards widget and the session summary: it grows at levels 5, 10 and 20, and its mood (sleepy, happy, cheering, proud) follows your streak. Its drawings are placeholders for now.

## For client implementers

Card kinds, review parsing, XP and levels, burying and the session plan are specified in `docs/contracts/cards/`, `docs/contracts/study/` and `docs/contracts/scheduler/`. A new card has a deterministic id, `c-<kind>-<entryId>` (for example `c-vocab-42`), so two devices that add the same word offline write the same row. Older cards with random ids can exist twice; every page reads cards through one loader that merges such duplicates at read time (the earliest card survives, the others' reviews and decks join it), without rewriting anything stored.

## Related

[Decks, limits and vacation](Flashcards-decks-limits-vacation), [Stats and heatmap](Stats-and-heatmap), [Install as an app and study offline](Install-and-offline).
