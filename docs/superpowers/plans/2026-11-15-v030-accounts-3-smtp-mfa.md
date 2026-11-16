# v0.3.0 accounts, plan 3 — SMTP, email verification, reset by mail, MFA, sign-in codes

> Execute subagent-driven (superpowers:subagent-driven-development), test first, independent
> review on the strongest model, one fix wave, whole-branch review. Starts after plan 2 is merged
> into `feature/v0.3.0`. If #86 (rate limiting) has merged, wire its limiter into the
> `limiter` seam in task 1 of this plan; otherwise keep the no-op and say so in the report.

Spec: `docs/superpowers/specs/2026-11-15-v030-accounts-smtp-mfa-design.md` (+ the overview).
Branch: `git worktree add -b feature/v030-accounts-smtp-mfa .claude/worktrees/v030-accounts-mfa feature/v0.3.0`.
Migration: `034_mfa_mail.sql` (provisional). Gates: as plan 1. New env var:
`QINQIN_SMTP_ALLOW_PRIVATE`. New web dependency: `uqr@0.1.3` (MIT, zero deps; task 15 checks the
installed `LICENSE` and records it on the Sources/licence list if the project lists JS deps).

## Rulings (plan-specific)

- Ruling: `internal/mail` depends only on `internal/netguard` and the standard library; the api
  server holds a `*mail.Service` (nil-safe: nil = mail not configured) — cost if wrong: none.
- Ruling: the Go fake SMTP server for tests lives in `internal/mail/mailtest` (test helper
  package) and speaks EHLO, STARTTLS, AUTH PLAIN/LOGIN, MAIL, RCPT, DATA, RSET, QUIT, with
  switches for "no STARTTLS", "reject auth", "reject recipient", "stall" — TLS modes are proven
  there, the real-app check uses mode `none` — cost if wrong: real-server quirks surface only in the
  owner's hand check (listed in the handoff).
- Ruling: `scripts/smtp-sink.py` (Python stdlib, no TLS, prints and stores each message) is
  committed — the owner can try mail without a provider — cost if wrong: one small script.
- Ruling: every TOTP/OTP compare uses fixed-length byte strings via `subtle.ConstantTimeCompare`;
  a non-6-digit input is rejected before comparing (length is public) — cost if wrong: none.

## Tasks

### Task 1 — Extract `secretbox` and `netguard`

Files: `server/internal/secretbox/{secretbox.go,secretbox_test.go}` (moved `Sealer`,
`ParseSecret`, `SecretState`, `ErrOpen` from `ai/secret.go`), `server/internal/netguard/…` (moved
address policy, `GuardPolicy`, guarded dialer; exported `func DialContext(p GuardPolicy, r
*net.Resolver) func(ctx, network, addr string) (net.Conn, error)` and `CheckHost(host string, p)
error`), `ai/secret.go`/`ai/netguard.go` become aliases/wrappers.
Test first: a golden test that a ciphertext sealed by the pre-move code (fixture bytes generated
once from develop with a fixed nonce via an unexported test seam) still opens; all existing `ai`
tests pass unchanged; `CheckHost` table (metadata IPs, link-local, `localhost`, RFC 1918 with and
without AllowPrivate, hostnames).
Commit `refactor: share the secret sealer and the outbound address guard`.

### Task 2 — Migration 034

Files: `server/internal/db/migrations/034_mfa_mail.sql` (`smtp_settings`, `mfa_totp(user_id PK,
secret_ct, nonce, secret_fp, confirmed_at, last_step, created_at)`, `mfa_recovery_codes(id,
user_id, code_hash UNIQUE, used_at)`, `auth_challenges` per spec §5, `ALTER TABLE users ADD
COLUMN mfa_email INTEGER NOT NULL DEFAULT 0`), test; add the new tables to `userTables` in
`auth/delete.go` (the schema guard from plan 2 fails until you do — that is the point).
Commit `feat(db): MFA and mail tables`.

### Task 3 — Message composition and templates

