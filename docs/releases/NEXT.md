# qinqin (next release, draft)

Draft notes for the release after v0.5.0; rename this file to `docs/releases/v<version>.md` when the tag is
made (the release workflow reads only `docs/releases/<tag>.md`). Documentation:
https://github.com/Elaktrato/qinqin/wiki

## Upgrading

- **v0.3.x clients are no longer supported.** The server no longer answers the old sync form or the old
  flashcards keys that a copy of the app from before v0.4.0 used (#198).
- **Before you upgrade, open the app online on every device** — every browser and every installed copy — and
  let it sync, so reviews an old copy cached offline are sent first. Afterwards nothing is lost. Reviews that a
  copy from before v0.4.0 cached and never sent are **never** sent once the server is upgraded, even when that
  browser opens the upgraded app online later: the new app does not read the old copy's queue.
- Personal backups from every earlier version, v0.3 included, still restore.
- Every installed grammar pack now shows on the Grammar page; manage packs in Settings → Data.
- Settings → Data (`GET /api/admin/packs`) no longer lists sentences imported before v0.2.0 without a registry
  row. Removing a language that still has such sentences answers 409 naming each pack and its removal route,
  `DELETE /api/admin/sentences/<pack>`.

## What's new

**Server and API**
- The v0.3 compatibility layer is gone (#198): `GET /api/sync/pull` without `v=2` answers 404; cards, decks,
  deck settings, limits and FSRS sets are no longer served or accepted as `qinqin-flashcards` plugin data;
  `GET /api/plugins` lists real plugins only, with no row per installed data pack (#169). The contract
  changes are logged in `docs/contracts/CHANGELOG.md`.

## Known limits

- Nothing in this release was checked in a real browser or on a phone before tagging.
- The Android app is not part of this release.
