# v0.3.0 accounts (#64) — overview and shared rules

Date: 2026-11-15. Item 2 of `docs/superpowers/directions/2026-11-15-v0.3.0-web-build.md`.
Owner decisions: the two owner comments on #64 (they override the issue body). Written
unattended; every non-obvious decision is a `Ruling:` line. This file holds what the three
part specs share; the parts are:

| Part | Spec | Plan |
|---|---|---|
| 1 Sessions and the access gate | `...-accounts-users-sessions-design.md` §1–§3 | `plans/2026-11-15-v030-accounts-1-sessions.md` |
| 2 Registration, users, reset links | `...-accounts-registration-design.md`, `...-users-sessions-design.md` §4–§7 | `plans/2026-11-15-v030-accounts-2-registration-users.md` |
| 3 SMTP, email, MFA, passwordless | `...-accounts-smtp-mfa-design.md` | `plans/2026-11-15-v030-accounts-3-smtp-mfa.md` |

Execution order is 1 → 2 → 3; each plan is one topic branch (`feature/v030-accounts-sessions`,
`-registration-users`, `-smtp-mfa`) cut from the then-current `feature/v0.3.0`.

## What exists today (checked against `feature/v0.3.0` = develop `6266171`)

- `server/internal/auth/auth.go`: argon2id (64 MiB, t=3, p=4, PHC string), `CreateUser`,
  `CreateFirstUser` (atomic `INSERT … SELECT … WHERE NOT EXISTS`), `Login` (dummy-hash timing
  equalisation), `UserFromRequest` (bearer token → user).
- `sessions(token TEXT PK, user_id, updated_at)`: **tokens are stored in plain text** and never
  expire; logout in the web app only forgets the token locally, the server row lives forever.
- `handlers_auth.go`: `register` (first user → admin; afterwards an admin bearer creates a
  non-admin user), `login` → `{token}`, `me`. Errors are plain text.
- Every protected handler calls `s.requireUser` / `s.requireAdmin` (one chokepoint); one handler
  (`handleGetEntry`) uses optional auth via `auth.UserFromRequest`. No middleware, no access log,
  no client IPs anywhere.
- `ai.Sealer` (AES-256-GCM, key = HMAC-SHA256(QINQIN_SECRET, label), AAD binding, fingerprint,
  `QINQIN_SECRET_PREVIOUS` rotation) and `ai` netguard (SSRF policy, guarded dialer).
- Web: `lib/auth.ts` (store, login/register/logout), `lib/api/client.ts` (a 401 anywhere drops the
  token), `lib/routeAccess.ts` (auth-only/open/private), Settings tabs in `lib/settings/tabs.ts`
  (`workspaces, home, plugins, ai, data`; Data is admin-only).
- Foreign keys are declarative only (`db.go`, decision #1: "revisit if user deletion is ever
  added"). User deletion is added now; see the users spec §6.

## #1 leftovers — verified against current code

| Item | State | What remains (and where it is handled) |
|---|---|---|
| Bootstrap race | Fixed: `CreateFirstUser` is one statement; `TestConcurrentFirstRegisterCreatesOneAdmin` | New invite/open paths must not reintroduce count-then-insert: invite use + user insert in one transaction (registration spec §3) |
| Login timing | Fixed: unknown usernames verify against `dummyHash`; `TestLoginUnknownUserStillVerifies` | (a) `dummyHash` is computed lazily, so the *first* unknown-user login costs two argon2 runs: warm it in `api.New` (plan 1 task 2). (b) New branches (disabled, MFA, must-change) are decided only after the password check, so they add no pre-verify timing difference. (c) Reset-request and email-code start do the same DB work for known and unknown identifiers and hand mail to an async queue |
| FK pragma | Documented "stays off" | User deletion deletes from every user table explicitly in one transaction, guarded by a schema-walking test (users spec §6) |
| 409 duplicate | Covered: `TestRegisterDuplicateUsername` | — |
| Discarded register responses in test setup | Still present (`register(t, ts, "", "alice", "secret")` in several tests) | Fixed while the helpers change for the password policy (plan 1 task 3) |

Not a #1 item but found while reading: `deleteWorkspace` (`handlers_workspaces.go`) opens a
transaction and then runs its `DELETE`s through `s.db`, not `tx`, so the deletion is not atomic
and the "takes SQLite's write lock" comment is false. Fixed in plan 2 (it is the pattern user
deletion must not copy).

## Shared conventions

**Error bodies.** Every route added or changed here answers errors as
`{"error":"<code>","message":"<English sentence>"}` (the AI routes already do). 429 carries
`Retry-After` (seconds). Codes are listed in the contract fixture `docs/contracts/auth/errors.json`.
Ruling: `POST /api/auth/login` and `/register` switch from plain text to the JSON body too — one
error shape for the Kotlin client — the web app is updated in the same task — cost if wrong: an
outside script that matched the plain text "bad credentials" breaks (none known).
**Conflict with the #86 design** (`docs/v030-study-day`, `…-rate-limiting-design.md`, not yet
committed when this was written): it keeps 400/401/403 on login/register as plain text "because of
the Android scaffold" and documents "the unchanged 401" in `docs/contracts/auth/throttle-responses.json`.
There is no Android code in the repository yet (`apps/` holds only `web`), so this design keeps
the JSON ruling; whichever branch merges second updates that fixture's 401 example and the #86
plan's tests that read a plain-text body. The orchestrator should confirm. #86's own codes are
reused unchanged: 429 `rate_limited` (+ `Retry-After`) and 503 `busy` (hash gate).

