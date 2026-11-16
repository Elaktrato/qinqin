# Your data: export and restore

Settings, Account, **Your data** lets every user download all their data and restore it, on this server or another one.

## Download my data

You get a zip of JSON files (format version 1). It contains: workspaces and settings, study history, flashcards and decks, vacation periods, limits and daily goals, word edits, personal notes on words, words you marked as known, your own sentences, library books with bookmarks and highlights, plugin switches and your time-zone history. The download link is a one-time ticket valid for 60 seconds, and you can make six downloads per hour.

It never contains: your password, email, sessions, access tokens, two-step secrets and recovery codes, AI keys, invites, the audit log, SMTP settings, the server secret, journal photo drafts, deleted rows, or dictionary and pack content. After moving to another server you enter your AI keys again.

The download is refused up front (`backup_too_large_to_restore`) if it could not be restored on this server: over 128 MiB zipped, 2 GiB expanded, or 64 MiB for one book.

## Restore from a backup

Restore **replaces all** your data with the backup's, in one transaction: if it fails, nothing changes.

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
