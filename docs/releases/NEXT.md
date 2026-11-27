# qinqin: next release

Notes collected for the next release; they move into its `vX.Y.Z.md` when it is cut.

## Upgrading

- Migration 055 rebuilds `feature_switches` without its list of feature ids (#294); every switch is kept. Nothing to do beyond the usual backup.

## Fixed

- Switching off the Scripts feature no longer fails with an error (#294).
- Phone with the bottom bar: the top bar shows the qinqin logo, a link to Home, instead of the section's name, on every page (#293).
- Android: the black "qinqin" bar at the top of the app is gone; the web app fills the screen up to the status bar (#283).
