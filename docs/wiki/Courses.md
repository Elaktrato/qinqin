# Courses

**Courses** (`/courses`) is a guided path through a language: sections that follow the levels (≈ HSK 1–4 for
Chinese, ≈ JLPT N5–N3 for Japanese, plus a start section), units with a theme, and small lessons of a few minutes
each. The course of your workspace's language is the one the server has installed; a server with more than one
course for a language lets you pick it at the top of the page (remembered on this device). The real Chinese and
Japanese courses come with a later update; a server without a course for your language says so.

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

For now, a unit test asks the meaning of the unit's words (at most ten questions) and passes at 80 %; a section exam
asks across the section and passes at 75 %. The full tests come with a later update.

## Offline and Android

The course and your place in it are kept on the device: the roadmap opens offline, and lessons work offline for the
units whose words were loaded while you were online (the current unit and the next one are fetched ahead). The
Android app shows the same pages.

Courses is a feature you can switch off in Settings → Features; switching it off hides it and deletes nothing. It is
a section of the bottom bar (under **More** until you pin it in Settings → Layout).

For developers: [Courses data model](Courses-data-model).
