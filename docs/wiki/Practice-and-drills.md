# Practice and drills

**Practice** (`/practice`) is the home of the drills: short exercises that train one thing at a time, apart from your
flashcards. The drills of v0.9.0 are the conjugation trainer (Japanese verbs and adjectives, below), measure words
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

## The conjugation drill

In a Japanese workspace, **Conjugation** drills the verbs and adjectives of the words you study (a word counts once
you have reviewed one of its cards). Each word has an item per **form family**: polite (〜ます, 〜ません, 〜ましょう),
polite past, plain negative, plain past, て-form, and, when you switch them on in Settings → Study → Conjugation,
potential, volitional, the conditionals (〜ば, 〜たら), passive and causative. Within a family the questions take turns
through its forms.

- A **new** item, or one you just got wrong, shows a form (書きます) and asks which form it is: tap its name.
  食べられる is both the potential and the passive; either is right.
- After that you **give the form**: type it in kana or kanji with your keyboard's Japanese input and press Enter (an
  Enter that finishes converting does not check), or **Check**. Stuck? **Show choices** offers four forms; a right
  choice counts as right after a hint (Hard). A variant such as 食べれる or 高くありません is right too, and the
  answer shows the standard form.
- The kana reading is shown with every form written in kanji (来ない【こない】); romaji only while Settings → Study →
  Romanisation shows it.
- Irregular verbs (する, 来る, 行く, ある, 問う, the honorific verbs), いい and な-adjectives follow their own rules. Forms
  a verb does not use are not asked (分かる has no potential, ござる only its polite forms). The word class comes from
  JMdict's part of speech, so a dictionary without parts of speech gives no conjugation items. The forms were reviewed
  by agents acting as Japanese teachers, not yet by a person.

## What a drill answer counts for

Each answer is saved as a study event (`drill.<drill>`), like a review: it is sent at once, or later when you are
offline. It counts for:

- the **heatmap** and the **weekly summary** (one point per answer, each drill as its own activity), and **daily
  goals** (a goal of drill answers);
- **XP**: 5 per answer, 5 more for a right answer (Good) and 10 for an Easy one;
- your **streak**, and the streak and days-active [milestones](Milestones): a day with a drill answer is a study day.

Practice is a feature you can switch off in Settings → Features; switching it off hides it and deletes nothing.

For developers: the conjugation rules are in `docs/contracts/conjugation/`; the drill rules are in `docs/contracts/drills/` (item keys, the event, schedules, the rounds, counting) and
[Development](Development#drills) explains how a drill plugs in.
