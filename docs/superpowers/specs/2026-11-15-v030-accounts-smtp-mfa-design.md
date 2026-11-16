# v0.3.0 accounts — SMTP, email, MFA, sign-in codes (#64)

Part of `2026-11-15-v030-accounts-design.md` (shared rules, authorization matrix). Plan 3.
Owner: SMTP is optional, in core, admin-only, password encrypted and never returned, with a test
mail. With mail: reset by mail, admin-enforced MFA, passwordless sign-in by emailed code.
Without mail these are hidden, not broken.

## 1. Secrets: one mechanism

`ai.Sealer`/`ai.ParseSecret` move to a new package `internal/secretbox` unchanged (same key
derivation label `"qinqin ai key encryption v1"`, same fingerprint), and `ai` keeps type aliases
so nothing in `ai` changes behaviour. The SMTP password and TOTP secrets use the **same sealer**
(same derived key) with their own AAD: `qinqin/smtp/v1|password` and
`qinqin/mfa_totp/v1|user=<id>`. Rows store `ciphertext, nonce, secret_fp` like `ai_keys`.
Startup rotation (`QINQIN_SECRET_PREVIOUS`) re-seals these rows too (`secretbox.Rotator` used by
the AI key store and the two new tables). A row whose `secret_fp` matches neither secret is
`undecryptable`: the SMTP form says "the password must be entered again"; a TOTP row then cannot
verify and the user signs in with a recovery code or an admin resets two-factor.
Ruling: reuse the AI key with AAD separation instead of a new derived key — "the same mechanism"
as the owner asked, one rotation path, AAD makes cross-use fail closed — cost if wrong: a key
compromise covers all three (it would anyway: one secret).
Without a valid `QINQIN_SECRET`: TOTP is unavailable (hidden, with a sentence); SMTP can be saved
only without a password (an unauthenticated relay); `GET …/smtp` reports `secret`.

## 2. SMTP settings and the mailer

Migration 034: `smtp_settings(id=1, host, port, tls_mode CHECK IN ('starttls','tls','none'),
username, password_ct, password_nonce, secret_fp, from_address, from_name, public_url,
updated_at, updated_by)`.

- `GET /api/admin/settings/smtp` → `{configured, host, port, tls, username,
  password:"set"|"none"|"undecryptable", fromAddress, fromName, publicUrl, secret:"ok"|"missing"|
  "invalid", allowPrivate, updatedAt}`. Never the password.
- `PUT` (full object) — `password` absent = keep, `""` = clear, a string = replace (sealed
  before the write). 422: `invalid_host`, `smtp_host_blocked`, `invalid_port`, `invalid_tls`,
  `credentials_need_tls` (mode `none` with a username), `invalid_email` (from),
  `invalid_public_url` (absolute http(s), no query/fragment/userinfo); 409 `secret_unavailable`
  (a password without a usable secret). `DELETE` → 204 (mail-dependent features go inactive).
- `POST /api/admin/settings/smtp/test` `{to?, draft?}` → 200 `{"sent":true}` or 502
  `{"error":"smtp_test_failed","category","smtpCode","message"}`; `category ∈ connect | blocked |
  tls | auth | sender | recipient | timeout | protocol`; `smtpCode` is the 3-digit reply code when
  there was one. No server banner or reply text is echoed (it could carry internal details).
  `to` defaults to the admin's email; `draft` tests unsaved form values (password absent = the
  stored one). Synchronous; limiter key `smtp-test:<admin id>` 10/hour.
- **The stored password never follows a new host.** A `PUT` or a test `draft` that changes host,
  port, TLS mode or username while a password is stored must carry the password again (422
  `password_reentry_required`); otherwise an admin session could send the stored password to a
  server of its choice.
  Ruling: re-entry on connection change — the password is only as safe as the host it goes to —
  cost if wrong: admins retype the password when they move providers (they have it anyway).
- **Mail is configured** when the row exists, has host, from and public URL, and its password is
  `none` or decryptable. That single predicate (`mail.Configured(ctx)`) drives every
  "hidden without SMTP" decision.

