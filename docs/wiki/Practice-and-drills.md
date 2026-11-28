# Practice and drills

**Practice** (`/practice`) is the home of the drills: short exercises that train one thing at a time, apart from your
flashcards. The drills of v0.9.0 are the conjugation trainer (Japanese verbs and adjectives, below), measure words
and counters, tone pairs (Mandarin) and look-alike characters. Practice shows in the navigation once a drill applies
to your workspace's language (today: Chinese, with tone pairs and measure words, and Japanese, with conjugation,
counters and counter readings); until then `/practice` says "No drills for this language yet".

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

## Measure words (Chinese)

In a Chinese workspace, **Measure words** asks the measure word (量词) of the nouns you study (a noun counts once you
have reviewed one of its cards): 一 ＿ 书 (book) → 本. The measure words come from the installed CC-CEDICT
dictionary's "CL:" notes, with corrections reviewed by agents acting as Chinese teachers (some nouns are left out,
some lists are put in a better order, a few glosses are clearer); nouns without a note are not asked.

- **Type** the measure word with your keyboard's Chinese input (simplified or traditional), or its pinyin with tones
  (`ben3`, `běn`; toneless pinyin does not count), and press Enter (an Enter that finishes converting does not check);
  a number in front (一本) is fine. **Show choices** offers four; a right choice counts as right after a hint (Hard).
- Every measure word the dictionary lists is right; the answer names the usual one first and the others under "Also
  right". Where 个 is understood but not the standard word (一个猫), it counts as right after a hint, and the answer says
  which word is standard. 个 is never accepted for nouns where it is wrong (一个纸, 一个衣服, 一个水).
- Pinyin and bopomofo show only while Settings → Study → Romanisation shows them. A noun you write in traditional
  characters gets its measure words in traditional characters.

## Counters and counter readings (Japanese)

In a Japanese workspace there are two drills, built on a counters table written for qinqin (32 counters, about 160
nouns; reviewed by agents acting as Japanese teachers, not yet by a person):

- **Counters** asks the counter of the nouns you study: 紙 (paper) → 枚, 本 (book) → 冊. Type the counter in kanji, kana
  or romaji (三枚 is fine too), or **Show choices**. Nouns that two counters fit (ビール: 本 or 杯) take either. Nouns
  that are not in the table are not asked.
- **Counter readings** asks how number + counter is read, with its sound changes: 1本 いっぽん, 3本 さんぼん, 6本 ろっぽん,
  何本 なんぼん, 1人 ひとり, 4人 よにん, 20日 はつか. It does not need your decks: every counter of the table with 1 to 10 and
  何 (dates also 14, 20 and 24; ages 20; o'clock and months 11 and 12), one counter after the other. Type the reading in
  kana or romaji; if your keyboard turns it into kanji (三本), you are asked again in kana. Common variants are right
  too (じっぽん, はちほん, さんかい), and the choices are the classic slips (さんほん, さんぽん, ようか for the 4th).
- Romaji shows only while Settings → Study → Romanisation shows it; kana always shows.

## What a drill answer counts for

Each answer is saved as a study event (`drill.<drill>`), like a review: it is sent at once, or later when you are
offline. It counts for:

- the **heatmap** and the **weekly summary** (one point per answer, each drill as its own activity), and **daily
  goals** (a goal of drill answers);
- **XP**: 5 per answer, 5 more for a right answer (Good) and 10 for an Easy one;
- your **streak**, and the streak and days-active [milestones](Milestones): a day with a drill answer is a study day.

Practice is a feature you can switch off in Settings → Features; switching it off hides it and deletes nothing.

For developers: the conjugation rules are in `docs/contracts/conjugation/`, the measure-word and counter rules in
`docs/contracts/counters/` (the table and its review notes: `server/internal/counters/table/`); the drill rules are in `docs/contracts/drills/` (item keys, the event, schedules, the rounds, counting) and
[Development](Development#drills) explains how a drill plugs in.
