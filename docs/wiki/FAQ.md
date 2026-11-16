# FAQ

**Is there a cloud version?** No. qinqin is self-hosted: you or someone you trust runs the server.

**Who can see my data?** The server's administrator can read the database file and take server backups, which contain password hashes and secrets sealed with the server secret. Other users cannot see your data: your edits, sentences, books, highlights and journal are private to your account.

**What leaves the server?** Nothing by itself. AI text and photos leave only when you press an AI button, to the provider you made active. Reader imports contact Aozora Bunko or Gutenberg when you ask. Email goes through the server's own SMTP settings.

**Do I need an AI key?** No. Everything except the Journal's AI review, topic ideas and AI photo reading works without one. Offline photo reading (Tesseract) needs no key either. AI features have not yet been tested with real keys by the project owner.

**Why can I not register?** The default registration mode is closed. Ask an administrator for an account or an invite link.

**Can I use qinqin offline?** Partly: install it as an app over HTTPS and your decks and today's queue work offline. See [Install as an app and study offline](Install-and-offline).

**Is there an Android app?** Not yet. A native client is planned; its rules are the fixtures under `docs/contracts/`.

**Does a vacation hurt my streak?** No. Vacation days neither extend nor break it, and no reviews pile up ([Decks, limits and vacation](Flashcards-decks-limits-vacation)).

**Why does my "today" look wrong?** Set your time zone in Settings, Study.

**Can I move to another server?** Yes: download your data and restore it there ([Your data](Your-data)); administrators can move the whole server with a backup and the same `QINQIN_SECRET` ([Backup, recovery and the command line](Admin-backup-and-recovery)).

**A word is missing from the dictionary.** Dictionaries are packs. An administrator can install more; local-only packs are possible ([Data and licences](Data-and-licences)). Words missing when restoring a backup are reported and can be restored later.

**Are the HSK lists licensed?** They are included with attribution at the owner's decision; the legal status has not been verified ([Data and licences](Data-and-licences)).

**Can I downgrade?** No. Migrations are one-way. Keep a backup from before each upgrade.

**Where do I report a bug?** On the repository's GitHub issue tracker.
