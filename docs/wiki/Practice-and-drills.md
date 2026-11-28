# Practice and drills

**Practice** (`/practice`) is the home of the drills: short exercises that train one thing at a time, apart from your
flashcards. The drills planned for v0.9.0 are the conjugation trainer (Japanese verbs and adjectives), measure words
and counters, tone pairs (Mandarin) and look-alike characters. Practice shows in the navigation once a drill applies
to your workspace's language; until then `/practice` says "No drills for this language yet".

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
