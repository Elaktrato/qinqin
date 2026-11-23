# Upgrading

## The routine

1. **Back up first** ([Backup, recovery and the command line](Admin-backup-and-recovery)). Read the release notes of the new version on the repository's Releases page.
2. Change the tag in `QINQIN_IMAGE` (or pull `latest`) and redeploy; in Portainer enable *Pull latest image*.
3. Read the container log of the first start. It tells you when a `qinqin seed` is due.

Database migrations are embedded in the binary and run automatically at start (`server/internal/db`). They are one-way. **Downgrading is not supported**: that includes running an older image on an upgraded database. Going back needs the backup you took before the upgrade.

## Log lines after an upgrade

| Log line | What to do |
|---|---|
| `pack <id>: stored license/attribution/notice differs from <manifest>; run "qinqin seed" to refresh` | The Sources page shows outdated pack terms. Run `qinqin seed` once. The check only reads; nothing changes until you seed, and the line goes away once the stored copies match. A pack it cannot read is skipped with a log line |
| `pack <id>: no licence texts stored; run "qinqin seed"` | The pack was installed before the server kept licence files, so its data package carries only the licence name and attribution. Run `qinqin seed` once: the package gets a new revision with the texts |
| `strokes: installed the bundled stroke data ...` | Normal on the first start of a release with data packages: the stroke-order data became a pack |
| `plugin registry rows that do not parse as manifests ...` | Only development databases: re-register or remove those plugin rows ([Plugin format](Plugin-format)) |
| `WARNING: this database has N user edit(s) and N flashcard(s) ...` (printed by `qinqin seed`) | The database holds data that refers to entries by id; see "From v0.1.0" below |

In the Portainer console the seed is `qinqin seed`; with plain compose `docker compose exec qinqin qinqin seed`.

## Notes per release

### To the release after v0.5.0

- **v0.3.x clients are no longer supported.** Before you upgrade, open the app online on every device (every browser and every installed copy) and let it finish syncing: a copy of the app from before v0.4.0 may hold reviews it cached offline and never sent, and the upgraded server no longer accepts them from that old copy. Afterwards nothing is lost.
- The old sync form (`GET /api/sync/pull` without `v=2`) is gone and answers 404; scripts use the paged pull ([API access tokens](API-Access-tokens)). The plugin-data routes no longer serve or accept cards, decks, deck settings, limits or FSRS sets under their old `qinqin-flashcards` keys.
- `GET /api/plugins` no longer lists a row per installed data pack. Every installed grammar pack now shows on the Grammar page (manage packs in Settings → Data).
- Personal backups from every earlier version, v0.3 included, still restore.
- `GET /api/admin/packs` (Settings → Data) no longer lists sentences imported before v0.2.0 without a registry row. If removing a language answers 409 "sentences from an older pack", the message names each such pack: remove it with `DELETE /api/admin/sentences/<pack>`.

### To v0.5.0

- No database migrations.
- Run `qinqin seed` once to install the new Chinese (≈ HSK) and Japanese (≈ JLPT) grammar packs: the first-start auto-seed runs only on a fresh instance. The old `zh-grammar-demo` pack stays installed until you uninstall it in Settings → Data ([Data packs on the server](Admin-data-packs)).
- An open tab of the old app counts both reviews of a changed grade until it is reloaded.

### To v0.4.0

- **Migration 038** moves the flashcards data (cards, decks, deck settings, daily limits, FSRS parameter sets and the active set) from plugin data into typed tables, keeping every card id, review, setting, version and stamp. Nothing is lost; a row no v0.3 client could read stays where it was. Open tabs of a cached v0.3 app keep reading and writing their cards until they are reloaded. Old `/p/flashcards` and `/p/reader` links redirect to `/flashcards` and `/reader`.
- A v0.3 personal backup restores on v0.4, and a v0.4 backup restores on v0.3: that is the way back for a user. Running the v0.3 binary on the upgraded database is unsupported; if it happened, the flashcards rows it wrote are taken over at the next v0.4 start, except changes to rows v0.4 already holds.
- **Migration 039 (data packages).** At the first start the server installs the image's stroke-order pack, then builds the data packages into `/data/packages` in the background: about a minute for Chinese and Japanese on a full seed; the app works meanwhile and Settings → Data says "Packages are being built". Plan disk space for them ([Data packs on the server](Admin-data-packs)). Packs installed before this release have no licence files stored: run `qinqin seed` once.
- **The sync pull no longer carries dictionary data.** Scripts that read the lexicon collections (`entries`, `links`, `senses`, `levelMembers`, `dictionaries`, `schemes`, `levels`) from `GET /api/sync/pull` now get 400 `sync_collection_moved` and must download the data packages instead ([API access tokens](API-Access-tokens)).
- **Migration 040** adds each user's interface language (empty: follow the browser).

### Migration 032 (hashed session tokens)

The database now stores only SHA-256 hashes of session tokens and zeroes the pages that held the old plaintext ones (including the write-ahead log once it is checkpointed). Nobody is signed out by it: idle sessions count as used at the upgrade time. **A backup taken before this upgrade still contains the plaintext tokens of that moment**: keep it as private as the database, and delete it once the upgrade is confirmed.

### Migration 024 (pack notices)

Adds a `notice` column to dictionaries, frequency packs and level schemes, empty for every installed pack. The Sources page shows a pack's longer caveats (the HSK lists' terms, the approximate JLPT levels, the Jiten note) from that stored copy, so they stay missing until you seed once after upgrading. The re-seed rewrites only the registry rows whose terms changed.

### The learner time zone (study day)

The release that introduced each account's time zone recomputes XP totals and best streaks from the review log with local days instead of UTC dates, so they can change once by a few points or days; the upgrade day may record one extra `session` event. The first time a user signs in afterwards the web app sends the browser's zone as the default, and that first zone applies to the whole history ([Settings tour](Settings-tour#study)).

### Migrations 018 to 023 (workspaces and the reader)

They run in place and keep all data. 018 rebuilds `workspaces` with an optional `name` and `UNIQUE(user_id, language, name)` (ids unchanged, so events and plugin data still point at their workspace). 019 adds `library_books.workspace_id`: each existing book is linked to its user's oldest workspace of the book's language, and one is created when the user has none. 020 adds bookmarks, 021 highlights. 022 and 023 rebuild `workspaces` and `library_books` with `AUTOINCREMENT`, so the id of a deleted workspace or book is never handed out again (a stale browser tab gets a 404 instead of writing into someone else's new workspace or book).

### From v0.1.0 or an early development database

Entry ids changed with the dictionary rebuild (migration 017 drops the legacy tables and moves no data). There is **no upgrade path for entry data**: start from a fresh data directory (or at least delete `qinqin.db`) and seed again. On an old database the restart and seed succeed without an error, but user edits and flashcards created before keep their old entry ids and point at different entries.

## Related

[Deploying with Docker or Portainer](Admin-deploying), [Troubleshooting](Troubleshooting).
