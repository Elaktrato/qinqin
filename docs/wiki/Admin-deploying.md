# Deploying with Docker or Portainer

qinqin is a single container: a Go server with SQLite and the embedded web app, listening on port 8080. The authoritative instructions are the README sections "Quick start" and "Deploying with Portainer", and the files `docker-compose.yml` and `deploy/portainer-stack.yml`. This page summarises them.

## Images

CI publishes `ghcr.io/elaktrato/qinqin` on pushes to `main` and on `v*` tags. Tags are `latest` (newest `main` build), `v<version>` and `sha-<commit>`. For production pin a `v*` tag in `QINQIN_IMAGE`, so a redeploy never changes the version by surprise. The published image includes Tesseract OCR (about 193 MB) and the Kanji alive audio (about 70 MB); self-builds can leave them out with `--build-arg WITH_OCR=0` and `WITH_AUDIO=0`.

A new GitHub container package is private: `docker pull` fails with `unauthorized` until you make the package public, or give Portainer a registry login with a token that has only the `read:packages` scope.

## Docker Compose (quick start)

```sh
docker compose up -d
docker compose exec qinqin qinqin seed
docker compose exec qinqin qinqin adduser --admin --username you
```

Then open `http://localhost:8080`. Data lives in `./data` next to the compose file. If no reverse proxy sits in front, set `QINQIN_TRUSTED_PROXIES=none` ([Reverse proxy, rate limiting and trusted proxies](Admin-proxy-and-rate-limiting)).

Create the admin account **before** exposing the port beyond your LAN: while no user exists, the first registration over the API becomes the administrator, whoever makes it.

## Portainer

`deploy/portainer-stack.yml` differs from the quick-start file: a named volume instead of `./data`, a required `QINQIN_SECRET`, memory and CPU limits (1 GiB, 2 CPUs), log rotation and `no-new-privileges`. The image runs as root and writes to `/tmp`, so the root filesystem is not read-only.

1. Generate the secret and keep it in a password manager: `head -c 32 /dev/urandom | base64`. Back it up separately from the data volume; it is never written to `/data`.
2. Portainer, Stacks, Add stack: paste the file, or use the repository URL `https://github.com/Elaktrato/qinqin` with compose path `deploy/portainer-stack.yml`.
3. Set the environment variables ([Environment variables](Admin-environment-variables)): `QINQIN_SECRET` (required), `QINQIN_IMAGE`, `QINQIN_PORT`, optionally `QINQIN_DATA_VOLUME` as an absolute host path.
4. Before exposing the port: in the container console run `qinqin seed` and `qinqin adduser --username <name> --admin`. `seed` installs the bundled packs (about a minute; run it while nobody uses the app) and is idempotent.
5. Put a reverse proxy with HTTPS in front, then run the checklist below.

## Data directory

Everything is in `/data`: `qinqin.db` (with `-wal` and `-shm`), `packs/`, `audio/`, `books/<user id>/`, `journal/<user id>/` (photo drafts), `backups/`, `tmp/` (emptied at start) and `cache/sources/` (safe to delete). The bundled packs stay in the image.

## Checklist after deploying

- `curl http://<host>:<port>/healthz` answers `ok`.
- Sign in as the admin; search `好` and get results (the seed ran).
- The log shows `AI: QINQIN_SECRET ok` if you set a secret.
- Over HTTPS, `/service-worker.js` has `Cache-Control: no-cache` and `/manifest.webmanifest` is `application/manifest+json`.

## Upgrading

Back up first ([Backup, recovery and the command line](Admin-backup-and-recovery)). Change the tag in `QINQIN_IMAGE` and redeploy with "Pull latest image". Migrations are embedded and run at start. They are one-way: **downgrading is not supported**, and that includes running an older binary on an upgraded database; going back needs the pre-upgrade backup. (If a v0.3 binary did run on a v0.4 database, the flashcards rows it wrote are taken over at the next start of v0.4, except changes to rows v0.4 already holds.) After an upgrade the log may say `pack <id>: stored ... differs`: run `qinqin seed` to refresh. A backup taken before migration 032 contains old plaintext session tokens: keep it private and delete it after upgrading.

Upgrading from v0.1.0 or an early development database is not supported for entry data: start from a fresh data directory and seed again.

## Problems

[Troubleshooting](Troubleshooting).