**401 means only "this session is gone".** The web client drops the token on any 401
(`notifyUnauthorized`). So a wrong *current* password, a wrong re-auth password and a wrong MFA
code on an authenticated route answer **403** (`wrong_password`, `code_invalid`), never 401.
Anonymous login steps (no session yet) use 401 for bad credentials and bad codes. Review Focus.

**Tokens.** Every bearer-like secret (session token, invite token, reset token, login challenge)
is 32 bytes from `crypto/rand`; sessions keep their 64-hex form, the others are base64url (43
chars). Only SHA-256 of the token is stored; lookup is by hash (`WHERE token_hash = ?`), which
is equality on a value the attacker cannot choose, so no separate constant-time compare is
needed. Short codes (6-digit email codes, TOTP, recovery codes) are compared with
`subtle.ConstantTimeCompare` on equal-length byte strings.
Ruling: plain SHA-256, no pepper — 256-bit tokens make offline guessing pointless and a pepper
would need its own key management — cost if wrong: none for tokens; codes are short-lived and
attempt-capped (smtp-mfa spec §6).

**Shown once.** A token, a reset link, an invite link, a TOTP secret or recovery codes appear in
exactly one response (the one that creates them), are never in a list/GET response, never in a
log line, never in a fixture (fixtures use obviously fake values like `"tok_example"`), and the
web app never stores them beyond the page that shows them.

**Secrets at rest.** The SMTP password and TOTP secrets are sealed with the existing
QINQIN_SECRET mechanism (smtp-mfa spec §1). Without a valid `QINQIN_SECRET` they cannot be stored,
and the features say why (same pattern as AI).

**Links in fragments.** Invite and reset links put the token after `#`
(`/register#invite=…`, `/reset#t=…`), so it never reaches the server as a URL, a proxy log or a
`Referer`. The page reads it, then `history.replaceState` removes it.
Ruling: fragment, not query or path — keeps tokens out of reverse-proxy access logs — cost if
wrong: a mail client that strips fragments breaks the link (none of the common ones do).

**Privacy.** No client IP is stored or logged anywhere (the app has none today). Sessions keep a
coarse device label, not the raw User-Agent. Mail addresses are not logged (log lines carry the
user id and the mail kind).
Ruling: no IPs even in the session list — consistent with the existing privacy stance; #86 uses
client IPs only as in-memory limiter keys, never stored — cost if wrong: a user cannot tell a
session from an unknown place apart by address; the device label and timestamps remain.

