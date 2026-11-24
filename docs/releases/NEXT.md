# qinqin (next release, draft)

Draft notes for the release after v0.5.0; rename this file to `docs/releases/v<version>.md` when the tag is
made (the release workflow reads only `docs/releases/<tag>.md`). Documentation:
https://github.com/Elaktrato/qinqin/wiki

## Upgrading

- **Fresh installs now create an administrator by themselves** (#211): the first start creates `admin` (or
  `QINQIN_BOOTSTRAP_ADMIN`) before it opens the port and prints a one-time password in the log
  (`bootstrap: initial password ...`), or uses `QINQIN_BOOTSTRAP_PASSWORD`; it must be changed at the first
  sign-in. The first registration no longer becomes the administrator: an empty instance follows its
  registration mode (default closed). To create the admin with `qinqin adduser --admin` instead, set
  `QINQIN_BOOTSTRAP_ADMIN=off`. Existing instances are not affected: they have users, so nothing is created
  and nothing is logged. A previously empty `QINQIN_BOOTSTRAP_ADMIN` used to mean off; it now means `admin`.

- **v0.3.x clients are no longer supported.** The server no longer answers the old sync form or the old
  flashcards keys that a copy of the app from before v0.4.0 used (#198).
- **Before you upgrade, open the app online on every device** — every browser and every installed copy — and
  let it sync, so reviews an old copy cached offline are sent first. Afterwards nothing is lost. Reviews that a
  copy from before v0.4.0 cached and never sent are **never** sent once the server is upgraded, even when that
  browser opens the upgraded app online later: the new app does not read the old copy's queue.
- **The upgrade wipes** the admin-registered plugins and every plugin's order and settings, the plugin data of
  plugins other than the core features, journal entries, reviews, topic ideas and settings and grammar progress
  that do not convert cleanly, and decks copied from a plugin deck lose that origin (#199); personal backups made
  before this version no longer restore (backup format 2), so make a new one after upgrading.
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

**Journal**
- **Conversation partner:** chat with the AI in your workspace's language at your level, on your own key (Journal →
  Talk with the AI). Your messages get the journal's corrections, the partner's replies have the reader's lookup
  popup with +, and a conversation is saved as a journal entry or discarded (#185).

**Dictionary**
- **AI examples:** a word with few example sentences offers **Generate examples**: your own AI provider writes
  some at your level, with a reading and a translation. The server keeps only sentences that contain the word (a
  conjugated Japanese verb counts) in the right script; you keep, delete or report each one. Kept ones are marked
  AI-written on the entry and on every card, feed your Word Salad and cloze cards, and are yours alone (#186).

**Reading**
- Lemmatizer rule tables are a data pack type, `lemma-rules`; the Japanese table ships as the `ja-lemma` pack.
  An installed table replaces the built-in one for its language. Tables are bounded, and the segment and lookup
  routes are rate-limited (#176).

**Accounts**
- **A fresh install creates its administrator** (`admin`, with a one-time password in the log) before it opens the
  port, so nobody can claim the instance by registering first; `QINQIN_BOOTSTRAP_ADMIN=off` leaves it to
  `qinqin adduser --admin` (#211).
- **Profile pictures** (#189): upload a picture in Settings → Account (on a phone from the photo picker, or
  **Take a photo** with the front camera), crop it to a square, replace or remove it. It shows in the top bar, the account menu and the admin user
  list; the letter stays where there is none. The server re-encodes every upload, so no location or camera data is
  kept. Administrators can remove a picture (audited). Pictures are in personal and server backups.
- Signing out, a lapsed session or a user switch in another tab clears every per-user cache in the browser
  (#173).

**Core features instead of plugins (#199)**
- There are no plugins any more: flashcards, the reader, the journal and grammar are core features, each with
  its own switch in Settings → Features (Settings → Plugins is gone). The journal lives at `/journal` and
  grammar at `/grammar`; old `/p/journal` and `/p/grammar` links still land there.
- Grammar keeps your best score on the server, so two tabs finishing a lesson can no longer lower it.
- What a language offers (tone cards, word counts in the reader, the Characters tab, script variants) comes
  from one language profile; a regional tag such as `zh-TW` now gets everything Chinese has.
- The journal's entry box stops at the server's limit (50,000 characters) instead of failing to save.

**Server and API**
- Every error answer is JSON `{error, message}` with a code from `docs/contracts/auth/errors.json` (#168).
- Clean shutdown: HTTP drains, then background work stops, then the database closes; an interrupted first-start
  seed finishes at the next start (#170, #171).
- The v0.3 compatibility layer is gone (#198): `GET /api/sync/pull` without `v=2` answers 404; cards, decks,
  deck settings, limits and FSRS sets are no longer served or accepted as `qinqin-flashcards` plugin data (#169).
- The plugin routes are gone (#199): `/api/plugins`, `/api/plugins/{id}/state`, `/api/plugins/{id}/data/…` and
  `POST /api/admin/plugins`. New: `/api/features`, `/api/rows`, `/api/journal/*`, `/api/grammar/progress`. The
  contract changes are logged in `docs/contracts/CHANGELOG.md`.

## Known limits

- Nothing in this release was checked in a real browser or on a phone before tagging.
- The Android app is not part of this release.
