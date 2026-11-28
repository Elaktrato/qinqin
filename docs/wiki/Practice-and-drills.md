# Practice and drills

**Practice** (`/practice`) is the home of the drills: short exercises that train one thing at a time, apart from your
flashcards. The drills planned for v0.9.0 are the conjugation trainer (Japanese verbs and adjectives), measure words
and counters, tone pairs (Mandarin) and look-alike characters. Practice shows in the navigation once a drill applies
to your workspace's language (today: Chinese, with tone pairs); until then `/practice` says "No drills for this
language yet".

## How it works

- Every drill item (a word and a verb form, a noun, a tone pair, a set of look-alike characters) has its **own
  schedule**, worked out with FSRS from your answers, like a flashcard's, but never in the flashcard queue. Drills use
  the default FSRS parameters, not the ones you optimised for flashcards. Vacation days count for drills as for cards.
- The Practice page lists each drill with how many of its items are due, new and practised, and a **Practise** button.
  A drill's round has up to 20 questions: the due items first, then up to 10 new ones, then the items that are not due
  yet, weakest first. A wrong answer comes back in the next round.
- **Practise weakest** picks the 20 items you are most likely to get wrong right now, from every drill (FSRS's
  "retrievability"). It shows up once you have answered something.
- At the end of a round you see how many you got right and the items to practise again. The browser's (or the
  Android app's) back button leaves a round; your answers are already saved.

## Tone pairs (Chinese)

Mandarin tones are easiest to learn in pairs. The drill has the 20 two-syllable patterns: first tone 1 to 4, second
tone 1 to 4 or neutral (1-1, 1-2 … 4-5). Each pair practises real words with that pattern: words from your decks
first, then words from the installed HSK word list (the lowest levels first). A word is used when it is written with
two characters and its dictionary readings agree on one pattern, so words with two different readings are left out.

- **A question** shows the word, with a play button (its recording, or your device's voice). Type the two tones in
  the field (`3 4`, `34`; `0` or `5` is the neutral tone; `ni3 hao3` or `nǐ hǎo` work too), or tap them with the tone
  buttons under each character, then **Check** or Enter. On a phone the field opens the number keyboard and keeps it
  open from one word to the next: Enter checks, Enter again goes on.
- **Grading** follows Settings → Study → Tones, the same switches as the Tones flashcards: by default the dictionary
  (citation) tones are graded, and a tone changed by tone sandhi also counts (你好: 3-3, or 2-3 as spoken). With
  **Grade spoken tones** only the spoken tones are right. With **Show tone sandhi** the answer shows the spoken tone
  after the citation tone (`nǐ → ní`). A word is always practised under its dictionary pattern: 你好 is the pair 3-3.
- **With pinyin hidden** (Settings → Study, romanisation) nothing changes in the exercise: you see the characters,
  and the answer shows tone numbers and tone contours instead of pinyin.
- **The grid** on the Practice page shows each pair's share of right answers over its last 10 answers, marked weak
  (below 60 %), fair or strong; pairs without any word are dimmed. **Practise my weakest pairs** starts a round of
  your weakest pairs (`/practice/tone-pairs/weakest`).

## What a drill answer counts for

Each answer is saved as a study event (`drill.<drill>`), like a review: it is sent at once, or later when you are
offline. It counts for:

- the **heatmap** and the **weekly summary** (one point per answer, each drill as its own activity), and **daily
  goals** (a goal of drill answers);
- **XP**: 5 per answer, 5 more for a right answer (Good) and 10 for an Easy one;
- your **streak**, and the streak and days-active [milestones](Milestones): a day with a drill answer is a study day.

Practice is a feature you can switch off in Settings → Features; switching it off hides it and deletes nothing.

For developers: the rules are in `docs/contracts/drills/` (item keys, the event, schedules, the rounds, counting) and
[Development](Development#drills) explains how a drill plugs in.
