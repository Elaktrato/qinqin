# qinqin: next release

Notes collected for the next release; they move into its `vX.Y.Z.md` when it is cut.

## Upgrading

- Migration 055 rebuilds `feature_switches` without its list of feature ids (#294); every switch is kept. Nothing to do beyond the usual backup.
- Migration 056 turns grammar lesson progress into study events (#277): each lesson's best score becomes one finished run at the time of its last run, then the `grammar_progress` table is dropped. What an upgrade loses: the run history before it is one run per lesson (the best one), and a progress row with an unreadable lesson id or time is dropped. The routes `GET/POST /api/grammar/progress` are gone. A backup made before the upgrade still restores; its lesson progress becomes the same runs.

## Changed

- Grammar lessons count like the rest of study (#277): a finished lesson is a point on the heatmap and in the weekly summary (each lesson once a day), can be a daily goal, earns 20 XP and keeps your streak going, also for the streak and days-active milestones. The best score of each lesson is worked out from your finished runs, and a run made offline is sent when you are back online.

## Fixed

- Switching off the Scripts feature no longer fails with an error (#294).
- Android: the black "qinqin" bar at the top of the app is gone; the web app fills the screen up to the status bar (#283).
