# Your data: export and restore

Settings → Account → **Your data** lets every user download all their data and restore it, on this server or another one.

## Download my data

You get a zip of JSON files (format version 2). It contains: workspaces and settings, study history, flashcards and decks, vacation periods, limits and daily goals, word edits, personal notes on words, words you marked as known, your lookup history, your own sentences, library books with bookmarks and highlights, journal entries with their reviews, your open journal conversations and your journal settings, grammar lesson progress, FSRS parameter sets, the settings that follow your account (appearance, home layout, heatmap layout, reader display), your feature switches, the [milestones](Milestones) you have seen, your time-zone history and your interface language. The file is named `qinqin-<username>-<date>-<time>.zip`. The download link is a one-time ticket valid for 60 seconds, and you can make six downloads per hour.

It never contains: your password, email, sessions, access tokens, two-step secrets and recovery codes, AI keys, invites, the audit log, SMTP settings, the server secret, journal photo drafts, deleted rows, dictionary and pack content, or data packages. After moving to another server you enter your AI keys again.

The download is refused up front (`backup_too_large_to_restore`) if it could not be restored on this server: over 128 MiB zipped, 2 GiB expanded, or 64 MiB for one book.

### Lookup history

The [lookup history](Searching-and-entries#lookup-history) is in the download (with its words named, so a restore puts it on the same words on another server; words that server lacks are left out). **Clear history** deletes the history and the old search records of the workspace on the server, and filters it out of offline copies this browser saved earlier (offline study keeps working). It cannot reach copies you already downloaded, the safety exports a restore makes (kept at most seven days), backups your administrator made, or the database's free space until it is reused.

## Restore from a backup

Restore **replaces all** your data with the backup's, in one transaction: if it fails, nothing changes. Only backups of format 2 restore; a backup made before the plugins were retired (#199) is refused.

1. Choose the zip (at most 128 MiB). The server checks it.
2. Read the report of what is replaced and what comes back.
3. Confirm with your password (plus an authenticator or recovery code if you have one) and by typing your username.

Before anything changes the server saves your current data to a safety export (newest only, kept 7 days); the app links to it so you can undo a restore. Your other devices are signed out and reload. Your sign-in, password and two-step setup are never touched.

Words are matched by dictionary identity, not internal id, so a backup restores onto another server. Cards, reviews, edits, personal notes, known-word marks and sentences of words that server does not have are dropped, never guessed: the report lists them and you must tick "drop them". Install the dictionary and restore again to bring them back.

Limits and side effects:

- A restore holds the database's write lock for its whole transaction, roughly 30 seconds per million study events. Other users' saves wait and are retried by their clients.
- A backup with more than 2,000,000 events is refused (`backup_too_many_events`).
- Only one restore runs at a time on a server; a second gets `restore_busy` (HTTP 409) with `Retry-After`.
- Five restore uploads per hour.

## Whole-server backups

Administrators have a separate server backup; see [Backup, recovery and the command line](Admin-backup-and-recovery).

## For client implementers

The archive format, remapping rules and fixtures are in `docs/contracts/backup/`.
