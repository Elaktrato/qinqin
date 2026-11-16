# Stats and the activity heatmap

**Stats** is in the footer of every signed-in page (`/stats`). It has two tabs.

- **Overview** shows every widget that applies to the current workspace, in a fixed order (core first, then plugins).
- **Characters** (`/stats/characters`) is the mastery map. It exists only in Chinese and Japanese workspaces; elsewhere the tab is hidden and a direct visit explains why. The old address `/study/map` redirects here.

## Widgets

| Widget | What it shows | Languages |
|---|---|---|
| Activity | The heatmap | all |
| Characters | "N of M learned" and the stage bar, with a link to the map | Chinese, Japanese |
| Flashcards | What is due and new, level and XP, streak, study buddy | all |
| Words | How far each word has come: New, Learning, Young (under 21 days), Mature; one row per deck | all |
| Reading time | Total, last 7 and last 30 days, five most read books | all |

The [Daily goal](Daily-goals) widget is on the home page only. A plugin's widgets only appear while that plugin is enabled. The home page shows the widgets of your own layout (see [Settings tour](Settings-tour)).

## The activity heatmap

One cell per day over the last 13 weeks, coloured by points. A flashcard review is one point; reading is one point per started 5 minutes; journal entries also count. Hover a cell for the day's points per source.

- It shows the active workspace by default; **All workspaces** switches to the combined view (tooltips name each workspace).
- A chip per activity type hides or shows that type. The choice is remembered per user on every device.
- Vacation days are hatched.
- Days are your learner's days in your time zone, not UTC dates ([Settings tour](Settings-tour)).

## The character map

It lists every character of the language, studied or not, shaded by mastery. Japanese: all KANJIDIC2 kanji. Chinese: about 11.1 thousand characters (the standard character list plus every character with a CC-CEDICT reading).

- **Group by**: Japanese: Grade, Frequency, Strokes, approximate JLPT kanji levels. Chinese: Common, HK primary grade, Strokes, HSK 3.0 characters and words. Any installed level scheme is offered too. The choice is remembered per language.
- **Stages** (grey, red, amber, blue, green: not studied, started, growing, solid, learned) double as a filter. A character is "learned" at a score of 80 of 100. The score comes from the FSRS stability of every reviewed card whose word contains the character. Non-colour markers (a tick, a dashed outline) back the colours up.
- Search by glyph, reading (toneless pinyin works), meaning, or kana. The grid is keyboard-navigable (arrows, Home, End; Enter opens the entry).
- A server seeded before the level fields existed shows a "Level data missing" banner until `qinqin seed` runs (see [Backup, recovery and the command line](Admin-backup-and-recovery)).

## Related

[Flashcards: study sessions](Flashcards-study-sessions), [Reader](Reader).
