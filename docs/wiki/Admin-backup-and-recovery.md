# Backup, recovery and the command line

## Two kinds of backup

- **Per user**, in the app: Settings, Account, Your data ([Your data](Your-data)). Does not hold secrets, passwords or packs.
- **Whole server**, administrators only: Settings, Admin, Backup.

### Server backup in the app

Choose what to include (database, books, packs, audio), enter your password (and an authenticator or recovery code if you use one), and a `qinqin-server-<date>.tar.gz` downloads. It holds `BACKUP-INFO.json` (checksums), `qinqin.db` (a consistent snapshot taken while the server runs), `books/`, `packs/` and `audio/`; never `journal/`, `cache/`, `tmp/` or `backups/`. The snapshot needs free space of the database size plus 64 MiB. One at a time, one per minute.

**The archive contains password hashes, hashed session tokens, and AI keys and the SMTP password sealed with `QINQIN_SECRET`; authenticator secrets are sealed too. Store it like the secret.**

### Scheduled backups with the CLI

`qinqin backup` opens the database read-only and never migrates, so it can run next to the server:

```sh
docker exec <container> qinqin backup --out /data/backups/qinqin-$(date +%F).tar.gz
# host crontab, keep 14 days (/srv/qinqin/data is the host path of /data):
0 3 * * * docker exec qinqin qinqin backup --out /data/backups/qinqin-$(date +\%F).tar.gz && find /srv/qinqin/data/backups -name 'qinqin-*.tar.gz' -mtime +14 -delete
```

`--out -` writes to standard output; `--only db,books` limits the parts; `--data <dir>` names the data directory. `--out` is a path inside the container. Run `docker exec` as the image's own user: with `-u root` files in `/data/backups` become root-owned and the server cannot clean them up.

### Restoring a server backup (offline)

Stop the container, empty the data volume, `tar xzf <file> -C /data`, and start with the **same `QINQIN_SECRET`** and the same or a newer image. Restoring without the same secret loses the sealed values: users enter AI keys again, the admin re-enters SMTP, and users with an authenticator can no longer pass the second step (they use a recovery code, or you reset their two-step sign-in). Copying the whole volume of a stopped container also works.

A server backup is a copy of everything at that moment, so sessions and [access tokens](API-Access-tokens) that were revoked after it was taken come back with it. After restoring one, sign everyone out: in Settings, Admin, Users choose **Sign out everywhere** for each user (it ends their sessions and revokes their access tokens), yourself last; turning on "Require two-factor authentication for everyone" with "Sign everyone else out now" does the same for everyone but you in one step. People then sign in again and make new tokens.

## Rotating `QINQIN_SECRET`

Put the old value into `QINQIN_SECRET_PREVIOUS`, set the new one in `QINQIN_SECRET`, and restart once. On startup the keys sealed with the previous secret are re-encrypted with the new one; then remove `QINQIN_SECRET_PREVIOUS`. A key sealed with a secret the server no longer knows shows as "re-enter your key". Keep the secret backed up separately from `/data`.

## The command line

Run these inside the container (`docker compose exec qinqin qinqin <command>`, or the Portainer console). Commands: `serve` (the default), `seed`, `adduser`, `recover`, `backup`.

| Command | Use |
|---|---|
| `qinqin seed [--data <dir>] [--packs <dir>[,<dir>...]]` | Installs the bundled packs (dictionaries, frequency list, level lists). Idempotent: re-running replaces each pack's own rows and touches nothing else. Run it while the server is idle (a write waits at most 5 seconds). Under Docker it sees only the image's packs: mount `plugins/data-local` and pass `--packs /opt/qinqin/packs,/opt/qinqin/local` to include local-only packs. Run it again after upgrades that add pack data (the log tells you) |
| `qinqin adduser --username <name> [--admin] [--data <dir>]` | Creates a user; prompts for a password of 10 to 256 characters |
| `qinqin recover --username <name> [--enable] [--admin] [--reset-mfa] [--data <dir>]` | For a locked-out account. Sets a new password (from `QINQIN_PASSWORD` or standard input; a terminal echoes it, so prefer the variable or a pipe), which must be changed at the next sign-in; ends all of the account's sessions; `--admin` on a disabled account needs `--enable`; `--reset-mfa` also removes authenticator, recovery codes and email-code method |
| `qinqin backup --out <file or -> [--only db,books,packs,audio] [--data <dir>]` | Server archive, as above |

Pending reset links are cancelled by `recover`.
