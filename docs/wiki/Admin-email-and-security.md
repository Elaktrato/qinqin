# Email, two-step sign-in and security

## Email (Admin → Email)

Email is optional and lives in the server itself. A mail server lets people reset passwords, confirm addresses and get sign-in codes, and lets you require two-step sign-in. The form has: **Server**, **Port**, **Connection security**, **User name** and **Password**, **Sender address**, **Sender name**, and **Address of this site** (the address people use to reach qinqin; it goes into reset links).

- **Connection security**: STARTTLS (port 587, the default; it must succeed and is never silently downgraded), TLS (port 465), or None (port 25, plain text, allowed only without a user name and password). Certificates are always verified.
- **The password** is encrypted with `QINQIN_SECRET`, never shown again and never logged: the form says "A password is saved" and offers **Replace** and **Remove**. Without a usable secret a password cannot be stored; a relay without a password still works. Changing the server, port, security, user name or the site address makes you type the password again, so a session cannot send it somewhere else.
- **Saving and removing** ask for your own password again and, if you have an authenticator app, a code from it: every reset link and sign-in code goes through these settings. **Remove email setup…** turns off password reset by email, email codes and required two-step sign-in; personal authenticator apps keep working.
- **Send test mail** (to your own address by default) reports a category (`connect`, `blocked`, `tls`, `auth`, `sender`, `recipient`, `timeout`, `protocol`) and the SMTP reply code, never the mail server's own text. At most 10 test mails an hour.
- Mail goes out in the background through one queue, at most 200 mails an hour for the whole server; no address or code is ever logged. Each mail is written in the recipient's interface language (their setting, else the language of the browser that triggered it, else English).
- By default the server may not connect to loopback or private addresses; set `QINQIN_SMTP_ALLOW_PRIVATE=1` for a relay in your LAN or in the same stack. Cloud-metadata and link-local addresses are never allowed.

**Docker example:** a relay service `smtp` in the same stack, host `smtp`, port 25, security None, and `QINQIN_SMTP_ALLOW_PRIVATE=1` on qinqin.

**Trying it without a provider:** `python3 scripts/smtp-sink.py --port 2525 --dir ./mail` stores each message as an `.eml` file and prints only the subject. Use host `127.0.0.1` (or the container name), port 2525, security None.

Without email these features are hidden, not broken: forgot-password by mail, address confirmation, emailed codes, required two-step sign-in and sign-in by code. Removing the email setup switches them off again.

## Two-step sign-in

Everyone may add an **authenticator app** (TOTP, RFC 6238, 6 digits, 30 seconds) in Settings → Account, with 10 single-use recovery codes. It needs `QINQIN_SECRET`, not email. An authenticator code works once (a replay is refused). Where email works, an **emailed code** is a second method. Each code can be tried 5 times and lives 10 minutes; at most 10 wrong codes per account per 15 minutes (and 30 a day) count across all sign-ins.

In **Admin → Security** an administrator can:

- **Require two-factor authentication for everyone** (needs email). It applies at each person's next sign-in; tick **Sign everyone else out now** to apply it at once. A person without an address is sent to a setup page first. "Required, but inactive while no mail server is set up" means the mail settings are missing.
- **Allow signing in with an emailed code**: a password-free route. An account with an authenticator still asks for it, and while two steps are required an account without one must use the password.

A change that lowers a protection (turning the requirement off, allowing sign-in by emailed code, opening registration, lowering the email policy) or signs everyone else out asks for your own password (and authenticator code) first; tightening does not.

A password reset or reset link never removes two-step sign-in, and a reset link or emailed code is never accepted as a second step after itself. People whose only second step is an emailed code are protected by their mailbox alone, by construction: while email does not work they cannot sign in (503), and Admin → Email says how many people that is. Give them an authenticator app. Changing one's email address asks for the authenticator code too, cancels open reset links and tells the old address.

Locked-out users: a recovery code, an administrator's **Reset two-step sign-in** (Admin → Users; see [Users, registration and invites](Admin-users-and-registration)), or `qinqin recover --username NAME --reset-mfa`.

## Passwords, sessions and tokens

- Passwords are hashed with argon2id. Session tokens are 64 random hex characters; the database keeps only their SHA-256, so a stolen database or backup (taken after migration 032) hands out no live session. A session unused for 90 days stops working and is pruned.
- Personal access tokens (`qq_pat_…`) are stored the same way and never reach account, admin, backup or AI routes ([API access tokens](API-Access-tokens)).
- Every response carries `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`. There is no Content-Security-Policy yet.
- Secrets (AI keys, the SMTP password, authenticator secrets) are sealed with `QINQIN_SECRET`; keep it safe, and see [Backup, recovery and the command line](Admin-backup-and-recovery#rotating-qinqin_secret) for rotation.
- Sign-in, registration and code routes are throttled ([Reverse proxy, rate limiting and trusted proxies](Admin-proxy-and-rate-limiting#sign-in-throttling)).

## AI providers

Restricting providers, custom endpoints and the threat rules for them are on [AI providers and offline OCR](Admin-AI-and-OCR).

## Outbound requests

The server contacts other hosts only for these:

- **Reader imports** (Aozora Bunko, Gutenberg), only when a user asks, one work per request. The source client fetches only `https` URLs from that allow-list, checks every redirect hop and refuses loopback, private and other non-public addresses. Environment proxies (`HTTP_PROXY`, `HTTPS_PROXY`) are intentionally **not** used, because a proxy would bypass that check: behind a mandatory outbound proxy the imports do not work (epub uploads still do). Requests send `User-Agent: qinqin/<version> (+https://github.com/Elaktrato/qinqin)` (`<version>` is `dev` unless the binary was built with `-ldflags "-X main.version=1.2.3"`), wait at most 15 s for a connection and 15 s for the response headers, are limited to one per second per host, and are cached under `/data/cache/sources` (catalogues for 7 days, works for 1 day).
- **AI providers**, only when a user presses an AI button ([AI providers and offline OCR](Admin-AI-and-OCR)). The built-in providers honour `HTTPS_PROXY`; custom endpoints never use a proxy.
- **Your mail server**, for the mails above.