**Transport** (`internal/mail`, stdlib only):
- Library: Go's `net/smtp` (BSD-3, part of the toolchain, no new dependency) plus a ~20-line
  `AUTH LOGIN` (Microsoft 365 and some hosts offer no PLAIN).
  Ruling: stdlib over `wneessen/go-mail` (MIT) — plain-text mails to one recipient need no MIME
  builder, and no dependency means no licence or supply-chain review — cost if wrong: we own
  ~250 lines of message composition (tested).
- TLS modes: `starttls` (default, port 587): STARTTLS is **required**; a server not offering it is
  `tls` category, never a silent downgrade. `tls` (implicit, 465): `tls.Dial`. `none` (25/1025):
  plain, allowed only without credentials, the form shows a warning. Certificates are always
  verified (system roots, `ServerName = host`, TLS ≥ 1.2); no "skip verify" switch.
  Ruling: no insecure-TLS option — a LAN relay with a self-signed certificate uses `none` on a
  private network instead — cost if wrong: such admins run plain SMTP inside their LAN.
- Auth: PLAIN when advertised, else LOGIN; both refuse to run without TLS.
- Timeouts: dial 10 s; the whole conversation has a 30 s deadline (`conn.SetDeadline`).
- SSRF: dialing goes through the netguard dialer (moved from `ai` to `internal/netguard`,
  `ai` re-exports): metadata, link-local, unspecified, multicast and the always-blocked prefixes are
  refused always; loopback/RFC 1918/CGNAT/ULA only with `QINQIN_SMTP_ALLOW_PRIVATE=1`. Checked on
  save (IP literals) and at dial time on the resolved address (DNS rebinding). Any port.
  Ruling: a separate `QINQIN_SMTP_ALLOW_PRIVATE` rather than reusing the AI switch — an admin
  allowing a LAN Ollama has not thereby allowed SMTP to the LAN — cost if wrong: one more env
  var; the README Docker example shows it for a relay container.
- Addresses: ASCII only (IDN domains in punycode), validated like user emails (registration spec
  §5). `net/smtp` additionally refuses CR/LF in `MAIL FROM`/`RCPT TO`.
- Message: CRLF lines; headers `From` (`mime.QEncoding` display name + address), `To`, `Subject`
  (Q-encoded), `Date`, `Message-ID` (random @ from-domain), `MIME-Version`, `Content-Type:
  text/plain; charset=utf-8`, `Content-Transfer-Encoding: quoted-printable`, `Auto-Submitted:
  auto-generated`. Header values come only from constants, validated addresses and encoded words;
  `compose` refuses any header value containing CR or LF (defence in depth, tested with
  `"a\r\nBcc: x"` in every field). No HTML, no attachments, no tracking.
- Templates: `text/template`, embedded, English: `reset` ("Reset your qinqin password", link,
  valid 1 hour), `login_code`, `mfa_code`, `verify_email` (6-digit code, valid 10 minutes),
  `test`. Codes never in the subject (lock-screen previews). Every mail names the site
  (`public_url` host) and says what to do if it was not you.
- Delivery: an in-process queue (buffer 100, one worker). Interactive sends (codes, reset) are
  enqueued and the HTTP response does not wait, so timing does not reveal whether a mail was sent.
  Full queue → dropped and logged. No retries (the user can resend). Global cap `mail:global`
  200/hour. Log lines: `mail: sent kind=reset user=12` / `mail: failed kind=reset user=12
  category=auth` — never an address, code, link or password.

## 3. Email verification

User-entered emails are verified with a code when mail is configured. `PUT /api/account/email`
`{email|null, password}` (password re-auth in a full session; not asked in an enrolment session)
→ `{email, emailVerified, verification:"sent"|"unavailable"}`. A changed email loses its
verification. `POST /api/account/email/verify {code}` → `{emailVerified:true}`, a wrong code is
**403** `code_invalid` (authenticated route: never 401);
`POST /api/account/email/resend` → 202. Only verified emails receive reset links, sign-in codes
and MFA codes. Admin-set emails are verified by definition.

## 4. Password reset by mail

