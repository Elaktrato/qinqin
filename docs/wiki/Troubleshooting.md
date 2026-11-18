# Troubleshooting

Check the container log first (Portainer: Containers, `qinqin`, Logs; or `docker compose logs qinqin`): it never contains passwords, tokens, keys or addresses. Administrator problems first, then what users see.

## Deploying and starting

| Symptom | Cause and fix |
|---|---|
| `docker pull` or the Portainer deployment fails with `unauthorized` | The image package on GitHub is private: make it public, or give Portainer a registry login with a `read:packages` token ([Deploying](Admin-deploying#release-images-and-versions)) |
| Portainer cannot find `deploy/portainer-stack.yml` | That file is gone; set the stack's compose path to `docker-compose.yml` |
| A fresh install starts empty after an upgrade of the old quick start | The data was in `./data`; set `QINQIN_DATA_VOLUME=./data` |
| Container keeps restarting | Read its log. A bad host path in `QINQIN_DATA_VOLUME`, or no write permission (`create data directory ...`): fix the ownership (the image runs as root). `QINQIN_TRUSTED_PROXIES: ...`: a malformed value. `QINQIN_BOOTSTRAP_ADMIN: ...` or `QINQIN_BOOTSTRAP_PASSWORD: ...`: the bootstrap username or password breaks the rules (3 to 32 letters, digits, `.`, `_`, `-`; a password of 10 to 256 characters, not the username) |
| The bootstrap admin's generated password is lost | It is printed once (`bootstrap: initial password ...`) on the first start only. If nobody has signed in, run `qinqin recover --username <name>` to set a new temporary one |
| "port is already allocated" | Change `QINQIN_PORT` |
| Container unhealthy | Run `wget -qO- http://127.0.0.1:8080/healthz` inside it and read the log; the first start installs the bundled packs before it listens (about 2 minutes); on a slow disk it can exceed the 300 s start period |
| Log: `AI disabled: QINQIN_SECRET is not 32 bytes of base64` | Regenerate with `head -c 32 /dev/urandom \| base64`. Without it AI stays off; the app works |
| AI settings say there is no secret | `QINQIN_SECRET` was unset or invalid when the container started; fix it and redeploy |
| Everyone shares one sign-in limit, or limits can be dodged | `X-Forwarded-For` handling is wrong: set `QINQIN_TRUSTED_PROXIES` ([Reverse proxy, rate limiting and trusted proxies](Admin-proxy-and-rate-limiting)) |

## Packs, seeding and data packages

| Symptom | Cause and fix |
|---|---|
| Search finds nothing right after the first start, or the log says `auto-seed failed ...` | A fresh instance installs the bundled packs before it listens (about 2 minutes). A failed pack is retried at the next start; check `QINQIN_AUTO_SEED` is not `0`, or run `qinqin seed` ([Deploying](Admin-deploying#the-auto-seed-on-the-first-start)) |
| "database is locked" during seed | Seed while the app is idle (5 s busy timeout) |
| `seed: no packs ... under ...` | The pack roots are wrong. Under Docker the image's roots are set already; extra folders must be mounted and named in `--packs` ([Data packs on the server](Admin-data-packs)) |
| `seed: data packages failed to build` | The lines above it name the package and the error; Settings → Data shows the same error under the pack |
| Settings → Data says "Packages are being built" | Normal for about a minute after the first start of a release with data packages, or after installing a large pack |
| "Level data missing" banner on the character map | Run `qinqin seed` once after upgrading |
| Stroke animation missing | The server serves stroke data from a strokes pack. At start it installs the image's pack when none is installed (log: `strokes: installed the bundled stroke data ...`), but not after an administrator uninstalled one. Run `qinqin seed` (it installs `/opt/qinqin/strokes`); in a checkout build the pack first (`node scripts/prepare-strokes-pack.mjs --out plugins/data-strokes/hanzi-writer-strokes`) |
| Log: `pack <id>: no licence texts stored; run "qinqin seed"` | The pack was installed before licence files were kept; run `qinqin seed` once so its data package carries them |
| Sources page misses pack notices after an upgrade | Run `qinqin seed` once (the log has a `stored license/attribution/notice differs` line) |
| Pack upload: "pack zip larger than 128 MiB — use qinqin seed for larger packs" | Use `qinqin seed` with the pack folder mounted |
| Pack upload: "finish or discard a staged pack first" | Three uploads are waiting for review on the server; install or discard one (stages expire after 30 minutes) |
| Hanzi or kanji fonts missing after a server restore | The server backup does not hold `/data/fonts`; install the font packs again ([Backup, recovery and the command line](Admin-backup-and-recovery)) |
| A script's sync pull answers 400 `sync_collection_moved` | Dictionary data moved to data packages: read `GET /api/packages` and download the lexicon package ([API access tokens](API-Access-tokens)) |
| A package download answers 429 `download_busy` | Two downloads of that user are already running; wait the `Retry-After` seconds and resume |

## Proxy and HTTPS

| Symptom | Cause and fix |
|---|---|
| 413 on upload (pack, book, photo, restore) | The proxy's body limit: raise it to at least 130 MB (`client_max_body_size 130m`) |
| 502 or 504 on an AI review | The proxy's read timeout is below 180 seconds |
| No install button, "Installing needs HTTPS" in Settings | The site is opened over plain HTTP; use HTTPS (or `http://localhost`) |
| Users do not get new versions after an update | The proxy caches `/service-worker.js`; it must pass through with `no-cache` |

## Mail

| Symptom | Cause and fix |
|---|---|
| Test mail fails with `tls` | The server needs STARTTLS (587) or implicit TLS (465); None only on a private relay; the certificate must match the host name |
| Test mail fails with `blocked` | The mail server's address is private: set `QINQIN_SMTP_ALLOW_PRIVATE=1` (metadata and link-local are never allowed) |
| Test mail fails with `auth` | Wrong user name or password; Microsoft 365 needs an app password or SMTP AUTH enabled |
| Some people cannot sign in (503) while mail is down | Their only second step is an emailed code; fix the mail settings, or reset their two-step sign-in (Admin → Email says how many) |
| "The saved password cannot be read any more" in Admin → Email | `QINQIN_SECRET` changed without rotation; enter the mail password again |

## Users

| Symptom | Cause and fix |
|---|---|
| Locked out of an account | A recovery code, an administrator's reset link or **Reset two-step sign-in**, or `qinqin recover` ([Accounts and sign-in](Accounts-and-sign-in)) |
| Nobody can register | The default registration mode is `closed`: create accounts or invite links in Settings → Admin |
| AI says "Turned off by the server" or is unavailable | The provider is not in `QINQIN_AI_PROVIDERS`, no key is stored, or the secret is missing; Settings → AI shows the reason |
| "Read offline" is unavailable | The image was built without Tesseract (`WITH_OCR=0`), or the workspace language has no offline model ([AI providers and offline OCR](Admin-AI-and-OCR#offline-photo-reading-ocr)) |
| Offline reviews are not sent | Open the app online again; reviews leave the device when you next open the app. They stay for that user only ([Install as an app and study offline](Install-and-offline)) |
| An import from Aozora or Gutenberg fails | The server needs direct outbound HTTPS; environment proxies are intentionally not used ([Email, two-step sign-in and security](Admin-email-and-security#outbound-requests)) |
