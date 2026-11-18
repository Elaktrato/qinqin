# Stats and the activity heatmap

**Stats** is the bar-chart icon in the top bar (in the menu drawer on a phone) of every signed-in page (`/stats`). It has up to three tabs.

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

The four summary numbers reuse rules defined elsewhere: the streak is the flashcards widget's streak, **words known** is the one known-word predicate (a manual "I know this" mark or a vocabulary card at the mastery threshold), **recall** is the decks page's overall 30-day figure (shown after 10 repeat reviews; below that it says so instead of a dash) and **studied this month** is flashcard study time, the same amount as the daily goal's `flashcards:studyTime` and the Week tab's study time. With flashcards switched off the Summary widget says how to switch them on. Both **Summary** and **Reviews per day** can also be added to the home page.

The [Daily goal](Daily-goals) widget and the **This week** widget ([Weekly summary](Weekly-summary)) are on the home page only; Stats has the Week tab instead. A plugin's widgets only appear while that plugin is enabled, and the flashcards and reader widgets while you have not switched that feature off (Settings → Features). The home page shows the widgets of your own layout (see [Settings tour](Settings-tour)).

## The activity heatmap

One cell per day over the last 13 weeks, coloured by points. A flashcard review is one point; reading is one point per started 5 minutes; journal entries also count. Hover a cell for the day's points per source.

- It shows the active workspace by default; **All workspaces** switches to the combined view (tooltips name each workspace).
- A chip per activity type hides or shows that type. The choice is remembered per user on every device.
- Vacation days are hatched.
- Days are your learner's days in your time zone, not UTC dates ([Settings tour](Settings-tour)).
- Today's tile has a ring and its tooltip says "today".

### Layouts on the home page

On the home page the heatmap has three layouts; choose one under **Settings → Home** (on the Activity row). Stats always shows the garden grid.

- **Garden grid**: the last 13 weeks, one small tile per day (the default).
- **Month calendar**: one month with dates and bigger tiles. **Previous month** / **Next month** page through the last year; a line says on how many days of the month you reached your daily goal.
- **This week**: Monday to Sunday as seven large tiles with your amount under each ("21/50" with a daily goal, else the points) and what is left for today. The whole block opens Stats → Week.

### Flower stages

With a [daily goal](Daily-goals) in this workspace, each day has a flower stage: **Nothing yet** (nothing done), **Sprout** (under a third of the goal), **Bud** (a third or more), **Opening** (two thirds or more), **In bloom** (goal reached) or **Resting** (a vacation day). For now the stage is named in the tile's tooltip and in the screen-reader text ("21 of 50 — Bud"); the flower drawings come later, so the tiles show only the activity tint. Under **All workspaces** there are no stages (goals belong to one workspace).

## The character map

It lists every character of the language, studied or not, shaded by mastery. Japanese: all KANJIDIC2 kanji. Chinese: about 11.1 thousand characters (the standard character list plus every character with a CC-CEDICT reading).

- **Group by**: Japanese: Grade, Frequency, Strokes, approximate JLPT kanji levels. Chinese: Common, HK primary grade, Strokes, HSK 3.0 characters and words. Any installed level scheme is offered too. The choice is remembered per language.
- **Stages** use one hue, light to full: a not-studied character is an outline, then the accent at 14, 32, 58 and 100 % (not studied, started, growing, solid, learned), with a worded legend above the map. They double as a filter and the counts are in the filter's text. A character is "learned" at a score of 80 of 100. The score comes from the FSRS stability of every reviewed card whose word contains the character. Shape cues (a bottom bar that grows with the band, a corner tick and, in forced colours, a border style per stage) back the colour up.
- Search by glyph, reading (toneless pinyin works), meaning, or kana. The grid is keyboard-navigable (arrows, Home, End; Enter opens the entry).
- A server seeded before the level fields existed shows a "Level data missing" banner until `qinqin seed` runs (see [Backup, recovery and the command line](Admin-backup-and-recovery)).

## Related

[Flashcards: study sessions](Flashcards-study-sessions), [Reader](Reader).