Files: `server/internal/mail/message.go`, `templates/*.txt` (embedded), `message_test.go`.
Interfaces: `type Message struct{ To, Subject, Body string }`; `func Compose(from Sender, m
Message, now time.Time, rnd io.Reader) ([]byte, error)`; `func Render(kind Kind, data
TemplateData) (Message, error)`; `ValidAddress(s string) (string, error)`.
Tests first: golden output (fixed clock and random); every header value with `"\r\n"`, `"\n"`,
`"\r"` (from name, to, subject data) → error, never a second header; non-ASCII display name
Q-encoded; body quoted-printable with long lines and `=`; codes absent from subjects; each
template mentions the site and the "not you" sentence; `ValidAddress` table (display-name forms
reduced, two addresses, non-ASCII, 255 bytes, control chars).
Commit `feat(mail): plain-text message composition`.

### Task 4 — SMTP transport and the fake server

Files: `server/internal/mail/send.go`, `auth_login.go`, `mailtest/server.go`, `send_test.go`.
Interface: `type Transport struct{ Host string; Port int; TLS Mode; Username, Password string;
Policy netguard.GuardPolicy; RootCAs *x509.CertPool /* tests */; Dial func(…) }`;
`func (t Transport) Send(ctx, from string, to string, raw []byte) error` returning `*SendError{
Category string; Code int }`.
Tests first (fake server with an `httptest`-style self-signed cert): starttls ok; starttls when
the server does not offer it → `tls`; implicit tls ok; wrong cert name → `tls`; auth PLAIN and
LOGIN ok; bad credentials → `auth` with code 535; mode none + credentials refused before dialing;
recipient rejected → `recipient` 550; a stalling server → `timeout` within the 30 s deadline
(deadline injected small in the test); loopback target with AllowPrivate false → `blocked` without
a connection (fake server sees nothing); the password never appears in `err.Error()`.
Commit `feat(mail): SMTP transport with TLS modes and address guard`.

### Task 5 — SMTP settings store and admin routes, test mail

Files: `server/internal/mail/settings.go` (sealed password with AAD `qinqin/smtp/v1|password`,
`Configured(ctx) bool`, `Load`, `Save`, `Delete`), `server/internal/api/handlers_admin_smtp.go`,
tests. Routes: `GET/PUT/DELETE /api/admin/settings/smtp`, `POST …/smtp/test` (spec §2).
Tests first: GET never contains the password (assert no field holds it; marshal the struct
through `%v`/`%+v`/JSON too); PUT absent password keeps, `""` clears, value replaces; no secret
+ password → 409 `secret_unavailable`; validation 422s; `none` + username → 422
`credentials_need_tls`; test mail to the fake server → 200 and the fake received exactly one
message; failure → 502 with category and code, no reply text; draft test with absent password uses
the stored one; non-admin / restricted → 403; audit `settings_changed` with field names only
(never host or user names); limiter key `smtp-test:<id>`.
Commit `feat(admin): SMTP settings and test mail`.

### Task 6 — Mail service, queue, wiring

Files: `server/internal/mail/service.go` (`Service{Settings, Queue}`; `Enqueue(kind, userID,
Message)`; worker; global cap), `server/cmd/qinqin/main.go` (env `QINQIN_SMTP_ALLOW_PRIVATE`,
start the worker, pass `api.WithMail`), `server/internal/api/api.go` (`WithMail` option),
`handlers_auth.go` (`options` uses `Configured`), tests.
Tests first: enqueue returns immediately even with a stalling server; full queue drops and logs
`mail: dropped kind=…` (captured `logf`, assert no address); log lines for sent/failed contain
`user=` and `kind=` only; `options.passwordReset` flips with configuration.
Commit `feat(mail): asynchronous mail queue`.

### Task 7 — Challenges store and email verification

Files: `server/internal/auth/challenges.go` (`NewChallenge(kind, userID *int64, emailNorm,
device)`, `SetCode` (sends ≤ 3, 60 s), `VerifyCode` (5 attempts, constant-time, deletes on
success/exhaustion), sweep in the janitor), `handlers_account.go` (`PUT /api/account/email`,
`POST /api/account/email/verify`, `POST /api/account/email/resend`), tests.
Tests first: code is 6 digits and uniform (`crypto/rand`, reject-sampling); stored hash ≠ code;
wrong code ×5 → challenge gone; resend does not reset attempts; 4th send refused; changing email
clears `email_verified_at`; full session needs password (403 `wrong_password`), enrolment session
does not; mail unconfigured → `verification:"unavailable"`; policy off → 422 `email_disabled`;
required → null 422 `email_required`; the fake SMTP inbox gets the `verify_email` mail.
Commit `feat(account): verify email addresses`.

