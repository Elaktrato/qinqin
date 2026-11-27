# qinqin: next release

Notes collected for the next release; they move into its `vX.Y.Z.md` when it is cut.

## Upgrading

- Migration 055 rebuilds `feature_switches` without its list of feature ids (#294); every switch is kept. Nothing to do beyond the usual backup.
- Migration 056 turns grammar lesson progress into study events (#277): each lesson's best score becomes one finished run at the time of its last run, then the `grammar_progress` table is dropped. What an upgrade loses: the run history before it is one run per lesson (the best one), and a progress row with an unreadable lesson id or time is dropped. The routes `GET/POST /api/grammar/progress` are gone. A backup made before the upgrade still restores; its lesson progress becomes the same runs.

## Changed

- Grammar lessons count like the rest of study (#277): a finished lesson is a point on the heatmap and in the weekly summary (each lesson once a day), can be a daily goal, earns 20 XP and keeps your streak going, also for the streak and days-active milestones. The best score of each lesson is worked out from your finished runs, and a run made offline is sent when you are back online.

## Fixed

- Study: the study modal's "This session" is now the session's real length. A Word Salad, Cloze, Writing, Tone or
  Reverse card is planned only for words that can make one (the server checks before the session starts), so a
  Japanese deck without example sentences no longer counts down from 20 to "no cards" (#288). The home widget's
  "new left today" counts those cards too.
- Study: the study modal and Advanced settings only offer the card types that have something to study in the chosen
  decks or level, and say in one line why a type is left out (for example no example sentences yet); a hidden
  type keeps its saved choice and comes back when it has cards (#289).

- Switching off the Scripts feature no longer fails with an error (#294).
- Settings → Data no longer scrolls sideways on a phone when a pack has a long id, attribution or package line; the admin tables (users, invites), the sessions and access-token tables and the language table scroll inside their own box instead of widening the page (#296).
- Reader on a phone: the lookup sheet takes at most about half the screen (55 %), so the text stays in view; a long entry scrolls inside the sheet (#282).
- Android: the black "qinqin" bar at the top of the app is gone; the web app fills the screen up to the status bar (#283).
