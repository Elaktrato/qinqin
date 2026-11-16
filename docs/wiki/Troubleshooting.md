# Troubleshooting

Adapted from the README's table. Administrator-side items first, then user-side.

| Symptom | Cause and fix |
|---|---|
| Stack will not deploy: "required variable QINQIN_SECRET is missing" | Set it in the stack's environment variables ([Environment variables](Admin-environment-variables)) |
| Container keeps restarting | Read its log. A bad host path in `QINQIN_DATA_VOLUME`, or no write permission (`create data directory ...`); fix ownership (the image runs as root) |
| Log: `QINQIN_SECRET ... not 32 bytes of base64`, AI disabled | Regenerate with `head -c 32 /dev/urandom \| base64`. Without it AI stays off; the app works |
| AI settings say there is no secret | `QINQIN_SECRET` was unset or invalid when the container started; fix and redeploy |
| 413 on upload (pack, book, photo, restore) | Proxy body limit: raise it to at least 130 MB (`client_max_body_size 130m`) |
| 502 or 504 on an AI review | Proxy read timeout is below 180 seconds |
| "port is already allocated" | Change `QINQIN_PORT` |
| Container unhealthy | Run `wget` against `127.0.0.1:8080/healthz` inside it and read the log; a slow first start on a slow disk can exceed the 15 s start period |
| "database is locked" during seed | Seed while the app is idle (5 s busy timeout) |
| Test mail fails with `tls` | The server needs STARTTLS (587) or implicit TLS (465); None only on a private relay; the certificate must match the host name |
| Test mail fails with `blocked` | The mail address is private: set `QINQIN_SMTP_ALLOW_PRIVATE=1` (metadata and link-local are never allowed) |
| Test mail fails with `auth` | Wrong user name or password; Microsoft 365 needs an app password or SMTP AUTH enabled |
| Everyone shares one sign-in limit, or limits can be dodged | `X-Forwarded-For` handling is wrong: set `QINQIN_TRUSTED_PROXIES` ([Reverse proxy, rate limiting and trusted proxies](Admin-proxy-and-rate-limiting)) |
| "Level data missing" banner on the character map | Run `qinqin seed` once after upgrading |
| Sources page misses pack notices after an upgrade | Run `qinqin seed` once (the log has a `stored ... differs` line) |
| No install button, "Installing needs HTTPS" in Settings | The site is opened over plain HTTP; use HTTPS (or `http://localhost`) |
| Users do not get new versions after an update | The proxy caches `/service-worker.js`; it must pass through with `no-cache` |
| Locked out of an account | A recovery code, an administrator's reset link, or `qinqin recover` ([Accounts and sign-in](Accounts-and-sign-in)) |
| AI says "turned off by the server" or unavailable | The provider is not in `QINQIN_AI_PROVIDERS`, no key is stored, or the secret is missing; Settings, AI shows the reason |
| Offline reviews are not sent | Open the app online again; reviews leave the device when you next open the app. They stay for that user only ([Install as an app and study offline](Install-and-offline)) |
| An import from Aozora or Gutenberg fails | The server needs direct outbound HTTPS; environment proxies are intentionally not used |

If a problem is not here, check the container log first: it never contains passwords, tokens, keys or addresses.