### Task 8 — Password reset by mail

Files: `handlers_auth.go` (`POST /api/auth/reset-request`), `auth/resets.go` (mail-created
resets, 1 h), tests.
Tests first: known/unknown/disabled/unverified identifiers → identical 202 `{}` bodies and
headers; only the known verified one produces a mail with `/reset#t=` under `public_url`; the
`ident:` limiter applies equally to unknown identifiers (429 for both); `reset-mail:` limit skips
silently; no mail → 409 `mail_unavailable`; the token in the mail works with plan 2's
`/api/auth/reset`.
Commit `feat(auth): password reset by mail`.

### Task 9 — TOTP core

Files: `server/internal/auth/totp.go`, `totp_test.go`, `server/internal/auth/mfa.go`
(`TOTPStore` with sealing AAD `qinqin/mfa_totp/v1|user=<id>`, `BeginTOTP`, `ConfirmTOTP`,
`VerifyTOTP(ctx, userID, code, now) error` with the guarded `last_step` update, recovery codes:
`NewRecoveryCodes`, `UseRecoveryCode`).
Tests first: RFC 6238 appendix B SHA-1 vectors (8-digit, via a digits parameter) and our 6-digit
truncation; window ±1 accepted, ±2 refused; the same code twice → second refused (replay);
two goroutines verifying one code → one success (`-race`); undecryptable secret → `ErrMFAUnavailable`;
recovery codes: 10 × 16 base32, normalisation (case, spaces, dashes), single use, hash stored.
Gate incl. `go test -race -run TOTP ./internal/auth/`. Commit `feat(auth): TOTP and recovery codes`.

### Task 10 — MFA account routes

Files: `server/internal/api/handlers_mfa.go` (new): `POST /api/account/mfa/totp/setup`,
`POST …/totp/confirm`, `DELETE /api/account/mfa/totp`, `POST /api/account/mfa/recovery-codes`,
`POST /api/account/mfa/email`; `me` gains `mfa:{totp, email, recoveryCodesLeft}`;
`AdminUser.mfa`; tests.
Tests first: setup returns secret + `otpauth://` URI once, `GET`-style routes never return it;
confirm with a valid code → recovery codes; enrolment session → `full` after confirm (same token
now reaches `/api/workspaces`); disable needs password + code, a wrong code there or on
regenerate is **403** `code_invalid`; `mfa/email` skips the password in an enrolment session; under enforcement without another
method → 409 `mfa_required`; no secret → 409 `secret_unavailable`; restricted PwC → 403;
audit `mfa_enabled`/`mfa_disabled`.
Commit `feat(account): two-factor enrolment`.

### Task 11 — Login second step and enforcement

Files: `handlers_auth.go` (login decision per spec §5 rules 1–5; `POST /api/auth/login/mfa`,
`POST /api/auth/login/mfa/email`), `auth/settings.go` (`mfaEnforced`, `emailCodeLogin` allowed
when mail configured; `mfaEnforcedEffective`; PATCH option `signOutOthers` on enabling), tests.
Tests first: TOTP user → `mfa_required` with methods and **no session row created**; wrong code →
401 `code_invalid` `attemptsLeft`; 5 → `challenge_expired`; per-user `mfa:` limit across fresh
challenges → 429; recovery code works once and audits `recovery_code_used`; email method → code
via fake SMTP; enforced + verified email → `mfa_required` with `email`; enforced + no email →
`mfa_enrollment_required` with an `enroll` session that the route walk (plan 1) restricts; live
sessions untouched when enabling, all others gone with `signOutOthers`; `must_change` + MFA →
MFA first, then `password_change_required`; reset (plan 2) of a TOTP user answers `mfa_required`;
mail removed → enforcement inactive, TOTP still asked; account delete now requires `code` for TOTP
users.
Commit `feat(auth): two-step sign-in and enforcement`.

### Task 12 — Admin MFA reset and CLI

Files: `handlers_admin_users.go` (`POST /api/admin/users/{id}/mfa/reset`), `cmd/qinqin/recover.go`
(`--reset-mfa` real), tests: TOTP, recovery codes, `mfa_email` removed, sessions gone, audit
`mfa_reset`. Commit `feat(admin): reset a user's two-factor`.

