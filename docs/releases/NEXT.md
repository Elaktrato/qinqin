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

**Study**
- **Study all** includes every new card and due review; before, a deck without its own limits stopped at 20 new
  cards and 200 reviews (#175). A character level no longer plans a card type you removed.
- Offline preparation also saves the opt-in cards (reverse and the others) that your decks switch on (#157).
- One unreadable study row (saved by a newer version) no longer stops flashcards loading; it is skipped and
  never overwritten (#167).

**Reading**
- Lemmatizer rule tables are a data pack type, `lemma-rules`; the Japanese table ships as the `ja-lemma` pack.
  An installed table replaces the built-in one for its language. Tables are bounded, and the segment and lookup
  routes are rate-limited (#176).

**Accounts**
- Signing out, a lapsed session or a user switch in another tab clears every per-user cache in the browser
  (#173).

**Server and API**
- Every error answer is JSON `{error, message}` with a code from `docs/contracts/auth/errors.json` (#168).
- Clean shutdown: HTTP drains, then background work stops, then the database closes; an interrupted first-start
  seed finishes at the next start (#170, #171).
- The v0.3 compatibility layer is gone (#198): `GET /api/sync/pull` without `v=2` answers 404; cards, decks,
  deck settings, limits and FSRS sets are no longer served or accepted as `qinqin-flashcards` plugin data;
  `GET /api/plugins` lists real plugins only, with no row per installed data pack (#169). The contract
  changes are logged in `docs/contracts/CHANGELOG.md`.

## Known limits

- Nothing in this release was checked in a real browser or on a phone before tagging.
- The Android app is not part of this release.
