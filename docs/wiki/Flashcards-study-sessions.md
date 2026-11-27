# Flashcards: study sessions

Flashcards are part of the app (you can switch them off for yourself in [Settings → Features](Settings-tour#features)). To add a word, open any word or character entry and press **Add to deck**; the card joins the General deck and keeps the entry's first example sentence for context (**Choose a deck** picks another deck). Words also come in from the Reader popup, the Reader's Words tab, the lookup history, and the starter and level decks on the [Decks page](Flashcards-decks-limits-vacation).

## Starting a session

**Study** on the home page's flashcards widget and above your decks on the Decks page opens the **study modal** (a bottom sheet on a phone; Escape, the close button or the Android back button closes it). It holds:

- one line with what is waiting: "12 due · 8 new · 4 decks", or for a level "HSK 2 · 12 due · 8 new";
- **This session: 20 cards**, exactly the cards **Start studying** will plan under your limits, and the session's count starts there: before it counts, the server tells the app which of your words can make a Word Salad or Cloze card (an example sentence), a Writing card (a character with stroke order), a Tone card (a clean pinyin reading) or a Reverse card (a gloss), so no card is promised that the session would then drop; or why nothing can start, such as "Nothing is due and no new cards are left in the selected decks", with Start disabled; on a vacation day the vacation line and a link to change it instead;
- the **card types** as chips: only the types your workspace language has (Spanish has no Writing or Tone), Reverse and Cloze only when one of your decks switches them on, and only the types that have something to study now in the chosen decks or level, due or new. A type without cards is left out, with one short line saying why ("Word Salad and Cloze: no example sentences for these words yet."; an administrator is also told that example sentences are installed with `qinqin seed`); your choice of it is kept and the chip comes back once it has cards. At least one visible chip stays selected. A change is saved at once (only what you changed, so a change made on another device meanwhile stays); right after signing in on a new device the chips wait until your saved setup has arrived;
- **Start studying** and **Study all**. **Study all** ignores the limits and every daily limit (your own and the default 20 new and 200 reviews per deck) for that one session, in deck and level sessions alike, so every due review and new card is included; it is enabled when that session would hold something;
- **Advanced settings →**, the full setup.

The setup is saved for the workspace on your account, so it is the same on every device and in the Android app, and it is used by every later session. Until you narrow it, every deck of the workspace is studied, new decks included. When something it names is gone (a deck deleted, a level pack removed, a card type the language does not have), the modal falls back for that part alone and says so in one line ("Your level is no longer installed; studying your decks instead"); nothing is changed until you change something. A change made offline is kept on the device ("Not saved yet") and saved when the server can be reached; one the server refuses is dropped and the line says why. Signing out removes such an unsaved change from the device.

**Study** on a single deck, on a deck's page or on a level studies just that deck or level with your limits; it never changes the saved setup.

### Advanced settings

**Advanced settings** (`/study/advanced`) has every control; each change is saved at once, and **Back to study** returns to the page you came from with the modal open. A direct visit to `/study` opens the modal over the home page.

- **This session**: what a session would hold ("Today: 18 reviews and 5 new") and the type warnings. The **card types** follow the modal's rule: a type with nothing to study is left out with the reason; Reverse and Cloze show when your decks would have such cards once switched on (the switches on a deck's settings stay available, so a deck can be prepared before it has cards).
- **Limits**: new cards and reviews (a session stops after these counts, reviews first; saved when you leave the field), the **Order of new cards**, the **Order of card types**, and **Scheduling: …**, which opens the [scheduling page](Scheduling-and-FSRS).
- **Session source**: **My decks** or **By level** (see below).
- **Decks**: tick the decks to draw from; **All decks** keeps every deck, including the ones you create later. Creating, renaming and deleting decks is on the [Decks page](Flashcards-decks-limits-vacation).
- **Manage cards**: every card of the workspace, filtered by deck, to **Move** or **Delete** several at once. Deleting a word removes it from every deck with its sentence, writing and tone cards; moving puts it and those cards in the chosen deck only. A ten-second **Undo** follows both.
- **Card types**: pick at least one. A session queues only the types you selected, so a Tone-only session never shows a vocab card, and a type with nothing to study says so ("Tone: nothing to study in the selected decks right now"). Reverse and Cloze here switch the type on or off in every deck; the home widget counts the same types.
- **Per-deck settings → Per-deck card types**: the Reverse and Cloze switches of a single deck.

### Order of new cards

The order decides which new cards come first; reviews always come first and in due order (kept roughly when they mix card types, see below), and the daily limits are unchanged. The default is **Random**: the new cards (and, in a level session, the words or characters of the level) are shuffled, so you do not meet them in dictionary or list order. The shuffle is fixed when you press Start: reloading the same session shows the same order. Levels themselves stay in sequence, since a level session studies one level. Other choices: in a deck session "As each deck is set" (each deck's own setting, deck Settings, New cards), "In the order added", "Most frequent first (<list name>)" or "By level: <scheme>"; in a level session **Level order** or, for a word scheme, **Most frequent first** (word frequency does not rank kanji). When the selected decks use different orders and you chose "As each deck is set", the session uses the order added and says so. The frequency choice appears only when a frequency list of the workspace language is installed. The ranks need the server: offline, or when the request fails, the session keeps the order added and shows "Frequency order needs a connection; using the order added". A deck's own setting is unchanged: its default is still the order added.

### Order of card types

A session mixes its card types: instead of all the Vocab cards and then a block of Writing, Tone or Cloze cards, you meet the types interleaved (on the card they are named by what you do, Recognise for Vocab, Write for Writing and so on; see [The session screen](#the-session-screen)). Two cards of the same word are kept apart, so a word's Vocab card straight before its Writing card does not give the answer away: never back to back when the session allows it, and a few cards apart in longer sessions (at least one other card between them when the reviews, or the new cards, of a session number fewer than 8, two below 16, three from 16). A session that cannot keep them apart (say only one word's four types) still starts, as close to that as it can. In a deck session a new word always starts with its Vocab card; its other types follow later in the session. Reviews still come first and in due order (a card moves only a few places, so the most overdue ones stay at the front whatever their type), and an order you chose for new cards (**Most frequent first**, **Level order**) still holds roughly. A session of a single card type keeps its order exactly. The mix is fixed when the session starts, from the study modal or a deck's or level's **Study** button, so reloading the same session keeps it; the next session is mixed differently. Limits, burying and the re-show of Again cards are unchanged.

Choose **Grouped by type** to drill one type at a time: reviews first, then the new cards, each grouped in the order Vocab, Word Salad, Writing, Tone, Reverse, Cloze (a card may move one place so a word is not back to back where one group ends and the next begins). Like the order of new cards, the choice belongs to the setup of this tab. The rule is specified in `docs/contracts/cards/` (Session mix).

### Level sessions

Choose **By level**, pick an installed scheme (HSK, JLPT, Jōyō grades, 通用规范汉字表) and one of its levels; each level shows how far you are ("HSK 2 — 3 of 80 learned", by the same rule as Stats → Characters). A word that already has a card reuses it; the rest get a card in the General deck when you first grade them, so abandoning a level session creates nothing.

- **Word levels** study vocab cards only; the other card types apply to deck sessions.
- **Character levels** (JLPT kanji, Jōyō grades, 通用规范汉字表) have two cards per character: **Vocab** (recognition: the glyph alone, then its readings and meanings) and **Writing** (the readings and meanings, then write the glyph). A character's writing card joins a session only from the learner day after its recognition card was first reviewed; a writing-only session has no such wait. Characters without stroke data or meanings get no writing card, and neither does a character whose writing card you removed (as in deck sessions). The new-card limit counts cards, not characters.

## Card types

| Type | What you do | Needs |
|---|---|---|
| Vocab | See the word; press **Show answer** for its reading (with play), meanings and the example sentence with the word blanked | any word |
| Word Salad | Rebuild the example sentence from shuffled tiles: tap a tile to place it, tap a placed tile to remove it, **Undo**, then **Check** (or **Show answer**) | an example sentence |
| Writing | Draw each Han character stroke by stroke (order and direction are checked); **Show strokes** reveals the current character; kana stay visible | Han characters with stroke data from the installed strokes pack |
| Tone | Swipe the tone's shape on each syllable pad, use the tone buttons, or press 1 to 5 | a Chinese word with pinyin (Chinese workspaces only) |
| Reverse | See the meaning, recall the word; typing, then **Show answer**; the reading is a [hint](#hints) | a word (not a character) with a meaning |
| Cloze | Fill the gap in an example sentence of the word (choose at first, type once learned); the translation is shown, the reading after the answer | a word with an example sentence that contains it |

- **Word Salad** gets harder as a card settles: new or short-memory cards (stability under 4 days) show word tiles with the translation; middle cards (under 21 days) hide the translation behind **Show translation**, which counts as a hint; long-memory cards (21 days or more) split every word into single characters. The tier is named on the card. If the sentence cannot be cut into words, each character becomes a tile.
- **Writing** shows the character's outline as a hint after 3 misses on one stroke; each new character starts again without it.
- **Tone** swipes: up = 1; up-right or right = 2; down then back up = 3; down-right, down, down-left or left = 4; a tap = neutral (5). A character with several readings accepts any of them (行 can be háng or xíng).

### Companion cards

An example sentence an AI wrote for you ([AI examples](Searching-and-entries#ai-examples), the ones you kept) is marked **AI-written** on every card that shows it: Word Salad, cloze and the vocab answer. Kept AI examples come after the dictionary's own examples, so a word with enough curated examples uses those first.

Sentence (Word Salad), writing and tone cards are **companions** of the vocab cards in the chosen decks. They share the new-card limit and each one is created only when you grade it for the first time, so abandoning a session creates nothing. A word that does not qualify (no sentence, no drawable character, no pinyin) is never planned: the server says which words qualify before the session is planned (asked again after ten minutes). Should a card still turn out unusable when it comes up (a sentence pack removed meanwhile), it is skipped and the next planned companion takes its place (at most `max(30, 2 × new-card limit)` times per session), and the word is not planned for that type again in this sign-in. A word gets at most one sentence card, built from its first example sentence (if that sentence later disappears, its first sentence is used instead). Companions are planned in deck sessions only.

### Reverse and cloze cards

They appear once in the setup's **Card types** list. Checking one enables it on every deck at once; **Advanced settings → Per-deck card types** has the switches for a single deck. A deck with neither enabled behaves as before. They are created the first time you grade them, at most one reverse or cloze card per word and session (reverse first). After you answer a reverse or cloze card of a word, the word's other cards are buried until your next learner day, and the other way round ("2 related cards are buried until tomorrow"): they stay due but are left out of the queue and counts. Vocab, sentence, writing and tone cards do not bury each other. Reverse and cloze reviews give XP and count for streaks and the heatmap but not for character mastery.

## The session screen

A session is an open page, not a card in a box. At the top: a close button (**End session**: back to the page the session was started from, with the study modal open), a thin progress line and the count ("4 / 20", with "3 to repeat" when cards come back). Every card type then has the same four parts in the same places: the **task name** in the accent colour (with the deck and level on the right, and small labels such as the Word Salad tier, "Again, look 2 of 3" on a re-show, or "new"), the **prompt**, the **answer area** (nothing, an underlined field, choices, word tiles, the writing pad or the tone pads) and, below a thin line, the **answer** (reading and play button, meanings and source, your note). The card types are not colour-coded.

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
| Every card with a hint left | H asks for the next hint (Alt+H inside a text field, where H is a letter) |
| Every card, once one was graded | Z goes back to the card graded before (see [Changing a grade](#changing-a-grade)); there 1 to 4 change its grade and Esc returns |

## Hints

Every card can offer a small **Hint** button (and the H key) that shows one more piece of help each time you press it, in a fixed order: the word's **reading** (kana, pinyin or zhuyin, above the word like furigana), then its **picture**. The picture is offered only for words that have one (a bundled picture set is installed on the server) and while the **Pictures** visual aid is on ([Settings tour](Settings-tour)). The answer of a Recognise, Recall or writing card also shows the picture, with its credit, unless the hint already showed it. The Hint button disappears when no hint is left, and after you answer.

What a card offers is set in Settings → Study → **Hints**, for each kind of hint and each card type: **Always shown** (part of the front), **As a hint** (hidden until you ask) or **Never**. By default the reading is a hint on Recognise, Build the sentence, Recall and Fill the gap cards, always shown on Write cards (as before) and not offered on Tones (it would be the answer).

Asking for a hint costs a little: the suggested grade goes down one step (Easy to Good, Good to Hard; a card you grade yourself is suggested Hard, and Hard and Again stay as they are). One hint or three, the suggestion drops once. You can still press any grade. Hints that are always shown do not count, and neither does the extra help a card has always had (the stroke hint on Write cards, the translation on Build the sentence). The number of hints you used is stored with the review.

## Starter mode

For people who are new to a language (Japanese and Chinese so far). You get a short set of common, picturable words, the **Starter words**, in your own decks, and each word starts as a picture with its pronunciation. The more you get to know **that word**, the more of the real script it shows. It is a display rule only: the cards, their history and their schedules are the same with Starter mode on or off.

| Stage | Japanese front | Chinese front |
|---|---|---|
| 1 | picture and romaji | picture and pinyin |
| 2 | picture and hiragana with romaji | picture and hanzi with pinyin |
| 3 | picture and hiragana | hanzi with pinyin, picture as a hint |
| 4 | hiragana, picture as a hint | hanzi, picture as a hint |
| 5 | kanji with hiragana above (furigana), picture as a hint | the normal card |
| 6 | the normal card | |

Loanwords show katakana where hiragana is used above. Words that are normally written in kana stop at stage 4, which is their normal card. "Picture as a hint" means the picture is hidden until you press **Hint** (or H), the same control and the same grading rule as every other hint. The meaning is always on the back, and the play button is on the front at every stage.

A word moves up when you answer it **Good or Easy on a different day** (at least twelve hours after the last answer that counted): one step for the first answer, then at 2, 3, 5 and 7 such answers for Japanese (1, 2, 4 and 6 for Chinese). **Hard** keeps the word where it is, and **Again** drops it one stage. The first time a word reaches a new stage its card says what changed ("New: now with hiragana").

Turn it on in Settings → Study → **Starter mode**, or accept the offer on Home when a workspace has nothing in it yet. The same place adds the Starter words to your decks (deck "Starter words") and lets you apply the mode to **the Starter words only** or to **all your vocabulary cards**. Switch it off and every card shows normally; nothing is lost. The Starter words are a seed list that has not yet been read through by a person.

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

## Changing a grade

Clicked **Again** when you meant **Good**? Press **Back** (next to the grade buttons, or the key Z) and the card you graded last comes back with its answer showing, your grade marked ("your grade") and the suggested grade as before; the exercise itself is not repeated. Press Back again to go further: up to the last 20 cards of this session. Choose another grade and it replaces the old one, then you are back on the card you were on; choosing the same grade, or **Return to the current card** (Esc), changes nothing. The card you were on starts again when you come back: an answer you had already revealed stays revealed, but a half-typed answer, half-placed tiles or tones, or a half-drawn character are cleared. On the summary screen **Change the last grade** does the same for the last card.

A changed grade undoes what the old one did in the session: an Again card's re-show is taken out again (unless you already saw it), and changing to Again queues one, a few cards later. The schedule, XP, streak, the daily counts, the heatmap, goals, milestones, Stats and the optimizer's training data all count the card once, with the new grade, and on the same day as before. Burying and the daily limits do not depend on the grade, so they stay as they were.

Back belongs to the open session: after a reload, a workspace switch or a new session the earlier grades stay as they are. It works offline too; the change is sent with the other queued reviews. Nothing is ever edited or deleted: the new grade is a new review that names the one it replaces, so another device (or an older copy of the app that does not know about it yet) sees both until it catches up.

## The end of a session

**Session complete** shows the reviews you made (and re-shows, which are practice and not counted), the XP this session by card type and the daily bonus, the progress to your next level and your streak. **Done** returns to the page the session was started from. A session with nothing to study, or one that could not load, has **Back to study** instead, which returns there with the study modal open.

## Scheduling, XP and streaks

Each grade is written to your study history; the next due date is derived from the card's whole review history with FSRS (see [Scheduling and the FSRS optimizer](Scheduling-and-FSRS)). Nothing schedule-shaped is stored, so two devices merge cleanly.

XP, level and streak are derived from the history per workspace:

- base XP per review: Vocab 10, Word Salad 15, Writing 20, Tone 8 (Reverse and Cloze count too);
- a grade bonus: Good +5, Easy +10, Again and Hard nothing;
- a daily bonus of +10 for each learner day with at least one review;
- 20 XP for each finished [grammar lesson](Grammar-lessons) run.

Level L to L+1 costs 100 × L XP, so level 2 starts at 100 XP, level 3 at 300 and level 4 at 600. The streak counts the learner days in a row with a review or a finished grammar lesson (vacation days neither extend nor break it). All days are your days in your time zone ([Settings tour](Settings-tour#study)).

A study-buddy mascot appears in the flashcards widget and the session summary: it grows at levels 5, 10 and 20, and its mood (sleepy, happy, cheering, proud) follows your streak. Its drawings are placeholders for now.

## For client implementers

Card kinds, review parsing, XP and levels, burying and the session plan are specified in `docs/contracts/cards/`, `docs/contracts/study/` and `docs/contracts/scheduler/`. A changed grade is a `review` with `replaces: <id>`; which reviews then count (one per family, the greatest id) is `docs/contracts/events/review-replace.json`. A new card has a deterministic id, `c-<kind>-<entryId>` (for example `c-vocab-42`), so two devices that add the same word offline write the same row. Older cards with random ids can exist twice; every page reads cards through one loader that merges such duplicates at read time (the earliest card survives, the others' reviews and decks join it), without rewriting anything stored.

## Related

[Decks, limits and vacation](Flashcards-decks-limits-vacation), [Stats and heatmap](Stats-and-heatmap), [Install as an app and study offline](Install-and-offline).