### Task 13 — Passwordless sign-in by code

Files: `handlers_auth.go` (`POST /api/auth/email-login/start`, `/verify`), tests.
Tests first: unknown identifier → 202 with a challenge and **the same key set and timing path**
(the fake SMTP inbox stays empty); known → code mail; verify ok → `status:"ok"` session; TOTP
user → `mfa_required` (`totp`,`recovery`); enforced and no TOTP → 403 `password_login_required`;
switch off → 409 `email_login_unavailable`; disabled user → behaves as unknown; wrong codes
count in `mfa:<user id>` and `mfa-day:<user id>` together with MFA challenges (11th wrong code in
15 min across fresh challenges → 429).
Commit `feat(auth): sign in with an emailed code`.

### Task 14 — Secret rotation for SMTP and TOTP

Files: `server/internal/secretbox/rotate.go` (`Rotator` used by `ai.KeyStore.Rotate` and the two
new tables), `cmd/qinqin/ai_env.go` → `secrets_env.go` (one place reads `QINQIN_SECRET`/
`_PREVIOUS` and hands sealers to AI, mail and auth), tests: rows sealed with the previous secret
are re-sealed with the current one and still decrypt; a third unknown secret → `undecryptable`
states in `GET …/smtp` and TOTP verify → recovery code still works; log lines carry counts only.
Commit `feat: rotate SMTP and TOTP secrets with QINQIN_SECRET_PREVIOUS`.

### Task 15 — Web: login second step, code sign-in, reset request

Files: `lib/account/loginFlow.ts` (states `mfa`, `emailCode`), `lib/account/otpInput.ts`
(+ test), `routes/login/+page.svelte`, `routes/reset/+page.svelte` (request form), dom tests;
`npm i uqr@0.1.3` (exact pin; read `node_modules/uqr/LICENSE`: MIT) — used in task 16.
Tests first: login → `mfa_required` shows the code step with focus on its heading; recovery
toggle; "Email me a code instead" shows the masked address and a 60 s resend countdown
(`aria-live`); `attemptsLeft` in the error; `challenge_expired` returns to step 1 with a sentence;
code sign-in flow; reset request always shows the same "If the account has a verified email…"
sentence.
Commit `feat(web): two-step sign-in and sign-in codes`.

### Task 16 — Web: two-factor setup, forced enrolment, email verification

Files: `lib/account/TwoFactorSetup.svelte`, `lib/account/QrCode.svelte` (rects from
`lib/account/qrMatrix.ts` + test), `lib/account/mfaView.ts` (+ test), `lib/account/recoveryCodes.ts`
(+ test: formatting, `.txt` content), `routes/account/two-factor-setup/+page.svelte`,
`AccountSettings.svelte` (Two-factor section, email verify field), dom tests.
Tests first: QR renders N×N rects for a known input, secret text and Copy present (text
alternative); confirm → recovery codes page, Continue disabled until "I have saved these codes";
forced enrolment page lands back on `/` after confirm; email method path (add → code → enable);
TOTP hidden with the secret sentence when `secret` is unavailable; mail-only bits hidden without
mail.
Commit `feat(web): two-factor setup`.

### Task 17 — Web: Admin → Email and Security switches

Files: `lib/admin/EmailAdmin.svelte`, `lib/admin/smtpForm.ts` (+ test: password tri-state, port
defaults per TLS mode 587/465/25, category → sentence), `SecurityAdmin.svelte` (switches live),
dom tests.
Tests first: saved password shows "A password is saved" and is never prefilled; Replace/Remove;
`none` shows the plain-text warning; test mail success/failure sentences; enabling enforcement
shows "Sign everyone else out now" and the no-TOTP warning for the acting admin.
Commit `feat(web): email setup and two-step policy for admins`.

### Task 18 — SMTP sink script, contract, docs