`POST /api/auth/reset-request {login}` (username or email; `@` means email) → **always 202
`{}`**, same body and the same database work (lookup + limiter) for known and unknown. A mail is
queued only when mail is configured, the user exists, is enabled and has a verified email;
limiter `reset-mail:<user id>` 3/hour (silently skipped beyond). Link
`<public_url>/reset#t=<token>`, expiry 1 hour, stored in `password_resets` with
`created_by NULL` — the row is created by the **mail worker**, not in the request, so a known
account costs the request no extra write (no fsync-timing difference); consumption is the registration spec §4 flow. Without mail the route answers
409 `mail_unavailable` (instance-level fact, not per account).

## 5. MFA

**Methods.** TOTP (RFC 6238: HMAC-SHA1, 6 digits, 30 s, the parameters every authenticator app
supports) with 10 recovery codes; and email codes to a verified address.
Ruling: TOTP primary, email codes secondary — TOTP works offline and without our SMTP; email
codes cover people without an authenticator — cost if wrong: none; both are small.
Ruling: TOTP opt-in is available whenever `QINQIN_SECRET` is valid, even without SMTP — it is not
a mail feature; only *enforcement* and email codes need mail, as the owner wrote — cost if wrong:
an admin who wanted no MFA at all sees an optional section in Account settings.

**TOTP details.** Own implementation (~40 lines in `internal/auth/totp.go`; RFC 6238 appendix B
vectors in the tests). Secret: 20 random bytes, base32 without padding, sealed. Accept steps
`t-1, t, t+1` (±30 s skew). **Replay**: `mfa_totp.last_step`; a code is accepted only for a step
`> last_step`, written with a guarded `UPDATE … WHERE last_step < ?` so two parallel uses of one
code cannot both pass. Compare with `subtle.ConstantTimeCompare`.

**Enrolment.** `POST /api/account/mfa/totp/setup {password}` (no password in an enrolment
session) → `{secret, otpauthUri, expiresAt}`. The secret is stored in the **pending** columns
of `mfa_totp` (`pending_ct, pending_nonce, pending_fp, pending_at`; 10 min; a new setup replaces
only the pending secret). A confirmed secret is replaced only by confirming the pending one, and a
user who already has TOTP must also pass a current TOTP or recovery code to start a setup;
`otpauthUri = otpauth://totp/qinqin:<username>?secret=…&issuer=qinqin&algorithm=SHA1&digits=6&period=30`
(issuer `qinqin (<public host>)` when a public URL is set). The web app draws the QR from
`uqr`'s `encode()` matrix (MIT, zero dependencies, version 0.1.3) as `<rect>`s — no `{@html}` —
and shows the secret as text with Copy. `POST …/totp/confirm {code}` → `{recoveryCodes:[10]}`;
an enrolment session becomes `full`. Recovery codes: 16 base32 characters (80 bits) shown as
`ABCD-EFGH-IJKL-MNOP`, stored as SHA-256 of the normalised form, single use; input ignores case,
spaces and dashes. `POST /api/account/mfa/recovery-codes {password, code}` regenerates (old set
deleted). `DELETE /api/account/mfa/totp {password, code}` turns TOTP off (409 `mfa_required` when
enforcement is on and the user would have no method left). Email method:
`POST /api/account/mfa/email {enabled, password}` (needs a verified email and mail; the password
is skipped in an enrolment session, like TOTP setup). Wrong codes on these authenticated routes
(disable, regenerate, confirm) are **403** `code_invalid`.

**When a login needs a second step** (decided only after the password verified):
1. confirmed TOTP → methods `totp`, `recovery` (+ `email` if the email method is usable);
2. else email method on, verified email, mail configured → `email`;
3. else MFA enforced (and mail configured) and a verified email → `email` (automatically
   eligible, no enrolment screen);
4. else MFA enforced → the session is created with `level='enroll'` →
   `{"status":"mfa_enrollment_required","token",user,"methods":["totp","email"]}` (methods
   available on this instance);
5. else no second step.

