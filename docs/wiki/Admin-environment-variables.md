# Environment variables

Taken from the README and the two stack files (`docker-compose.yml`, `deploy/portainer-stack.yml`). Set them in the stack's environment. Any variable not listed here is not read by the server.

| Variable | Meaning |
|---|---|
| `QINQIN_SECRET` | 32 random bytes, base64 (standard or URL form, padded or not). Required to store AI keys; also seals the SMTP password and authenticator secrets. Required by the Portainer stack. Never written to `/data`: back it up separately |
| `QINQIN_SECRET_PREVIOUS` | The old secret, for one restart while rotating ([Backup, recovery and the command line](Admin-backup-and-recovery)) |
| `QINQIN_IMAGE` | Image to run (default `ghcr.io/elaktrato/qinqin:latest`); pin a `v*` tag |
| `QINQIN_PORT` | Published host port (default 8080) |
| `QINQIN_DATA_VOLUME` | Portainer stack: absolute host path to bind-mount instead of the named volume `qinqin-data`; must exist and be writable by root |
| `QINQIN_DATA` | The data directory inside the container (`/data` in both stack files); also the default of `--data` for the CLI (default `./data`) |
| `QINQIN_PACKS` | Pack roots for `qinqin seed` (comma-separated). The image sets it to the packs it ships; without it the default is `plugins/data` plus `plugins/data-local` if present |
| `QINQIN_PASSWORD` | Read by `qinqin recover` as the new password (otherwise it reads standard input) |
| `QINQIN_TRUSTED_PROXIES` | Peers whose `X-Forwarded-For` is believed: a comma list of CIDRs or addresses, `none` to ignore the header, empty for the private networks. Set `none` when nothing reverse-proxies to qinqin |
| `QINQIN_SMTP_ALLOW_PRIVATE` | `1` or `true`: the mail server may be on loopback or a private network. Off by default |
| `QINQIN_AI_PROVIDERS` | Comma list of providers users may choose: `anthropic`, `openai`, `gemini`, `deepseek`, `mistral`, `xai`, `groq`, `openrouter` and `custom`. Default: all |
| `QINQIN_AI_ALLOW_PRIVATE` | `1` or `true`: admins may register custom AI endpoints on loopback and private addresses. Enable only if you trust every admin |
| `QINQIN_AI_PROVIDER` | Legacy. `anthropic` means `QINQIN_AI_PROVIDERS=anthropic` (the log says so); `fake` is for testing only; anything else disables AI |
| `QINQIN_BOOTSTRAP_ADMIN` | Username of the first admin, created on the first start while no user exists, with a forced password change at the first sign-in. Empty: off. Ignored once users exist. An invalid value stops the server from starting |
| `QINQIN_BOOTSTRAP_PASSWORD` | Initial password of that admin (10 to 256 characters). Empty: a random one is generated and printed once in the container log; a supplied one is never logged |
| `QINQIN_TESSERACT` | Path of the `tesseract` binary (default: from `PATH`). `TESSDATA_PREFIX` is passed through |

Test-only variables exist in the code (for example `QINQIN_REAL_DATA_TESTS`, `QINQIN_REQUIRE_TESSERACT`, `QINQIN_BIG_TESTS`); do not set them in production.

## Notes

- A malformed `QINQIN_TRUSTED_PROXIES`, or an invalid `QINQIN_BOOTSTRAP_ADMIN` or `QINQIN_BOOTSTRAP_PASSWORD` while no user exists, stops the server at startup.
- Without a valid `QINQIN_SECRET` the server starts, AI shows as disabled with the reason, authenticator apps and stored mail passwords are unavailable, but the rest of the app works.
- Instance settings such as the registration policy, email policy and SMTP live in the app (Settings, Admin), not in environment variables.
