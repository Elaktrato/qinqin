# Deploying with Docker or Portainer

qinqin is one container: a Go server with a SQLite database and the embedded web app, listening on port 8080. The repository has **one compose file**, `docker-compose.yml`, for plain `docker compose up -d`, for Portainer (web editor, or Repository with compose path `docker-compose.yml`) and for anything else that reads standard compose. The comments at the top of that file list every variable; [Environment variables](Admin-environment-variables) explains them.

## Quick start with Docker Compose

You need Docker with the Compose plugin. In a checkout of the repository (or a folder holding only `docker-compose.yml`):

```sh
docker compose up -d
docker compose logs qinqin | grep 'bootstrap:'
```

On the first start the server creates the administrator `admin` before it opens the port and prints its password **once** in the log: `bootstrap: initial password (shown once, never again): <password>`. Open `http://localhost:8080`, sign in as `admin` with that password, and choose your own password (the server asks for it at once; nothing else works until you have). See [the bootstrap administrator](#the-bootstrap-administrator) below to pick the name or the password, or to create the admin yourself.

- **No reverse proxy in front?** Set `QINQIN_TRUSTED_PROXIES=none` (in a `.env` file next to `docker-compose.yml`, or in the stack's environment). The default trusts the `X-Forwarded-For` header of private-network peers, which a LAN client could forge to dodge the per-client sign-in limits ([Reverse proxy, rate limiting and trusted proxies](Admin-proxy-and-rate-limiting)).
- **The first start seeds itself.** Before it listens, a fresh instance installs the bundled packs (about 2 minutes, once; the health check waits up to 600 s). See [the auto-seed](#the-auto-seed-on-the-first-start) below.
- **Nobody becomes administrator by registering.** The bootstrap administrator exists before the port opens, and registration is closed by default.
- **Where the data lives.** In the named volume `qinqin-data`. Set `QINQIN_DATA_VOLUME=./data` (or an absolute path such as `/srv/qinqin/data`) to bind-mount a host directory instead. `QINQIN_PORT` changes the published port, `QINQIN_IMAGE` pins an image. `QINQIN_SECRET` is optional: empty means the AI features, authenticator apps and a stored mail password are unavailable, and everything else works ([AI providers and offline OCR](Admin-AI-and-OCR)).
- **Upgrading from the old quick start?** It kept the data in `./data`; the compose file now defaults to a named volume, so without a change you would start on an empty instance. Set `QINQIN_DATA_VOLUME=./data` to keep using it.

### The bootstrap administrator

While the instance has no users, each start creates an administrator before it opens the port; once users exist, nothing happens and nothing is logged, so the variables can stay set.

- **Name:** `admin`, or the value of `QINQIN_BOOTSTRAP_ADMIN` (3 to 32 letters, digits, `.`, `_`, `-`).
- **Password:** the value of `QINQIN_BOOTSTRAP_PASSWORD` (10 to 256 characters, not the username), which is never logged; or, when that is empty, 20 random characters printed **once** in the log (Portainer: Containers, `qinqin`, Logs; the line starts `bootstrap: initial password`). There is no fixed default password. Remove a supplied password from the stack after the first sign-in.
- **First sign-in:** the administrator must choose a new password; until then the session can do nothing else.
- **A name or password that breaks the rules** stops the server from starting, with the reason in the log.
- **Lost the logged password** before signing in? Run `qinqin recover --username admin` in the container ([Backup, recovery and the command line](Admin-backup-and-recovery)), or, on a still empty instance, delete the volume and start again.
- **Values that look like off** (`false`, `none`, `disabled`, `disable`, `no`, `0`, `n`, `nobody`, `null`, any case) stop the server with `use "off" to switch the bootstrap off`, so it never creates an administrator called `false`.
- **Creating the admin yourself:** set `QINQIN_BOOTSTRAP_ADMIN=off` and run `docker compose exec qinqin qinqin adduser --admin --username <name>` (it asks for the password). `--admin` matters: without it the account is an ordinary user. Until an administrator exists, registration stays closed and the log says so at every start.
- **Users but no active administrator** (an `adduser` without `--admin`, or the only administrator disabled): every start logs `bootstrap: users exist but no active administrator: ...`. Make one with `qinqin recover --username <name> --admin` (an existing account; it also sets a temporary password) or `qinqin adduser --admin --username <name>` (a new one); see [Backup, recovery and the command line](Admin-backup-and-recovery).

### The auto-seed on the first start

The first start of a fresh instance installs the bundled packs by itself before the server listens: the upstream dictionaries, the Jiten frequency list, the HSK 3.0 character, HSK 3.0 word and JLPT kanji level lists, the stroke data and the Kanji alive audio when present. It takes about 2.5 minutes (152 s measured on a busy machine with the v0.8.0 packs; the first start only), and the compose health check allows 600 s.

- It runs once per database and only on a fresh instance, that is while no pack of any type is installed. An upgraded or curated instance is never touched, and packs an administrator uninstalled stay uninstalled (a marker in the database records that it ran).
- It leaves out the demo pack `es-demo`.
- A pack that fails to import is logged (`auto-seed failed ...`); the server starts anyway and the next start tries again. The same holds when the container is stopped during the seed: the next start installs the bundled packs again (already installed ones are replaced as they are) and finishes.
- `QINQIN_AUTO_SEED=0` (or `false`, `off`) turns it off. Two packs install themselves at start even then, like before the setting existed: the stroke data when no strokes pack is installed, and the Japanese lemmatizer rules `ja-lemma` when it was never installed and no other Japanese rule table is (the server also updates an installed `ja-lemma` from a newer image; see [Data packs](Admin-data-packs#lemmatizer-rule-tables)). An uninstalled one stays uninstalled.

`qinqin seed` is for what the auto-seed does not do: the demo pack `es-demo` (it installs everything the image ships, demos included), local packs, and re-seeding after an image update that ships newer packs.

### What `qinqin seed` does

It installs the bundled packs from the image (CC-CEDICT, Unihan, JMdict, KANJIDIC2, the Jiten frequency list, the HSK 3.0 character and word lists, the jōyō grades, the 通用规范汉字表, the approximate JLPT kanji levels, the KanjiVG components, a small Spanish demo dictionary and a Chinese grammar demo, the Kanji alive audio when the image has it, and the stroke-order data), then builds their data packages before it returns. The whole bundle takes under a minute (about 45 s measured). It is idempotent: running it again replaces each pack's own rows and touches nothing else (an unchanged dictionary writes no rows; frequency rows are replaced).

Run it while the server is idle: each pack is one write transaction, JMdict holds the database write lock for about 20 s, and the server waits at most 5 s (`busy_timeout`) before a write fails. Packages it builds and those the running server builds take turns through a lock file, so a seed next to a running server is safe; the second one waits.

Options: `--data <dir>` (default `$QINQIN_DATA`, else `./data`) and `--packs <dir>[,<dir>...]` (pack roots, comma-separated or repeated; default `$QINQIN_PACKS`, which the image sets to its own packs). Under Docker the command sees only the image's packs, not a host folder such as `plugins/data-local`: mount it (for example `./plugins/data-local:/opt/qinqin/local:ro`) and run `qinqin seed --packs /opt/qinqin/packs,/opt/qinqin/audio,/opt/qinqin/strokes,/opt/qinqin/local`. More on packs: [Data packs on the server](Admin-data-packs).

### Stopping and restarting

`docker stop` (and `docker compose down`, a Portainer stop or redeploy) sends `SIGTERM`, and the server shuts down in order: it stops accepting connections, gives requests in flight 10 s to finish (a longer download is cut; the app resumes it), then stops the mail queue, any package build and other background jobs (up to 10 s more), closes the database and logs `shutdown complete`. The compose file allows 30 s (`stop_grace_period`) before Docker kills the container; keep at least that if you write your own. A second signal (Ctrl-C twice when running the binary by hand) exits at once.

What is cut short is safe: a package build in progress is started again on the next start, a pack upload still being imported, or a personal-backup restore still running, is cancelled and rolled back (one transaction; nothing of the pack is installed, so upload it again), and mails still queued are not sent (the log says how many; a reset or verification mail can be requested again). An AI review running after its browser left is lost and can be repeated.

The server also closes connections that take more than 10 s to send their request headers and keep-alive connections idle for 125 seconds. It sets no overall request timeout: uploads, downloads and long requests are limited by the proxy in front ([Reverse proxy](Admin-proxy-and-rate-limiting)).

## Release images and versions

CI publishes the image `ghcr.io/elaktrato/qinqin` on pushes to `main` and on `v*` tags; pushes to `develop` only run the tests. Image tags:

| Tag | What it is |
|---|---|
| `latest` | The newest build of `main` |
| `v<version>` | A release tag, for example `v0.6.0` |
| `sha-<commit>` | One exact commit |

**For production pin a `v*` tag** in `QINQIN_IMAGE` rather than `latest`, so a redeploy never changes the version by surprise.

Every `v*` tag also gets a **GitHub Release** on the repository's Releases page, created automatically once the image is pushed. Its text is `docs/releases/<tag>.md` when that file exists, otherwise GitHub's generated notes; a tag with a hyphen (for example `v0.6.0-rc1`) becomes a pre-release. Read a release's notes before upgrading to it ([Upgrading](Admin-upgrading)).

The published image is the full build:

- Tesseract OCR with the Chinese, Japanese and English models (about +193 MB), for reading journal photos offline.
- The Kanji alive example-word audio (about +70 MB, 10,156 Japanese clips, CC BY 4.0).
- The stroke-order data pack (`/opt/qinqin/strokes`, about 13 MB). It is a pack, not part of the web app, whose build shrank from about 50 MB to about 3 MB.
- The Japanese stroke-order pack (`/opt/qinqin/kanjivg`, about 7 MB, KanjiVG, CC BY-SA 3.0), cloned at image build from a pinned commit; `--build-arg WITH_KANJIVG=0` leaves it out (the kana Write mode then stays hidden).

Self-builds can leave the first two out with `docker build --build-arg WITH_OCR=0 .` and `--build-arg WITH_AUDIO=0`; the server starts normally and the features show as unavailable. Details in [AI providers and offline OCR](Admin-AI-and-OCR) and [Development](Development).

The project's package `ghcr.io/elaktrato/qinqin` is public: `docker pull` needs no login. Check from the server with `docker pull ghcr.io/elaktrato/qinqin:v0.6.0`.

**Your own fork's package starts private.** GitHub creates a new container package as private, so a `docker pull` or a Portainer deployment of an image your fork's CI published fails with `unauthorized` until you either

- make the package public: GitHub profile, Packages, `qinqin`, Package settings, Change visibility, Public; or
- keep it private and give Portainer a login: Registries, Add registry, GitHub Container Registry, your GitHub username and a personal access token with only the `read:packages` scope; then select that registry when you create the stack.

## Deploying with Portainer

Portainer needs no special file: `docker-compose.yml` is plain compose. It uses a named volume (relative bind mounts depend on where Portainer checks the stack out), rotates the logs (3 files of 10 MB) and sets `no-new-privileges`. It sets neither `user:` nor `read_only:`: the image has no `USER` (it runs as root) and the server writes temporary files to `/tmp` (OCR input, pack uploads and staging), so a read-only root filesystem is not enabled. Memory and CPU caps are in the file, commented out on purpose: the first seed and OCR can need more than a guessed limit, and an out-of-memory kill during setup is worse than none. Measure first.

**Upgrading an old stack:** a stack that used the compose path `deploy/portainer-stack.yml` must change it to `docker-compose.yml` (the old file no longer exists). The variables are the same, and `QINQIN_SECRET` is now optional.

1. **Generate the secret** (optional; without it AI, authenticator apps and a stored mail password are unavailable) and keep it in a password manager: `head -c 32 /dev/urandom | base64`. Back it up **separately** from the data volume; it is never written to `/data`.
2. **Add the stack.** Portainer: Stacks, Add stack. Either *Web editor* and paste `docker-compose.yml`, or *Repository* with the URL `https://github.com/Elaktrato/qinqin`, reference `refs/heads/main` (or a tag) and compose path `docker-compose.yml`.
3. **Environment variables** (stack form): `QINQIN_SECRET`, `QINQIN_IMAGE` (for example `ghcr.io/elaktrato/qinqin:v0.6.0`), `QINQIN_PORT` (host port, default 8080). Optional: `QINQIN_DATA_VOLUME` as an absolute host path such as `/srv/qinqin/data` (the directory must exist and be writable by root), `QINQIN_TRUSTED_PROXIES` (**`none` if nothing reverse-proxies to qinqin**), `QINQIN_AI_PROVIDERS`, `QINQIN_AI_ALLOW_PRIVATE`, `QINQIN_SMTP_ALLOW_PRIVATE`, `QINQIN_BOOTSTRAP_ADMIN` and `QINQIN_BOOTSTRAP_PASSWORD` ([the bootstrap administrator](#the-bootstrap-administrator)), and `QINQIN_SECRET_PREVIOUS` only while rotating the secret. The full list: [Environment variables](Admin-environment-variables). Deploy the stack.
4. **First sign-in.** Containers, `qinqin`, Logs: the line `bootstrap: initial password (shown once, never again): ...` holds the password of the administrator `admin` (or of `QINQIN_BOOTSTRAP_ADMIN`; with `QINQIN_BOOTSTRAP_PASSWORD` set, that password, which is not logged). Sign in and choose a new password. The first start has already installed the bundled packs before it opened the port ([the auto-seed](#the-auto-seed-on-the-first-start)); the demo packs are not installed, `qinqin seed` adds them and local packs.

   **Or create the admin yourself.** Set `QINQIN_BOOTSTRAP_ADMIN=off` before the first start, then Containers, `qinqin`, Console, command `/bin/sh`, Connect, and run `qinqin adduser --username <name> --admin` (with `--admin`, or the account is an ordinary user). `adduser` asks for the password and needs a terminal; Portainer's console provides one (the typed password is echoed). Until then registration stays closed.
5. Put a reverse proxy with HTTPS in front ([Reverse proxy, rate limiting and trusted proxies](Admin-proxy-and-rate-limiting)), then run the checklist below.

## Data directory

Everything lives in `/data` (the volume):

| Path | Content |
|---|---|
| `qinqin.db` (with `-wal` and `-shm`) | The SQLite database: users, entries, dictionaries, flashcards, journal, grammar progress, settings rows |
| `packs/` | Packs an administrator installed through the web app (`packs/<type>/<id>/<version>/`); staged uploads wait in `packs/.stage-<token>/` |
| `audio/` | Audio clips imported by `seed` or audio packs |
| `fonts/` | The WOFF2 slices of installed font packs |
| `packages/` | Data packages clients download (`<id>/r<revision>.qqpkg`), built by the server; not backed up, rebuilt at start when missing |
| `books/<user id>/` | Uploaded and imported library books |
| `journal/<user id>/` | Photos of open journal drafts, deleted when the draft ends |
| `backups/` | Safety exports taken before a personal restore (`backups/pre-restore/<user id>/`) and, if you choose, CLI backups |
| `tmp/` | Staged restore uploads and database snapshots; emptied at start |
| `cache/sources/` | Cache of the Aozora Bunko and Gutenberg imports; safe to delete |

The bundled packs themselves stay in the image (`/opt/qinqin/packs`, `/opt/qinqin/audio`, `/opt/qinqin/strokes`, `/opt/qinqin/kanjivg`). At start the server also removes the book and photo folders of users that no longer exist.

`packages/` grows with the installed packs: one file per package, roughly the size of the pack's data compressed (CC-CEDICT's `lexicon.zh` is about 15 MB, the stroke data about 13 MB, an audio pack its clips), and a replaced revision is kept 7 days so clients can finish a download. See [Data packs on the server](Admin-data-packs).

## Checklist after deploying

- `curl http://<host>:<port>/healthz` answers `ok`; Portainer shows the container `healthy` (the compose healthcheck runs `wget` against `/healthz` every 30 s, with a 600 s start period that covers the first start's auto-seed).
- Sign in as the admin from step 4.
- Search `好`: results appear (the first-start seed ran).
- Create a deck and a flashcard.
- If you set `QINQIN_SECRET`, the container log shows `AI: QINQIN_SECRET ok`. With `QINQIN_AI_PROVIDER` unset, Settings → AI lists the providers and shows a key as storable; saving a key makes it the active provider, and a journal review works.
- Over HTTPS, `curl -sI https://<host>/service-worker.js` shows `Cache-Control: no-cache` and a JavaScript content type, and `/manifest.webmanifest` is `application/manifest+json`. A proxy that caches or rewrites them breaks installing the app and updates.
- Settings → Data lists the installed packs, each with its data package ("revision …, ready"); right after the first start it may say "Packages are being built" for about a minute.

## Next

[Upgrading](Admin-upgrading), [Backup, recovery and the command line](Admin-backup-and-recovery), [Troubleshooting](Troubleshooting).
