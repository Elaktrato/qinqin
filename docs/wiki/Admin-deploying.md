# Deploying with Docker or Portainer

qinqin is a single container: a Go server with SQLite and the embedded web app, listening on port 8080. The authoritative instructions are the README sections "Quick start" and "Deploying with Portainer", and the file `docker-compose.yml`. This page summarises them.

## Images

CI publishes `ghcr.io/elaktrato/qinqin` on pushes to `main` and on `v*` tags. Tags are `latest` (newest `main` build), `v<version>` and `sha-<commit>`. For production pin a `v*` tag in `QINQIN_IMAGE`, so a redeploy never changes the version by surprise. The published image includes Tesseract OCR (about 193 MB) and the Kanji alive audio (about 70 MB); self-builds can leave them out with `--build-arg WITH_OCR=0` and `WITH_AUDIO=0`. Stroke-order data is a pack in the image (`/opt/qinqin/strokes`, about 13 MB), no longer part of the web app.

A new GitHub container package is private: `docker pull` fails with `unauthorized` until you make the package public, or give Portainer a registry login with a token that has only the `read:packages` scope.

## Docker Compose (quick start)

```sh
docker compose up -d
docker compose exec qinqin qinqin adduser --admin --username you
```

Then open `http://localhost:8080`. Data lives in the named volume `qinqin-data`. Upgrading from the old quick start, which used `./data`? Set `QINQIN_DATA_VOLUME=./data` to keep using it, or you start on an empty instance. If no reverse proxy sits in front, set `QINQIN_TRUSTED_PROXIES=none` ([Reverse proxy, rate limiting and trusted proxies](Admin-proxy-and-rate-limiting)).

The first start installs the bundled packs by itself before it listens (about 2 minutes; the health check waits up to 300 s). Create the admin account **before** exposing the port beyond your LAN: while no user exists, the first registration over the API becomes the administrator, whoever makes it.

## Portainer

Portainer uses the same `docker-compose.yml` (plain compose): a named volume, log rotation and `no-new-privileges`; memory and CPU caps are commented out in the file. The image runs as root and writes to `/tmp`, so the root filesystem is not read-only. Stacks that used the compose path `docker-compose.yml` must change it to `docker-compose.yml`.

1. Generate the secret and keep it in a password manager: `head -c 32 /dev/urandom | base64`. Back it up separately from the data volume; it is never written to `/data`.
2. Portainer, Stacks, Add stack: paste `docker-compose.yml`, or use the repository URL `https://github.com/Elaktrato/qinqin` with compose path `docker-compose.yml`.
3. Set the environment variables ([Environment variables](Admin-environment-variables)): `QINQIN_SECRET` (optional; empty = AI off), `QINQIN_IMAGE`, `QINQIN_PORT`, optionally `QINQIN_DATA_VOLUME` as an absolute host path.
4. Before exposing the port: in the container console run `qinqin adduser --username <name> --admin`. The first start has already installed the bundled packs (about 2 minutes, before the port opens). This auto-seed runs once, only while no pack is installed, and leaves out the demo pack `es-demo`; it logs `auto-seed failed` and retries at the next start if a pack fails, and `QINQIN_AUTO_SEED=0` turns it off. `qinqin seed` (idempotent; run it while nobody uses the app) installs everything the image ships, demos included, and is how you add local packs or refresh after an image update.
   Instead of `adduser` you can set `QINQIN_BOOTSTRAP_ADMIN` (and optionally `QINQIN_BOOTSTRAP_PASSWORD`): the first start then creates that admin, who must set a new password at the first sign-in. Without a password the server generates one and prints it once in the container log (Portainer: Containers, `qinqin`, Logs). Later starts ignore both variables.
5. Put a reverse proxy with HTTPS in front, then run the checklist below.

## Data directory

Everything is in `/data`: `qinqin.db` (with `-wal` and `-shm`), `packs/`, `audio/`, `packages/`, `books/<user id>/`, `journal/<user id>/` (photo drafts), `backups/`, `tmp/` (emptied at start) and `cache/sources/` (safe to delete). The bundled packs stay in the image.

`packages/` holds the data packages clients download (`<id>/r<revision>.qqpkg`): one per language lexicon and per installed pack, built by the server from the database after every pack install or removal and at start. The first start builds them all in the background (about a minute for Chinese and Japanese; the app works meanwhile). Plan disk space roughly the size of the installed data compressed (CC-CEDICT's lexicon is about 15 MB, the stroke data about 13 MB, the audio pack its clips); a replaced revision is kept 7 days. Builds take turns through the lock file `packages/.lock`, so `qinqin seed` may run while the server runs (the one that comes second waits). The directory is not backed up: a restored server rebuilds it.

## Checklist after deploying

- `curl http://<host>:<port>/healthz` answers `ok`.
- Sign in as the admin; search `好` and get results (the first-start seed ran).
- The log shows `AI: QINQIN_SECRET ok` if you set a secret.
- Over HTTPS, `/service-worker.js` has `Cache-Control: no-cache` and `/manifest.webmanifest` is `application/manifest+json`.

## Upgrading

Back up first ([Backup, recovery and the command line](Admin-backup-and-recovery)). Change the tag in `QINQIN_IMAGE` and redeploy with "Pull latest image". Migrations are embedded and run at start. They are one-way: **downgrading is not supported**, and that includes running an older binary on an upgraded database; going back needs the pre-upgrade backup. (If a v0.3 binary did run on a v0.4 database, the flashcards rows it wrote are taken over at the next start of v0.4, except changes to rows v0.4 already holds.) After an upgrade the log may say `pack <id>: stored ... differs`: run `qinqin seed` to refresh. Upgrading to data packages (migration 039): the first start installs the image's stroke-order pack (log: `strokes: installed the bundled stroke data ...`) and builds `packages/`; the log line `pack <id>: no licence texts stored; run "qinqin seed"` means a pack was installed before licence files were kept: run `qinqin seed` once so its package carries them (a new revision). Scripts that read dictionary collections from the sync pull must switch to packages ([API access tokens](API-Access-tokens)). A backup taken before migration 032 contains old plaintext session tokens: keep it private and delete it after upgrading.

Upgrading from v0.1.0 or an early development database is not supported for entry data: start from a fresh data directory and seed again.

## Problems

[Troubleshooting](Troubleshooting).