Files: `scripts/smtp-sink.py` (stdlib `socketserver`; `--port`, `--dir`; answers EHLO/MAIL/RCPT/
DATA/QUIT; writes `<n>.eml`; prints one line per message with the subject only),
`docs/contracts/auth/{mfa-setup,login-responses}.json` (add `mfa_required`,
`mfa_enrollment_required`, email-code flow), `errors.json` (`code_invalid`, `challenge_expired`,
`mfa_required`, `password_login_required`, `secret_unavailable`, `email_login_unavailable`,
`smtp_test_failed` …), `README.md` (spec §10), `docs/ROADMAP.md` (#64 entry, via the
orchestrator's normal flow). Commit `docs: email, two-step sign-in and the SMTP sink`.

### Task 19 — Gates and real-app check with a fake SMTP server

Full gates. Real-app check, curl + Python only:
1. `docker network create qq-acct3`; start the sink: `docker run -d --name qq-acct3-sink
   --network qq-acct3 -u $(id -u):$(id -g) -v $WT/scripts:/s:ro -v $SP/acct3/mail:/m
   python:3.13-alpine python -I /s/smtp-sink.py --port 2525 --dir /m`.
2. Start the branch binary (static build from a copy of `$WT`) in `alpine` on the same network,
   `-p 127.0.0.1:$P:8080`, env `QINQIN_SECRET=$(head -c32 /dev/urandom | base64)`,
   `QINQIN_SMTP_ALLOW_PRIVATE=1`, data in `$SP/acct3/data`.
3. Bootstrap `owner`; `PUT …/smtp` host `qq-acct3-sink`, port 2525, tls `none`, from
   `qinqin@example.test`, publicUrl `http://127.0.0.1:$P`; `GET` shows `password:"none"`;
   test mail → 200, a file appears in `$SP/acct3/mail`.
4. Email policy `optional`; owner sets email (admin-set via PATCH → verified); `reset-request`
   for owner and for `nobody` → identical 202 bodies; one mail only; follow its `#t=` token
   through `reset/check` + `reset`.
5. TOTP: setup → compute the code with `python3 -c` (hmac/sha1/struct, ~10 lines inline) →
   confirm → recovery codes; logout; login → `mfa_required`; same code twice → second refused;
   recovery code → ok.
6. Enforce MFA; create `bob` without email; bob login → `mfa_enrollment_required`; bob's token on
   `/api/workspaces` → 403; bob enrols TOTP → workspaces 200.
7. Enable code sign-in; `email-login/start` for owner and `nobody` → same shape; owner's code from
   the sink file → verify → `mfa_required` (owner has TOTP) → TOTP → ok.
8. `grep -r` the server log and `$SP/acct3/mail` for the SMTP password, TOTP secret, session
   tokens: password and secrets absent from the log; codes/links only in the mails.
Stop and remove both containers and the network; remove `$SP/acct3` via an alpine container.
Not verified here (handoff for the owner): a real provider over STARTTLS/implicit TLS, Microsoft
365 AUTH LOGIN, real authenticator apps scanning the QR, mail delivery/spam placement.

## Review Focus

- **MFA bypass**: no session row before the second step; enrolment sessions restricted on every
  route; reset and code sign-in still ask TOTP; recovery codes single use; challenge attempts
  not reset by resend; per-user limit across challenges.
- **Replay and timing**: guarded `last_step` update; constant-time compares on fixed lengths;
  unknown identifiers take the same path (store a challenge, no mail) and responses are identical.
- **SMTP header injection**: every header built by `Compose`; CR/LF refusal tested per field;
  addresses validated before storage and again before sending.
- **SSRF**: dial-time check on resolved addresses; metadata/link-local blocked even with the
  private switch; no banner/reply text returned.
- **Secret leakage**: SMTP password and TOTP secret sealed, never in GET/list/log/audit/error
  strings; `%v` of the settings struct redacts; fixtures use fake values; the stored password is
  never sent to a host/port/TLS/username it was not entered for (re-entry rule).
- **Enumeration**: reset-request, email-login start, login (incl. disabled and MFA) answer the
  same for unknown and known identifiers until a secret has been proven.
- **Hidden without mail**: every mail-dependent switch and link keyed on `Configured`.

## Contract notes

- `login-responses.json` gains `mfa_required` (challenge, methods, emailHint, expiresAt) and
  `mfa_enrollment_required`; `mfa-setup.json` (setup and confirm responses with fake values).
- State machine in `docs/contracts/auth/README.md`: credentials → [mfa] → [password change] →
  [enrolment] → full; code sign-in path; resend/attempt rules (3 sends, 60 s, 5 attempts, 10 min);
  `Retry-After` handling; the client never stores challenges beyond the screen.
- Kotlin: TOTP is entered by the user (no client-side TOTP computation); recovery-code input
  normalisation (case, spaces, dashes) is server-side, the client may strip whitespace.

## Execution record (built on `feature/v030-accounts-3`)

Tasks 1-18 in order, one commit each (task 1 `9319a2f`, 2 `a0f9973`, 3 `937573e`, 4 `6b12181`, 5 `153c969`, 6 `e1a9b0a`,
7 `b31f655`, 8 `1e60fd5`, 9 `28ba497`, 10 `0253eb2`, 11 `7a4a995`, 12 `64c7584`, 13 `49a120d`, 14 `2626dac`, 15 `c5c1998`,
16 `cf7e298`, 17 `2a7b4d9`, 18 `10189cd`), plus fixes `e69684d` (recovery file date: local day, the UTC guard) and `ac27902`
(`QINQIN_SMTP_ALLOW_PRIVATE` in both stacks, found by the full gate). Task 19: full Go gate green (api 246 s), web check/test/build
exit 0, full vitest under Node 26 green (233 files, 3793 tests), real-app check (built binary, local SMTP sink, Python driver, 30
checks, all passed, scratch removed).

Rulings and deviations:
- Ruling: `mail.Configured` = `Store.Configured`; `s.mailConfigured(ctx)` now takes a context. `passwordReset` in the public options is
  exactly "mail works" (the web reads it as such); `totpAvailable` and the effective `mfaEnforced` joined the options.
- Ruling: admin SMTP PUT/DELETE do not ask the admin's password (settings, like `settings/auth`); the stored password never follows a new
  host (re-entry rule) and a draft test is bound by it. MFA reset of another user DOES ask it (plan 2 rule) and refuses oneself (`self_target`).
- Ruling: a username without a password is refused (`password_required` 422 on the SMTP form). Audit for SMTP: `settings_changed`
  `{field: "smtp", to: "saved"|"removed"}`; no new audit keys were needed (`scope` carries totp|email for `mfa_enabled/disabled`).
- Deviation: `ValidAddress` is strict (a bare address; no display-name "reduction").
- Deviation: `Job.Build` receives the mail Config; the reset link is created on the worker (`created_by` NULL, 1 h).
- Deviation: error code `password_login_required` (403) instead of `password_required` (already 422 for admin actions); added
  `method_unavailable`, `email_login_unavailable`, `setup_expired`, `not_enabled`, `email_unverified`, `nothing_to_verify`.
- Ruling: a PUT /api/account/email in an enrolment session needs no password (plan 3 table), `verification` has a third value `none`.
- Ruling: recovery codes are looked up by SHA-256 (equality on a hash), TOTP/email codes use `subtle.ConstantTimeCompare` on fixed lengths.
- Ruling: challenges for an unknown identifier remember the identifier in `email_norm`, so their wrong-code budget is per identifier and
  equals a known user's. Resend of a sign-in code = start again (`ident` 5/h). Email-code sign-in also works for a must-change account
  (same trust as a mailed reset link).
- Ruling: users with must-change + TOTP: second step first. `ForcePasswordChange` unchanged.
- Deviation: QR drawn as one `<rect>` per horizontal run of dark modules (not per module); `uqr@0.1.3` MIT verified in node_modules and
  shipped as `static/UQR-LICENSE.TXT` (byte-equal test) with a "Built into the app" credit.
- Deviation: the reset page sends a user with two-step sign-in to the sign-in page after the password change (no second step UI there).
- New contract files: `mfa-login.json`, `mfa-setup.json` (exercised by `contract_mfa_test.go`); `me.mfa`, `AdminUser.mfa`, options keys.
- Added: `qinqin recover --reset-mfa` real (audit `mfa_reset`, actor cli), `RevokeAllExcept` for "sign everyone out now", `secretbox.Rotator`.

Not verified (owner hand-checks): a real provider over STARTTLS / implicit TLS, Microsoft 365 AUTH LOGIN, real authenticator apps
scanning the QR, mail delivery and spam placement, Admin -> Email and the two-factor pages in a real browser (jsdom only), MFA reset
button for admins in the Users UI (route exists, no button), upgrade from a v0.2.x release.
