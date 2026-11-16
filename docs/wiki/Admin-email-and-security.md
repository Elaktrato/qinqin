# Email, two-step sign-in and security

## Email (SMTP)

Email is optional and lives in the server: Settings, Admin, Email. Fields: server, connection security, user name and password, sender address and name, and the address people use to reach the site (it goes into reset links).

- Connection security: `STARTTLS` on port 587 (the default; must succeed, never silently downgraded), `TLS` on port 465, or `None` (plain text, allowed only without a user name and password). Certificates are always verified.
- The password is encrypted with `QINQIN_SECRET`, never shown again and never logged. Changing the server, port, security, user name or the site address makes you type the password again (reset links carry the site address).
- Saving and removing the email settings ask for your own password again and, if you have an authenticator app, a code from it: every reset link and sign-in code goes through these settings.
- **Send test mail** reports a category (`connect`, `blocked`, `tls`, `auth`, `sender`, `recipient`, `timeout`, `protocol`) and the SMTP reply code, never the server's own text.
- Mail is sent in the background through one queue, at most 200 mails an hour for the whole server.
- By default the server may not connect to loopback or private addresses; set `QINQIN_SMTP_ALLOW_PRIVATE=1` for a relay in your LAN or stack (cloud metadata and link-local addresses are never allowed).
- `scripts/smtp-sink.py` is a local test sink that stores each message as an `.eml` file.

Without email these features are hidden, not broken: forgot-password by mail, address confirmation, emailed codes, required two-step sign-in and sign-in by code.

## Two-step sign-in and its enforcement

Everyone may add an authenticator app (TOTP) with 10 recovery codes; it needs `QINQIN_SECRET`, not email. Where email works, an emailed code is a second method. Each code can be tried 5 times and lives 10 minutes; at most 10 wrong codes per account per 15 minutes count across all sign-ins.

In Admin, Security an administrator can **require two-step sign-in for everyone** (needs email). It applies at each person's next sign-in, optionally signing everyone else out now. A person without an address is sent to a setup page first. A separate switch enables **sign in with an emailed code**. A change that lowers a protection (turning this off, allowing sign-in by emailed code, opening registration, lowering the email policy) or signs everyone else out asks for your own password (and authenticator code) first; tightening does not.

People whose only second step is an emailed code are protected by their mailbox alone, and cannot sign in while email is down (the sign-in answers 503; Admin, Email says how many people are affected). Suggest an authenticator app to them. Changing an email address needs the authenticator code too.

Locked-out users: a recovery code, an administrator's **Reset two-step sign-in** (Admin, Users; see [Users, registration and invites](Admin-users-and-registration)), or `qinqin recover --username NAME --reset-mfa`.

## Passwords, sessions and tokens

- Passwords are hashed with argon2id. Session tokens are 64 random hex characters; the database keeps only their SHA-256, so a stolen database or backup (taken after migration 032) hands out no live session. Idle sessions expire after 90 days.
- Every response carries `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`.
- Secrets (AI keys, SMTP password, authenticator secrets) are sealed with `QINQIN_SECRET`; keep it safe ([Backup, recovery and the command line](Admin-backup-and-recovery) for rotation).

## AI providers

`QINQIN_AI_PROVIDERS` limits which providers users may choose. Custom endpoints are registered by administrators (Settings, AI) and treated as a threat surface: the address must be `https` (plain `http` only on private addresses with `QINQIN_AI_ALLOW_PRIVATE=1`), the address actually dialled is checked after DNS, link-local and cloud-metadata addresses are never allowed, redirects are not followed. The name and address cannot be edited later (remove and re-add). See [Journal and AI providers](Journal-and-AI); real providers have not yet been tested by the owner.

## Outbound requests

Reader imports only fetch `https` URLs from an allow-list (Aozora Bunko, Gutenberg), check every redirect and refuse non-public addresses. Environment proxies are intentionally not used.
