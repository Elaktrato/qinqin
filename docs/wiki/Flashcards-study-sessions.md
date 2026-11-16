# Flashcards: study sessions

Studying is provided by the flashcards plugin. To add a word open any word or character entry and press **Add to study**; the card joins the General deck.

## Starting a session

`/study` is the session setup. Choose the decks to draw from, the card types, and the limits for new cards and reviews. At least one type must be selected. A session only queues the types you selected (a Tone-only session never shows a vocab card). Your last choice is preselected in new tabs of the same workspace, and the home widget counts the same types.

You can also draw from a level instead of a deck: choose **By level**, pick an installed scheme (HSK, JLPT, a curriculum pack) and one of its levels. A word that already has a card reuses it; the rest get a card in the General deck when you first grade them, so abandoning a level session creates nothing.

**Order of new cards** (under Limits) decides which new cards come first; reviews always come first and in due order, and the daily limits are unchanged. In a deck session the default follows each deck's own setting (deck Settings, New cards); you can override it with "In the order added", "Most frequent first (<list name>)" or "By level: <scheme>". When the selected decks use different orders the session uses the order added and says so. A level session keeps level order, or takes **Most frequent first** for a word scheme (word frequency does not rank kanji). The frequency choice appears only when a frequency list of the workspace language is installed. The ranks need the server: offline, or when the request fails, the session keeps the order added and shows "Frequency order needs a connection; using the order added".

## Card types

| Type | What you do | Needs |
|---|---|---|
| Vocab | See the word and readings and the example sentence with the word blanked; press **Show answer** for the meanings | any word |
| Word Salad | Rebuild the example sentence from shuffled tiles, then **Check** (or **Show answer**) | an example sentence |
| Writing | Draw each Han character stroke by stroke (order and direction are checked); **Reveal character** animates it | Han characters with bundled stroke data |
| Tone | Swipe the tone's shape on each syllable pad, use the tone buttons, or press 1 to 5 | a Chinese word with pinyin (Chinese workspaces only) |
| Reverse | See the meaning, recall the word; optional **Show reading** hint and typing, then **Show answer** | a word (not a character) with a meaning |
| Cloze | Fill the gap in an example sentence of the word (choose at first, type once learned) | a word with an example sentence that contains it |

Sentence, writing and tone cards are **companions** of vocab cards: a companion is created only when you grade it for the first time, so abandoning a session creates nothing. A word that does not qualify (no sentence, no drawable character, no pinyin) is skipped silently.

### Reverse and cloze cards

They are opt-in per deck: each deck row on `/study` has a **Reverse** and a **Cloze** switch. A deck that never turns them on behaves as before. After you answer a reverse or cloze card of a word, its other cards are buried until your next learner day (they stay due but are left out of the queue and counts); vocab, sentence, writing and tone cards do not bury each other. Reverse and cloze reviews give XP and count for streaks and the heatmap but not for character mastery.

## Grading

Grade each card **Again**, **Hard**, **Good** or **Easy** (keys 1 to 4). After a check the exercise suggests a grade by highlighting and focusing a button; it never submits one, and never suggests Easy.

| Type | Good | Hard | Again |
|---|---|---|---|
| Word Salad | right on the first check | right after 1 to 2 wrong checks | 3 or more wrong checks, or Show answer |
| Writing | no mistakes | mistakes on at most 25 % of the strokes | more mistakes, or a revealed character |
| Tone | all tones right | one tone wrong | two or more wrong |

Keys: Space or Enter shows a vocab answer; in Tone 1 to 5 set the highlighted syllable's tone (5 is neutral), arrow keys move, Backspace clears, Enter checks.

Word Salad gets harder as a card settles: new or short-memory cards show word tiles with the translation, middle cards hide the translation behind a reveal (counts as a hint), and long-memory cards (stability of 21 days or more) split words into single characters.

## Scheduling, XP and streaks

Each grade is written to your study-event log; the next due date is derived from the card's whole review history with FSRS (see [Scheduling and the FSRS optimizer](Scheduling-and-FSRS)). Nothing schedule-shaped is stored, so two devices merge cleanly.

XP, level and streak are derived from the log per workspace: base XP per review (Vocab 10, Word Salad 15, Writing 20, Tone 8) plus a grade bonus (Good +5, Easy +10) and a daily bonus of +10 for each day with a review. Level L to L+1 costs 100 x L XP. A study-buddy mascot appears in the widget and summary; its art is a placeholder.

## Related

[Decks, limits and vacation](Flashcards-decks-limits-vacation), [Stats and heatmap](Stats-and-heatmap), [Install as an app and study offline](Install-and-offline).
