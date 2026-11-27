# qinqin: next release

Notes collected for the next release; they move into its `vX.Y.Z.md` when it is cut.

## Upgrading

- Migration 055 rebuilds `feature_switches` without its list of feature ids (#294); every switch is kept. Nothing to do beyond the usual backup.

## Fixed

- Switching off the Scripts feature no longer fails with an error (#294).
- Settings → Data no longer scrolls sideways on a phone when a pack has a long id, attribution or package line; the admin tables (users, invites), the sessions and access-token tables and the language table scroll inside their own box instead of widening the page (#296).
- Android: the black "qinqin" bar at the top of the app is gone; the web app fills the screen up to the status bar (#283).
