# Environment variables

Set them in a `.env` file next to `docker-compose.yml`, in the shell, or (Portainer) in the stack's Environment variables. `docker-compose.yml` passes every server variable below to the container. It does not pass `QINQIN_PACKS` (the image sets it), the command-line `QINQIN_PASSWORD` or `TESSDATA_PREFIX`: set those yourself where you need them (for example `docker compose exec -e QINQIN_PASSWORD=...`).

## Stack variables (read by Docker Compose)

| Variable | Meaning |
|---|---|
| `QINQIN_IMAGE` | The image to run. Default `ghcr.io/elaktrato/qinqin:latest`; for production pin a release such as `ghcr.io/elaktrato/qinqin:v0.4.1` ([Deploying](Admin-deploying#release-images-and-versions)) |
| `QINQIN_PORT` | The published host port. Default 8080 (the container always listens on 8080) |
| `QINQIN_DATA_VOLUME` | Default `qinqin-data`, a named volume that works everywhere, Portainer included. A value starting with `./` or `/` bind-mounts that host directory instead: `./data` (next to the compose file; plain compose only, a relative path is unreliable in Portainer; also the way to keep an old quick-start install) or an absolute path such as `/srv/qinqin/data`. The directory must be writable by root, the user the image runs as |

## Server variables

| Variable | Meaning |
|---|---|
| `QINQIN_SECRET` | 32 random bytes, base64 (standard or URL alphabet, padded or not); generate with `head -c 32 /dev/urandom \| base64`. Seals the users' AI keys, the SMTP password and the authenticator (TOTP) secrets. Optional: empty means AI keys, authenticator apps and a stored mail password are unavailable, and the rest works (no weak default key is ever used). Never written to `/data`: back it up separately. Details: [AI providers and offline OCR](Admin-AI-and-OCR#the-server-secret) |
| `QINQIN_SECRET_PREVIOUS` | Only while rotating: the old secret, for one restart ([Backup, recovery and the command line](Admin-backup-and-recovery#rotating-qinqin_secret)). An invalid value is ignored with a log line |
| `QINQIN_BOOTSTRAP_ADMIN` | Username of the first administrator, created on the first start while the instance has no users, before the port opens; that admin must set a new password at the first sign-in. Empty: off (create the admin with `qinqin adduser`). Ignored, and nothing logged, once users exist, so it can stay set |
| `QINQIN_BOOTSTRAP_PASSWORD` | That admin's initial password (10 to 256 characters, not the username). Empty: a random one is generated and printed **once** in the container log (`bootstrap: initial password ...`). A supplied password is never logged; remove it from the stack after the first sign-in |
| `QINQIN_TRUSTED_PROXIES` | Which peers may tell the server a client's address through `X-Forwarded-For` (sign-in limits are per client). Empty: the private networks (right behind a reverse proxy on a Docker or LAN network). `none`: ignore the header; **set it when nothing reverse-proxies to qinqin**. Or a comma list of CIDRs and addresses (one proxy, a CDN's ranges). See [Reverse proxy, rate limiting and trusted proxies](Admin-proxy-and-rate-limiting) |
| `QINQIN_SMTP_ALLOW_PRIVATE` | `1` or `true`: the mail server may be on loopback or a private network (a relay container, a LAN host). Off by default; cloud-metadata and link-local addresses are never allowed |
| `QINQIN_AI_PROVIDERS` | Comma list of the AI providers users may choose: `anthropic`, `openai`, `gemini`, `deepseek`, `mistral`, `xai`, `groq`, `openrouter` and `custom` (admin-registered endpoints). Empty: all. An unknown id is ignored with a log line. A provider left out keeps its users' stored keys, shown "Turned off by the server" with only Remove, and a selection on it reads as unavailable |
| `QINQIN_AI_ALLOW_PRIVATE` | `1` or `true`: administrators may register custom AI endpoints on loopback and private addresses (Ollama on your LAN). Off by default; enable it only if you trust every administrator, since their endpoints can then reach your network |
| `QINQIN_AI_PROVIDER` | Legacy. Unset: real providers, all allowed (subject to `QINQIN_AI_PROVIDERS`). `anthropic` means `QINQIN_AI_PROVIDERS=anthropic` (a log line says so), so an upgrade never sends text to a provider you did not allow. `fake` is for testing only: a deterministic provider that replaces every adapter, never contacts an AI service, and shows "Test provider — no real AI" in the app. Anything else disables AI |
| `QINQIN_TESSERACT` | Path of the `tesseract` binary for offline photo reading. Empty: `tesseract` from `PATH` (the image has one). `TESSDATA_PREFIX` is passed through to it |
| `QINQIN_AUTO_SEED` | `0`, `false` or `off` (any case) stops the first start of a fresh instance from installing the bundled packs; the demo packs are never installed this way. Default on: it runs once, on a fresh instance with no pack installed. `qinqin seed` still works ([Deploying](Admin-deploying#the-auto-seed-on-the-first-start)) |

## Set by the image

You normally leave these alone.

| Variable | Meaning |
|---|---|
| `QINQIN_DATA` | The data directory: `/data` in the image and the compose file. It is also the default of every command's `--data`; without it the default is `./data` |
| `QINQIN_PACKS` | The pack roots `qinqin seed` reads, comma-separated. The image sets `/opt/qinqin/packs,/opt/qinqin/audio,/opt/qinqin/strokes`; the server also reads them at start (to install the stroke data when none is installed, and to compare stored pack terms with the manifests). Without it the default is `plugins/data` plus `plugins/data-audio`, `plugins/data-strokes` and `plugins/data-local`, each when it exists |

## Command-line only

| Variable | Meaning |
|---|---|
| `QINQIN_PASSWORD` | Read by `qinqin adduser` and `qinqin recover` as the password; when it is empty they read one line of standard input |

`qinqin serve` also takes `--addr` (listen address, default `:8080`) and `--data`. The commands are listed in [Backup, recovery and the command line](Admin-backup-and-recovery#the-command-line).

Variables only tests read exist in the code (`QINQIN_REAL_DATA_TESTS`, `QINQIN_REQUIRE_TESSERACT`, `QINQIN_BIG_TESTS`, `QINQIN_PERF_BUDGET_MS`, `UPDATE_ROUTES_FIXTURE`, `UPDATE_TOKEN_ROUTES_FIXTURE`; see [Development](Development)); do not set them in production.

## What happens when a value is wrong

- A malformed `QINQIN_TRUSTED_PROXIES` stops the server at startup, as does an invalid `QINQIN_BOOTSTRAP_ADMIN` or `QINQIN_BOOTSTRAP_PASSWORD` while no user exists; the log says why.
- A missing or invalid `QINQIN_SECRET` does not stop the server: AI shows as disabled with the reason (log `AI keys cannot be stored: QINQIN_SECRET is not set` or `AI disabled: QINQIN_SECRET is not 32 bytes of base64`), authenticator apps and stored mail passwords are unavailable (recovery codes still work), and everything else works. A good one logs `AI: QINQIN_SECRET ok`.

Instance settings such as the registration mode, the email policy, two-step sign-in enforcement and SMTP live in the app (Settings → Admin), not in environment variables ([Users, registration and invites](Admin-users-and-registration), [Email, two-step sign-in and security](Admin-email-and-security)).
