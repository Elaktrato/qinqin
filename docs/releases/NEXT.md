# qinqin: next release

Notes collected for the next release; they move into its `vX.Y.Z.md` when it is cut.

## Upgrading

- Migration 055 rebuilds `feature_switches` without its list of feature ids (#294); every switch is kept. Nothing to do beyond the usual backup.

## New

- Study: hide romanisation everywhere (#284). Settings → Study → **Romanisation** has **Show pinyin** and **Show bopomofo**
  (Chinese) and **Show romaji** (Japanese), each Always or Never. A hidden one appears nowhere: word pages, search,
  the reader (popup, phone sheet, ruby), word lists, Stats, every flashcard kind and the kana trainer. On a card it is
  the last hint; Tones cards answer with tone numbers and contours; Starter mode starts at the kana or the
  characters. Searching by romaji or pinyin still works. Tone colours and furigana keep their own switches.

## Fixed

- Study: the study modal's "This session" is now the session's real length. A Word Salad, Cloze, Writing, Tone or
  Reverse card is planned only for words that can make one (the server checks before the session starts), so a
  Japanese deck without example sentences no longer counts down from 20 to "no cards" (#288). The home widget's
  "new left today" counts those cards too.
- Study: the study modal and Advanced settings only offer the card types that have something to study in the chosen
  decks or level, and say in one line why a type is left out (for example no example sentences yet); a hidden
  type keeps its saved choice and comes back when it has cards (#289).

- Switching off the Scripts feature no longer fails with an error (#294).
- Android: the black "qinqin" bar at the top of the app is gone; the web app fills the screen up to the status bar (#283).
