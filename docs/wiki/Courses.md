# Courses

**Courses** (`/courses`) is a guided path through a language: sections that follow the levels (≈ HSK 1–4 for
Chinese, ≈ JLPT N5–N3 for Japanese, plus a start section), units with a theme, and small lessons of a few minutes
each. The course of your workspace's language is the one the server has installed; a server with more than one
course for a language lets you pick it at the top of the page (remembered on this device). A server without a course
for your language says so.

## The bundled courses

qinqin ships two courses, installed with the other bundled packs (`zh-course`, `ja-course`):

- **Chinese (≈ HSK 1–4):** a start section (sounds and tones, the first fifteen characters), then ≈ HSK 1 (15 units),
  ≈ HSK 2 (12), ≈ HSK 3 (16) and ≈ HSK 4 (20). The words come from the HSK 3.0 word list on your server.
- **Japanese (≈ JLPT N5–N3):** a start section (the sounds of Japanese, hiragana, katakana), then ≈ N5 (14 units),
  ≈ N4 (20) and ≈ N3 (36). The words come from the estimated JLPT word list.

Every unit has a theme, the grammar lessons of its level and the characters it introduces. The units of ≈ HSK 1–2 and
≈ N5–N4 each end with a short reading text written for the course, with a translation; it uses the words you have met
in the course so far and at most a few new ones, which the reading shows with their reading and meaning. The higher
levels have their units, grammar and characters but no texts yet. The courses are written for qinqin (CC BY 4.0) and
were reviewed by agents acting as native-speaker teachers, not yet by a person.

## The roadmap

- **Continue** opens the next thing to do: the next lesson of the current unit, or its unit test once every lesson is
  done.
- Each unit shows whether it is **Done**, **Now** (the current unit), **Open** (a unit added before your position by a
  course update) or **Locked**. The lessons of the current and open units are listed with their state.
- **Take the unit test** on a unit you have not passed lets you skip ahead: passing it early unlocks everything before
  it. **Take the section exam** does the same for a whole section.
- Words of units you skip are marked **known** (they do not become a pile of new cards). A skipped unit offers **Add
  these as cards** if you want to study them after all.
- Word marks (50, 100, 250 … words) show where along the path you reach them.

## Lessons

A lesson opens full screen, without the bottom bar: a thin progress line at the top, the step in the middle, the
button at the bottom. The ✕ (or the back button on Android) leaves the lesson; a lesson you leave starts again next
time.

- **New words:** each word with its reading (unless you hide that romanisation, Settings → Workspaces), its meaning and
  the device voice, then a short check: what each word means, and which word means what. A wrong answer is asked once
  more at the end.
- **Script:** the unit's hanzi or kanji, and a link to the [Scripts trainer](Scripts-trainer) for kana.
- **Grammar:** a [grammar lesson](Grammar-lessons) and its fill-the-gap exercises; it counts as a grammar run too.
- **Practice:** a mixed round over the unit's words (meaning, word, and listening when your device has a voice).
- **Listening** and **speaking:** hear a word and pick it; hear it and say it.
- **Reading:** the unit's text, with the reading over every word you have not met yet and their meanings below; the
  translation is a tap away.

Every lesson ends with a summary: how many you got right the first time and the words you met.

## Course words in your flashcards

A finished word lesson adds a card for each new word to a deck named after the course, and its first review is the
lesson's check (Good when you got the word right every time, Hard otherwise). So course words never wait behind the
daily limit for new cards, and from then on they come up in your normal reviews. A word that already had a card
keeps it. If a lesson is finished offline, it counts at once; its cards are added when you are back online from the
course page (**Add these as cards** under the word count).

## Unit tests and section exams

A **unit test** closes a unit; a **section exam** closes a section. Both are a mixed test of the course's own
material:

- **Words:** what a word means, which word means something, how it is read (the pinyin with its tones for Chinese, the
  kana for a Japanese word written with kanji; never when you hide that romanisation), and which word you hear (with a
  device voice).
- **Grammar:** fill-the-gap exercises from the unit's grammar lessons.
- **Reading:** a word missing from a sentence of the unit's reading text.

The number of questions and the pass mark come with the course: a unit test passes at **80 %**, a section exam at
**75 %**. The questions spread over the unit's word lessons (or the section's units) like the
[level check](Settings-tour) samples a level, and words you have already shown you know (marked known, or cards you
know well) are asked only when nothing else is left. A wrong answer shows the right one; nothing is asked twice.

- **Passed:** the unit (or section) is done. Taken early, before its lessons, it **skips everything before it**: those
  units are done, and their words are marked known (they do not become new cards; **Add these as cards** on the
  roadmap if you want them).
- **Not passed yet:** the summary shows the pass mark, **what to review** (the words you missed with their reading and
  meaning, the grammar lessons, the units to go back to) and **Try again**. A test never takes anything away: your
  lessons and words stay as they were.

## Find your place

If you already know some of the language, **Already know some? Find your place** on the roadmap (shown until you
have finished a unit of a level) takes the section exams one after another, starting at the first level. Each exam
stops as soon as its result is clear. After a pass you take the next level's exam, or choose **Start here** to begin
at the next level; the first exam you do not pass is where you start. Not passing the very first one starts you at
the beginning of the course, nothing skipped. Everything you pass is skipped as above.

## Home and starting out

- **Continue course** on the home page (first in the default home layout) shows where you are in your course and the
  next lesson one tap away (**Start** at the beginning, **Continue** afterwards, the unit test when its lessons are
  done), with how many units are done and words met. A workspace whose language has no course shows nothing there.
- A new workspace whose language has a course asks **How would you like to start?** on the home page:
  - **I'm new to <language>:** **Start the course** at its first lesson, and **Also add the Starter words** (the
    picture words of [Starter mode](Settings-tour), which the course does not include) with Starter mode on.
  - **I know some already:** **Find your place** (below), or **Tell us which levels you know** (the level
    declaration in Settings → Study).

  The card replaces the separate Starter and placement offers for such a language and goes away once you have a
  card, a known word or a finished lesson, or when you choose **Not now** (on this device).
- **Course work counts**: a finished lesson (except a grammar lesson, which counts as a grammar lesson), a unit test
  and a section exam are each a point on the [heatmap](Stats-and-heatmap) (once a day each), 20 XP, and a day for your
  streak; "Course lessons" is a [daily goal](Daily-goals) and a row of the [weekly summary](Weekly-summary).
- **Milestones** mark the way ([Milestones](Milestones)): your first lesson, each unit and section, all of a script
  (hiragana, katakana), 100 … 1,000 characters and 50 … 3,000 words of the course, and finishing it.

## After the course

When every unit is done, the roadmap shows **What comes next**: your decks (the course words stay in your daily
reviews), level sessions for the next level's words, the [Reader](Reader), and [grammar](Grammar-lessons)
beyond the course. **Continue course** on the home page links there.

## Offline and Android

The course and your place in it are kept on the device: the roadmap opens offline, and lessons work offline for the
units whose words were loaded while you were online (the current unit and the next one are fetched ahead). The
Android app shows the same pages.

Courses is a feature you can switch off in Settings → Features; switching it off hides it and deletes nothing. It is
a section of the bottom bar (under **More** until you pin it in Settings → Layout).

For developers: [Courses data model](Courses-data-model).