**Migrations.** Plan 1 adds `032_accounts.sql` (sessions rebuild, `users` columns,
`auth_settings`, `auth_audit`), plan 2 `033_invites_resets.sql` (`invites`, `password_resets`),
plan 3 `034_mfa_mail.sql` (`smtp_settings`, `mfa_totp`, `mfa_recovery_codes`,
`auth_challenges`, `users.mfa_email`). All additive except the `sessions` rebuild. Numbers are
provisional: whoever merges after another branch took one renumbers (the runner applies any
missing version; renumbering must keep this order). Plan 1 also adds
Go steps to the runner (`goSteps`, run inside the migration's transaction) for hashing the pre-032
session tokens.

**Hash outside transactions.** Every argon2 run happens before `BeginTx`; a write transaction
never holds SQLite's lock across a 64 MiB hash.

**Sign-in identifiers.** `POST /api/auth/login` takes the **username only** (exact match, as
today, and as #86 keys it). Reset-request and email-code sign-in accept username **or** verified
email (`@` → email; new usernames cannot contain `@`).
Ruling: password login stays username-only — #86's per-username limiter and the existing clients
key on it — cost if wrong: users who remember only their email use "Forgot password".

**User ids are never reused.** 032 rebuilds `users` with `AUTOINCREMENT` (as 022/023 did for
workspaces and books), so a deleted user's id, audit links and data directories can never pass to
a new account.

**Dependency on #86.** #86 is work item 1 and lands first. Plans 1–2 tolerate its absence (a
no-op seam); **plan 3 must not start before #86 is merged** — its code-entry routes may not ship on
a no-op limiter.

**Password policy.** New passwords (register, admin create, change, reset, CLI): 10–256
characters (runes), not equal to the username (case-insensitive). No composition rules.
Existing passwords are grandfathered.
Ruling: 10 minimum, no rules, no breach list — NIST 800-63B direction without an external data
dependency — cost if wrong: weak-but-long passwords pass; MFA exists for those who care.

## Effective policy on upgrade

Today an existing install is "closed": the first user became admin, afterwards only an admin
token creates users. Migration 032 inserts the settings row `registration='closed'`,
`email_policy='off'`, `mfa_enforced=0`, `email_code_login=0`. Existing users get
`must_change_password=0`, no email, no MFA; existing sessions keep working (their tokens are
hashed in place). Nothing changes for anyone until an admin changes a setting. A fresh database
(zero users) still lets the first registration through and makes it admin, in every mode.

## Authorization matrix (turn each row into a test)

Columns: **Anon** (no or invalid token), **PwC** (session of a user with
`must_change_password`), **Enr** (MFA-enrolment session), **User**, **Admin**. `ok` = served;
`401` unauthorized; `403p` = 403 `password_change_required`; `403e` = 403 `mfa_enrollment_required`;
`403a` = 403 `forbidden` (admin required); `m` = needs mail configured else 409 `mail_unavailable`.

| Route | Anon | PwC | Enr | User | Admin |
|---|---|---|---|---|---|
| `GET /api/auth/options` | ok | ok | ok | ok | ok |
| `POST /api/auth/register` | policy¹ | policy¹ | policy¹ | policy¹ | ok² |
| `POST /api/auth/login`, `/login/mfa`, `/login/mfa/email` | ok | ok | ok | ok | ok |
| `POST /api/auth/email-login/start`, `/verify` (m, setting) | ok | ok | ok | ok | ok |
| `POST /api/auth/reset-request` (m) | ok | ok | ok | ok | ok |
| `POST /api/auth/reset/check`, `/reset`, `/invite/check` | ok | ok | ok | ok | ok |
| `GET /api/auth/me`, `POST /api/auth/logout` | 401 | ok | ok | ok | ok |
| `POST /api/account/password` | 401 | ok | 403e | ok | ok |
| `GET /api/account/sessions`, `DELETE …/{id}`, `POST …/revoke` | 401 | 403p | 403e | ok | ok |
| `PUT /api/account/email`, `POST …/email/verify`, `…/email/resend` | 401 | 403p | ok | ok | ok |
| `POST /api/account/mfa/totp/setup`, `…/confirm`, `POST …/mfa/email` | 401 | 403p | ok | ok | ok |
| `DELETE /api/account/mfa/totp`, `POST …/mfa/recovery-codes` | 401 | 403p | 403e | ok | ok |
| `GET /api/account/deletion-preview`, `DELETE /api/account` | 401 | 403p | 403e | ok | ok³ |
| `/api/admin/users…`, `/api/admin/invites…`, `/api/admin/audit` | 403a | 403p | 403e | 403a | ok |
| `/api/admin/settings/auth`, `/api/admin/settings/smtp…` | 403a | 403p | 403e | 403a | ok |
| **Every existing user route** (`requireUser`) | 401 | 403p | 403e | ok | ok |
| **Every existing admin route** (`requireAdmin`) | 403a | 403p | 403e | 403a | ok |
| Existing public routes (search, lookup, lists…) | ok | ok | ok | ok | ok |
| `GET /api/entries/{id}` (optional auth) | anon view | anon view | anon view | own overlay | own overlay |

¹ Zero users: ok (bootstrap). Otherwise `closed` → 403 `registration_closed`; `invite` → ok with
a valid invite, else 403 `invite_invalid`; `open` → ok. ² The legacy admin-bearer path (users
spec §4). ³ The last active admin gets 409 `last_admin`.
For PwC/Enr, an admin session of a restricted user is restricted too (no admin route).
The api test walks the route table (plan 1 task 4) so a new route cannot skip this.

## Contract (docs/contracts/auth/)

Each plan ends with a "Contract notes" list. Together they produce `docs/contracts/auth/README.md`
(the sign-in state machine for the Kotlin client) and JSON fixtures: `options.json`,
`login-responses.json`, `errors.json`, `me.json`, `sessions.json`, `mfa-setup.json`,
`admin-users.json`. A Go test decodes every fixture and checks its keys and value types against a
real response from the test server, so the fixtures cannot drift.

## Flags for the orchestrator

- The JSON-vs-plain-text error conflict with #86 (above).
- #86's spec assumes register rejects anonymous callers before hashing once users exist; with
  invite/open modes anonymous registration hashes, so register needs #86's L1 bucket and hash gate
  for anonymous calls too (registration spec §2). The #86 spec should say so.
- TOTP opt-in is offered without SMTP (smtp-mfa spec §5 ruling) — beyond the owner's literal
  list, deliberately.

## Out of scope

Personal access tokens (#83, stretch), journal sharing, UI languages (#12), username changes,
WebAuthn/passkeys, storing client IPs, notification mails (password changed etc.), SMS.