**Login challenge.** Step 1–3 answer `{"status":"mfa_required","challenge","methods",
"emailHint":"a•••@e•••.org"|null,"expiresAt"}`. No session exists yet. `POST
/api/auth/login/mfa/email {challenge}` sends a code (202 `{resendAfter:60}`), `POST
/api/auth/login/mfa {challenge, method, code}` → `ok` / `password_change_required` with token;
wrong code → 401 `code_invalid` `{attemptsLeft}`; 5 failures or expiry → 401
`challenge_expired` (start again). `auth_challenges(id, token_hash, kind
'mfa'|'email_login'|'email_verify', user_id NULL-able, email_norm, code_hash, sends, last_sent_at,
attempts, expires_at, created_at, device)`; `code_hash = sha256(challenge id ‖ code)`.

**Enforcement and existing users.** Turning `mfaEnforced` on changes nothing for live sessions;
from each user's next login on, rules 3–4 apply. The switch has a checkbox "Sign everyone else
out now" (deletes every session except the acting admin's). If the acting admin has no TOTP the UI
warns that their own sign-in will depend on mail. Turning it off leaves personal TOTP in place.
If mail is removed while enforcement is on, enforcement and email codes become inactive
(reported as `mfaEnforced:true, mfaEnforcedEffective:false`), personal TOTP keeps working.
Ruling: enforce at next login, revoke only on request — logging everyone out by surprise is worse
UX than a checkbox — cost if wrong: an attacker holding a live session keeps it until the admin
ticks the box.

**Lockout recovery.** Recovery code; or an admin: `POST /api/admin/users/{id}/mfa/reset` (removes
TOTP, recovery codes and the email method flag, deletes the user's sessions, audited); or for the
only admin: `qinqin recover --username X --reset-mfa` (registration spec §6).

## 6. Codes, attempts and rate limits

| What | Value |
|---|---|
| Email code | 6 digits (`crypto/rand`, uniform), valid 10 min, ≤ 3 sends per challenge, 60 s between sends |
| Attempts | 5 wrong codes per challenge (all methods together); resends do not reset the count |
| Challenge | 10 min lifetime, single use, deleted on success or exhaustion |

Limiters: the #86 design (`internal/ratelimit`: `Bucket.Take(key, now) (ok, retry)`, `Backoff`,
`Gate.Acquire(ctx)`, keys hashed, tables capped at 65 536 keys) is reused; its L1 client-IP bucket
also guards every anonymous route added here (`email-login/*`, `reset-request`, `reset*`,
`invite/check`, `login/mfa*`). Its budgets win for `login`/`register`. The account-specific
buckets below are extra `Bucket`s on the same `authLimits` struct, in their own tables, so their
key format is independent of #86's exact-bytes username keys: identifiers are keyed by
`sha256(lower-cased, trimmed login)[:16]`:

| Key | Budget | On limit |
|---|---|---|
| `mfa:<user id>` | 10 wrong codes / 15 min across challenges, MFA **and** email-code sign-in | 429 `rate_limited` |
| `mfa-day:<user id>` | 30 wrong codes / 24 h | 429 |
| `ident:<normalised login>` (reset-request, email-login start) | 5 / hour — same for unknown identifiers | 429 (identical for known/unknown) |
| `mailcode:<user id>` | 5 code mails / hour | silently not sent |
| `reset-mail:<user id>` | 3 / hour | silently not sent |
| `reauth:<user id>` (change password, email change, MFA changes, delete) | 5 wrong passwords / 15 min | 429 |
| `smtp-test:<admin id>` | 10 / hour | 429 |
| `mail:global` | 200 mails / hour | dropped, logged |

Every argon2 run added here (re-auth, change password, admin create, reset, recover) goes through
#86's hash gate (503 `busy` when saturated).
Ruling: no account lockout state — a lockout lets anyone lock a victim out; throttling with
`Retry-After` does not — cost if wrong: slow online guessing remains possible within budgets.

## 7. Passwordless sign-in by emailed code

Switch `emailCodeLogin` (admin, needs mail). Passwords keep working; the login page adds "Email me
a sign-in code". `POST /api/auth/email-login/start {login, deviceName?}` → always 202
`{challenge, resendAfter, expiresAt}`: for an unknown identifier a real challenge row with
`user_id NULL` is stored and no mail is sent, so the answer is indistinguishable. `POST
/api/auth/email-login/verify {challenge, code}` → like a login: `ok`; `mfa_required`
(methods `totp`,`recovery`) when the user has TOTP; under enforcement a user without TOTP gets
403 `password_login_required` ("sign in with your password; two steps are required").
Ruling: the code adds a sign-in route, it does not replace passwords — admin-created users and the
Android client keep one stable path — cost if wrong: admins wanting password-free accounts wait.
Ruling: under enforced MFA an email code alone is one factor, so it only counts together with
TOTP — cost if wrong: email-only users sign in with password + code instead.

