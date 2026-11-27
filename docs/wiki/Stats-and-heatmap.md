# Stats and the activity heatmap

**Stats** is the bar-chart icon in the top bar (in the menu drawer on a phone) of every signed-in page (`/stats`). It has up to three tabs. Stats is a feature like the Reader or the Journal: you can switch it off for yourself in [Settings → Features](Settings-tour#features), which hides these pages and their widgets and deletes nothing.

The tabs are text links at the top of the page, on desktop and on the phone; the current one has an accent underline.

- **Overview** shows the design's default arrangement first: the four summary numbers (day streak, words known, recall over the last 30 days, time studied this month), the word-state bar, the flashcards level line, reviews per day over the last 30 days and the day heatmap. Every other widget that applies follows after them; plugins' widgets are never dropped.
- **Week** (`/stats/week`) is the [weekly summary](Weekly-summary): one week, Monday to Sunday, browsed with **Previous week** / **Next week** arrows and compared with the week before. It needs a workspace. It also shows your [milestones](Milestones): a card for new ones and the full list (`/stats/week#milestones`).
- **Characters** (`/stats/characters`) is the mastery map. It exists only in Chinese and Japanese workspaces; elsewhere the tab is hidden and a direct visit explains why. The old address `/study/map` redirects here.

## Widgets

| Widget | What it shows | Languages |
|---|---|---|
| Summary | Four large light numbers: day streak, words known, **Recall, last 30 days**, studied this month | all |
| Words | How far each word has come: New, Learning, Young (under 21 days), Mature; one row per deck | all |
| Flashcards | What is due and new, level and XP, streak, study buddy | all |
| Reviews per day | One bar per day for the last 30 days, today emphasised | all |
| Activity | The heatmap | all |
| Characters | "N of M learned" and the stage bar, with a link to the map | Chinese, Japanese |
| Reading time | Total, last 7 and last 30 days, five most read books | all |

The four summary numbers reuse rules defined elsewhere: the streak is the flashcards widget's streak (days with a review or a finished grammar lesson), **words known** is the one known-word predicate (a manual "I know this" mark or a vocabulary card at the mastery threshold), **recall** is the decks page's overall 30-day figure (shown after 10 repeat reviews; below that it says so instead of a dash) and **studied this month** is flashcard study time, the same amount as the daily goal's `flashcards:studyTime` and the Week tab's study time. With flashcards switched off the Summary widget says how to switch them on. Both **Summary** and **Reviews per day** can also be added to the home page.

- **Words** counts vocabulary cards only (sentence, writing and tone cards practise a word already counted): **New** (never reviewed), **Learning** (in the FSRS learning or relearning state), **Young** (in review, holding under 21 days) and **Mature** (21 days or more). "N new cards waiting" counts every new vocabulary card, without the daily limit. On Stats it adds a table with one row per deck; a card in several decks counts in each deck's row but once in the totals. These word states are not the character map's stages: a word's state follows its flashcard schedule, a character's stage its mastery score.
- **Reviews per day** shows the total and today's count in words above the bars of the last 30 learner days.
- **Reading time** counts the Reader's tracked time: all time and the last 7 and 30 learner days (ending today), and the five most read books. A stretch under 30 seconds counts nothing and one stretch at most 2 hours; a book no longer in any library is "A removed book".
- **Characters** shows "N of M learned" (learned is 80 of 100 or more), the stage bar and **Open the character map**.

The [Daily goal](Daily-goals) widget and the **This week** widget ([Weekly summary](Weekly-summary)) are on the home page only; Stats has the Week tab instead. A feature's widgets only appear while you have not switched that feature off (Settings → Features). The home page shows the widgets of your own layout (see [Settings tour](Settings-tour)).

## The activity heatmap

One cell per day over the last 52 weeks, coloured by points. A flashcard review is one point (a grade you changed with Back counts once); reading is one point per started 5 minutes (at most 24 for one stretch); journal entries and script practice answers also count, and a finished [grammar lesson](Grammar-lessons) is one point (each lesson once a day). Other events (sessions, views, lookups) do not count. Hover a cell for the day's points per source.

- It shows the active workspace by default; **All workspaces** switches to the combined view (tooltips name each workspace).
- A chip per activity type hides or shows that type. The choice is remembered per user on every device.
- Vacation days are hatched.
- Days are your learner's days in your time zone, not UTC dates ([Settings tour](Settings-tour)).
- Today's tile has a ring and its tooltip says "today".

### Layouts on the home page

On the home page the heatmap has three layouts; choose one under **Settings → Home** (on the Activity row). Stats always shows the garden grid.

- **Garden grid**: the last 52 weeks, one small tile per day (the default).
- **Month calendar**: one month with dates and bigger tiles. **Previous month** / **Next month** page through the last year; a line says on how many days of the month you reached your daily goal.
- **This week**: Monday to Sunday as seven large tiles with your amount under each ("21/50" with a daily goal, else the points) and what is left for today. The whole block opens Stats → Week.

### Flower stages

With a [daily goal](Daily-goals) in this workspace, each day has a flower stage: **Nothing yet** (nothing done), **Sprout** (under a third of the goal), **Bud** (a third or more), **Opening** (two thirds or more), **In bloom** (goal reached) or **Resting** (a vacation day). For now the stage is named in the tile's tooltip and in the screen-reader text ("21 of 50 — Bud"); the flower drawings come later, so the tiles show only the activity tint. Under **All workspaces** there are no stages (goals belong to one workspace).

## The character map

It lists every character of the language, studied or not, shaded by mastery. Japanese: all 13,108 KANJIDIC2 kanji. Chinese: about 11.1 thousand characters (the standard character list 通用规范汉字表 plus every character with a CC-CEDICT reading, single Han characters only). A traditional form shares its simplified character's cell: a card written 愛 colours the 爱 cell.

- **Grading**: what the map goes by, one at a time, saved for the workspace (on every device). The default is **HSK 3.0 (characters)** in a Chinese workspace and **JLPT kanji (approximate)** in a Japanese one; with neither installed (or when the grading you chose is uninstalled) it falls back to that default, else to Common (Chinese) or Grade (Japanese).
  - Japanese: Grade (with the jinmeiyō names and "No grade"), Frequency, Strokes, "JLPT kanji (approximate)" (N5 to N1) and, when an administrator installed the optional local JLPT vocabulary pack, "JLPT (vocabulary)".
- **Group by**: the default is Grade (Japanese) or Common (Chinese); the choice is remembered per language.
  - Japanese: Grade (with the jinmeiyō names and "No grade"), Frequency, Strokes, "JLPT kanji (approximate)" (N5 to N1) and "JLPT words (approximate)" (≈ N5 to ≈ N1: each kanji at the easiest estimated level of a word written with it).
  - Chinese: Common (GB2312 level 1, level 2, other standard characters, other characters in the dictionary), HK primary grade, Strokes, "HSK 3.0 (characters)" (the official character list of the HSK syllabus, each character at the level that introduces it) and "HSK 3.0 (words)" (the official word list), both HSK 1 to 6 and HSK 7 to 9.
  - A word list is shown as the characters its words are written with, each at the lowest level of a word it appears in (爱 is HSK 1 because 爱 is an HSK 1 word; 傲 is HSK 4 through 骄傲); for the HSK lists the two groupings agree on all but 3 of the 3,088 characters. Every other installed level scheme that is not a sample pack is offered under its name.
- **With a level list** (HSK, JLPT, any installed scheme) the map shows only the list's characters: the map, the stage counts and the "X of Y learned" summary cover only them.
  - **Study levels**: switch single levels off or on (HSK 1 to 3, say); the map then covers only those. At least one stays on. The set is saved per list, so going back to a list brings its set back.
  - **Include characters outside <the list>** (off by default) adds every other character as a last group, "Outside HSK 3.0 (characters)".
  - **Level** narrows within the study levels: All study levels, one of them, or the Outside group while it is shown. It is remembered on this device per workspace. A variant form of a member is included.
- **With a grouping** (Grade, Frequency, Strokes, Common, HK grade) every character is shown in the grouping's sections, as before; there are no study levels and no Level.
- Only the map follows the grading: level sessions, the level check, courses and the Characters widget on the home page do not.
- **Stages** use one hue, light to full: a not-studied character is an outline, then the accent at 14, 32, 58 and 100 % (not studied, started, growing, solid, learned), with a worded legend above the map. They double as a filter and the counts are in the filter's text. A character is "learned" at a score of 80 of 100. The score comes from the FSRS stability of every reviewed card whose word contains the character. Shape cues (a bottom bar that grows with the band, a corner tick and, in forced colours, a border style per stage) back the colour up.
- **Sections** show learned of total ("Grade 1, 60 of 80 learned") and a stacked stage bar; **Expand all** and **Collapse all** open and close them. Large sections draw their cells in batches as you scroll.
- **Search** by glyph, reading (toneless pinyin works), meaning, or hiragana and katakana; **Jump to character** opens its section and focuses the cell ("学 is in Grade 1").
- **Cells**: hover, focus or a first tap shows the character's reading, meaning, variants, stage, score and number of cards; a second tap opens its entry. The grid is keyboard-navigable: arrows, Home and End (row ends), Ctrl+Home and Ctrl+End (section ends); Enter opens the entry.
- **The score** is the mean, over every reviewed card whose word contains the character, of how firmly that card's schedule has settled, with a year of FSRS stability counting fully. Nothing is stored for the map: it is worked out from your cards and reviews.
- The Study setup links to the map ("View the mastery map →").
- A server seeded before the level fields existed shows a "Level data missing" banner until `qinqin seed` runs (see [Backup, recovery and the command line](Admin-backup-and-recovery)).

## Related

[Flashcards: study sessions](Flashcards-study-sessions), [Reader](Reader).
