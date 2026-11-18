# Backup, recovery and the command line

## Two kinds of backup

- **Per user**, in the app: Settings → Account → Your data ([Your data](Your-data)). It holds one person's study data and never secrets, passwords or packs. A restore needs a proxy body limit of at least 130 MB, like pack uploads.
- **Whole server**, administrators only: Settings → Admin → Backup, or `qinqin backup` from cron.

### Server backup in the app

Under **Include** choose the database, books, packs and audio, enter **Your password** (and an authenticator or recovery code if you use one), and **Create server backup**: a `qinqin-server-<date>.tar.gz` downloads. It holds `BACKUP-INFO.json` (checksums), `qinqin.db` (a consistent `VACUUM INTO` snapshot taken while the server runs), `books/`, `packs/` and `audio/`. It never holds `journal/`, `cache/`, `tmp/`, `backups/`, `packages/` or `fonts/`.

- **Data packages are rebuilt, not backed up**: after a restore the server builds them again at start, to the same revisions and content hashes, so clients keep the files they have.
- **Font packs**: their slices live in `/data/fonts`, which the archive does not include. Copy that folder yourself, or install the font packs again after a restore ([Data packs on the server](Admin-data-packs)).
- The snapshot needs free space on the data volume of the database size plus 64 MiB. One backup at a time, at most one a minute.

**The archive contains password hashes, hashed session tokens, and AI keys and the SMTP password sealed with `QINQIN_SECRET`; authenticator secrets are sealed with it too. Store it like the secret.**

### Scheduled backups with the CLI

`qinqin backup` opens the database read-only and never migrates, so it can run next to the server:

```sh
# --out is a path INSIDE the container; /data/backups is <your data volume or bind path>/backups on the host
docker exec <container> qinqin backup --out /data/backups/qinqin-$(date +%F).tar.gz
# host crontab, keep 14 days (/srv/qinqin/data is the host path mounted at /data):
0 3 * * * docker exec qinqin qinqin backup --out /data/backups/qinqin-$(date +\%F).tar.gz && find /srv/qinqin/data/backups -name 'qinqin-*.tar.gz' -mtime +14 -delete
```

- `--out -` writes to standard output; `--only db,books` limits the parts (`db`, `books`, `packs`, `audio`); `--data <dir>` names the data directory.
- When `--out` is on the data volume, the free-space check counts the archive as well as the snapshot (which is written to `/data/tmp` first).
- Run `docker exec` as the image's own user: with `-u root` the files in `/data/backups` and `/data/tmp` become root-owned and the server cannot clean them up.
- `/data/backups` is inside the data volume. Put it on a bind mount or its own volume if you want the archives outside it.

### Restoring a server backup (offline)

1. Stop the container.
2. Empty the data volume, then `tar xzf <file> -C /data`.
3. Start with the **same `QINQIN_SECRET`** and the same or a newer image.

Copying the whole volume of a stopped container also works, without the app. A book added while the backup ran may be left as an orphan file, a book deleted during it may lack its text.

Restoring without the same secret loses the sealed values: users enter AI keys again, the admin re-enters the SMTP password, and **users with an authenticator can no longer pass the second step**: they sign in with a recovery code, or you reset their two-step sign-in (Settings → Admin → Users).

A server backup is a copy of everything at that moment, so sessions and [access tokens](API-Access-tokens) revoked after it was taken come back with it. After restoring one, sign everyone out: in Settings → Admin → Users choose **Sign out everywhere** for each user (it ends their sessions and revokes their access tokens), yourself last; or turn on **Require two-factor authentication for everyone** with **Sign everyone else out now**, which ends every other session and revokes every access token (yours too) in one step. People then sign in again and make new tokens.

## Rotating `QINQIN_SECRET`

Put the old value into `QINQIN_SECRET_PREVIOUS`, set the new one in `QINQIN_SECRET`, and restart once. At start the AI keys, the SMTP password and the authenticator secrets sealed with the previous secret are re-encrypted with the new one (the log gives counts, for example `rotated 3 AI keys to the new QINQIN_SECRET`); then remove `QINQIN_SECRET_PREVIOUS`. A key sealed with a secret the server no longer knows shows as "enter it again" instead of failing. Keep the secret backed up separately from `/data`.

## The command line

Run these inside the container: `docker compose exec qinqin qinqin <command>`, or in the Portainer console (Containers, `qinqin`, Console, `/bin/sh`). Every command takes `--data <dir>` (default `$QINQIN_DATA`, which the image sets to `/data`).

| Command | Use |
|---|---|
| `qinqin serve [--addr :8080]` | The server; the default command of the image |
| `qinqin seed [--packs <dir>[,<dir>...]]` | Installs every pack found under the pack roots and builds their data packages. Idempotent: re-running replaces each pack's own rows only. Run it while the server is idle (a write waits at most 5 seconds). Under Docker it sees only the image's packs; mount extra folders and name all roots with `--packs` ([Deploying](Admin-deploying#what-qinqin-seed-does)). Run it again when an upgrade's log asks for it ([Upgrading](Admin-upgrading)) |
| `qinqin adduser --username <name> [--admin]` | Creates a user; asks for a password of 10 to 256 characters (needs a terminal) |
| `qinqin recover --username <name> [--enable] [--admin] [--reset-mfa]` | For a locked-out account: sets a new temporary password, which must be changed at the next sign-in, and ends every session of the account. The password comes from `QINQIN_PASSWORD` or one line of standard input; a terminal echoes what you type, so prefer the variable or a pipe. `--enable` re-enables a disabled account; `--admin` makes it an administrator (on a disabled account it needs `--enable`); `--reset-mfa` also removes the authenticator, the recovery codes and the email-code method. Pending reset links are cancelled |
| `qinqin backup --out <file or -> [--only db,books,packs,audio]` | The server archive, as above |

Example: `docker compose exec -e QINQIN_PASSWORD='a new temporary one' qinqin qinqin recover --username alice --reset-mfa`.