## 8. Hidden without mail (or without the secret)

| Feature | No mail | No `QINQIN_SECRET` |
|---|---|---|
| Forgot password link / reset by mail | hidden ("ask your administrator") | unaffected |
| Email verification UI | hidden; emails stored unverified | unaffected |
| Email codes (MFA method, passwordless) | hidden | unaffected |
| MFA enforcement switch | hidden; admin sees "needs email (Admin → Email)" | unaffected |
| TOTP | available | hidden with reason |
| SMTP form | — | only without password |

## 9. Web UI

- Login step "Two-step check": code field (`inputmode="numeric"`, `autocomplete="one-time-code"`,
  `maxlength` 6, pasted spaces stripped), "Use a recovery code", "Email me a code instead"
  (shows the masked address), attempts left in the error text. Email-code sign-in: identifier
  → code with Resend (countdown text, `aria-live="polite"`).
- `/account/two-factor-setup` (forced enrolment) and Settings → Account → Two-factor share one
  component: choose Authenticator app (QR + secret + code) or Email codes (add/verify email first
  when needed) → recovery codes page (Copy, Download `.txt`, "I have saved these codes" checkbox
  before Continue).
- Settings → Admin → Email: the SMTP form; TLS select with the plain-text warning; password
  field shows "A password is saved" with Replace/Remove; Send test mail with the result category
  as a sentence; Remove email setup (confirm, lists what turns off).
- Admin → Security: "Require two-step sign-in for everyone" and "Allow sign-in with an emailed
  code" switches (hidden reason without mail).
- Pure modules: `lib/account/mfaView.ts`, `lib/account/otpInput.ts`, `lib/account/qrMatrix.ts`
  (wraps `uqr.encode`), `lib/admin/smtpForm.ts` (draft ↔ payload, password tri-state, category →
  sentence), `lib/account/recoveryCodes.ts`.

## 10. Docs

README: "Accounts and sign-in" (modes, invites, admin-created users, reset links, sessions,
deleting accounts, `qinqin recover`), "Email (SMTP)" (fields, TLS modes, test mail,
`QINQIN_SMTP_ALLOW_PRIVATE`, Docker relay example, `scripts/smtp-sink.py` for trying it),
"Two-step sign-in" (TOTP, recovery codes, enforcement, lockout recovery), API table rows, the
`QINQIN_SECRET` section (now also SMTP and TOTP), Troubleshooting rows (test-mail categories).

## 11. Security review fixes (second wave)

- **The mailbox is never both factors.** An `mfa` challenge records its first factor (`password`, `email_code`,
  `reset`) and the methods issued with it; both second-step routes refuse any method not issued. After a reset link
  or an emailed sign-in code the `email` method is never offered, so only an authenticator can follow. A user whose
  only second step is email is mailbox-only by construction: for them an emailed sign-in code answers 403
  `password_login_required`, and a reset answers `password_changed` (no session; sign in with the new password and
  its email step).
- **Fail closed.** Users whose second step is email only (the method is on, or enforcement applies to their verified
  address) get 503 `mail_outage` at sign-in while mail does not work; nothing is skipped. Logged once per start, no
  address. Admin, Email warns with the count; recovery is `qinqin recover --reset-mfa` or the Users reset.
- **Enabling email codes** needs a verified address under a policy that uses addresses and working mail; an
  enrolment session is lifted only after one mailed code was verified (`POST /api/account/mfa/email/confirm`).
- Wrong emailed sign-in codes use their own budget (per user for known, per identifier for unknown), not the user's
  second-step budget.
- Changing the email needs the authenticator code too, cancels pending reset links and mails the old address.
- Mail caps: 10 mail-triggering anonymous requests per client and hour; anonymous kinds may use three quarters of
  the 200 mails per hour. An anonymous reset request replaces only self-service links, never an admin's.
