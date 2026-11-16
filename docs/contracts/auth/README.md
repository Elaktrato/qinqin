# Auth: sessions, sign-in states, errors (contract)

For the web app and the future Kotlin client. Fixtures in this folder are decoded and compared
with real server responses by `server/internal/api/contract_auth_test.go`; run it with
`go test -count=1` after editing a fixture (Go does not track files outside the module in its test
cache). Sign-in throttling has its own page: `throttling.md` and `throttle-responses.json`.
This file and `errors.json` are the one error contract; `throttle-responses.json` holds worked
examples of its throttling subset and a test checks that both agree on every code and status.

| File | What it fixes |
|---|---|
| `errors.json` | Every auth error code, its status and meaning. Bodies are always `{"error","message"}` |
| `login-responses.json` | The three answers of `POST /api/auth/login` that carry no throttle code |
| `me.json` | `GET /api/auth/me`: the user plus the session's `restriction` |
| `sessions.json` | Logout, change password, the session list and revoke routes, and the restricted answer |
| `options.json` | `GET /api/auth/options` in the four states (bootstrap, closed, invite, open) |
| `invites.json` | Invite create (the token is shown once), list, revoke, check |
| `admin-users.json` | `AdminUser`, create / patch, last-admin and self-target refusals, reset link, deletion preview and delete |
| `mfa-login.json` | `mfa_required`, the second step, `mfa_enrollment_required`, sign-in by emailed code |
| `mfa-setup.json` | Authenticator setup and confirm (secret and recovery codes shown once) |
| `reset.json` | Reset link check and use (a login-shaped answer) |
| `tokens.json` | Personal access tokens: create (the token is shown once), list, revoke one / all, and every refusal of the token gate |
| `tokens-routes.json` | GENERATED from the route table: every route an access token may use, its scope and how a workspace-limited token fares (`any`, `query`, `refused`) |
| `tokens-format.json` | The access token string: prefix, scanner regex, valid and invalid examples, hint, the stored SHA-256 of a fixed test string |

## Tokens
- A bearer token is 64 hex characters, returned once by login. Treat it as opaque; never log it,
  never show it, keep it in secure storage (the web app: `localStorage` key `qinqin.token`).
- The server stores only its SHA-256. A session unused for 90 days stops working (there is no
  absolute lifetime); each use refreshes it (at most one write per 5 minutes).
- Send `Authorization: Bearer <token>`. `POST /api/auth/logout` ends exactly that session (204).

## Personal access tokens
- For scripts. Created in Settings (`POST /api/account/tokens`, full session plus the current
  password); the string `qq_pat_` + 64 lowercase hex is shown once, in the create answer only
  (`Cache-Control: no-store`). The server keeps only its SHA-256 and a 6-character hint; the list
  (`GET /api/account/tokens`) never carries the token. Scanner regex: `qq_pat_[0-9a-f]{64}`.
- Send it like a session: `Authorization: Bearer qq_pat_...`. A bearer starting with `qq_pat_` is
  only ever looked up as an access token, anything else only as a session token.
- `scope` `read` or `write`; `workspaceId` `null` (all workspaces) or one workspace; `expiresInDays`
  1-365, always set. At most 20 live tokens per user (`409 token_limit`).
- Only routes whose row declares token use accept one; every other route answers
  `403 token_not_allowed` before the token is looked up (account, sign-in, admin, backup, AI,
  journal, workspace management, the token routes themselves). The gate's order: not allowed (403)
  -> unknown, expired, revoked or owner disabled (401 `unauthorized`, one body) -> owner restricted
  (its 403) -> read token on a writing route (`403 token_read_only`) -> outside the token's
  workspace (`403 token_workspace`) -> per-user token rate limit (`429 rate_limited`).
- Every password change or reset, MFA reset, disable, session revocation by the user or an
  administrator, account deletion, and deleting the workspace a token is limited to revokes tokens.
  Tokens are never in a backup.

## 401 versus 403
- **401 `unauthorized`** means this session is gone (unknown, idle, revoked, user disabled or
  deleted). Drop the token and show sign-in. `401 bad_credentials` on `POST /api/auth/login` is the
  anonymous sign-in step, not a lost session.
- **403** never means "session gone". A wrong re-entered password is **403 `wrong_password`** so
  the client keeps its token. Branch on the `error` code, not on the message.

## Restrictions
`GET /api/auth/me` returns the user object plus `restriction`: `""` (full), `"password_change"`
(an administrator set a temporary password) or, from a later release, `"mfa_enrollment"`. A
restricted session may only call routes that accept it: `me`, `logout`, `POST /api/account/password`
(password change). Everything else answers **403 `password_change_required`** (or
`mfa_enrollment_required`); the token stays valid. Show the matching screen, reload `me` afterwards.
The restriction is checked before the administrator bit, so a restricted admin has no admin routes.
Unauthenticated-or-restricted callers get the same anonymous view on optional-auth routes
(`GET /api/entries/{id}`).

## Login (`POST /api/auth/login {username, password, deviceName?}`)
- `200 {"status":"ok"|"password_change_required","token","user"}`. Both statuses carry a usable
  token. `password_change_required` means: go to the change-password screen.
- `401 bad_credentials` (unknown user, wrong password, and a disabled user with a wrong password),
  `403 account_disabled` (right password, disabled account), `429 rate_limited`, `503 busy`.
- Every branch spends exactly one password hash, so timing does not tell the cases apart.
- `deviceName` (max 64 characters, control characters dropped) names the session in the session list;
  send one such as "qinqin Android - Pixel 8". Without it the server derives a coarse label from the
  `User-Agent` ("Firefox on Linux", "Unknown device"); the raw User-Agent is never stored.

## Password and username policy
New passwords: 10-256 characters, not equal to the username (any letter case), no other rules
(`422 weak_password`, `message` names the rule). New usernames: 3-32 letters, digits, `.`, `_`, `-`
(no `@`), case-insensitively unique (`422 invalid_username`, `409 username_taken`).

## Change password (`POST /api/account/password`)
`{currentPassword, newPassword, signOutOthers?}` (`signOutOthers` defaults to true). A full session
must give the current password; `me.needsCurrentPassword` says whether to ask for it up front. An
empty one is `403 current_password_required` (nothing counted). Only the session born from the login
with the temporary password may omit it (a forced change deletes every other session of the user, and
the temporary session is recognised by a session-id watermark, not a timestamp). A forced change always
signs the other sessions out. Wrong current password: 403 `wrong_password`; repeated wrong ones:
429 (5 per 15 minutes, a right password gives its token back).

## Sessions
`GET /api/account/sessions` -> `{"sessions":[{id,device,createdAt,lastUsedAt,current}]}` newest use
first, never a token or hash. `DELETE /api/account/sessions/{id}` (204; another user's id is 404),
`POST /api/account/sessions/revoke {scope:"others"|"all"}` -> `{"revoked":n}`; `all` ends the caller
too, so clear local state afterwards.

## Registration (`POST /api/auth/register`)
Read `GET /api/auth/options` first (public, uncached): `bootstrap`, `registration` (`closed` | `invite` |
`open`), `emailPolicy` (`off` | `optional` | `required`), `passwordReset`, `emailCodeLogin` (the last two
are false while the server has no mail), `passwordMinLength`. Body `{username, password, email?, invite?}`
answers `201` with the user; then sign in as usual. `403 registration_closed` (mode closed),
`403 invite_invalid` (one code and one body for an unknown, expired, used up or revoked invite, and for a
missing one in invite mode), `422 email_required | email_disabled | invalid_email`, `409 email_taken |
username_taken`, `422 weak_password | invalid_username`. An invite supplied in `open` mode is spent too and
must be valid. The first user on an empty instance registers in every mode and becomes administrator.
An invite arrives as a link `https://host/register#invite=<token>`: the Kotlin client opens it as a deep
link, calls `POST /api/auth/invite/check {invite}` (200 `{expiresAt, emailPolicy}` or 403) and registers with
the token. The token is in the fragment so it never reaches a server log.

## Reset links
An administrator issues one (`POST /api/admin/users/{id}/reset-link`, link `https://host/reset#t=<token>`,
valid 1 to 168 hours, default 24, one live link per user). The holder calls `POST /api/auth/reset/check
{token}` (`200 {username, expiresAt}` or `400 token_invalid`) and then `POST /api/auth/reset {token, password,
deviceName?}`: the password is set, a forced change is cleared, **every** session of the user is deleted, and
the answer is login-shaped (`{"status":"ok","token","user"}`). A weak password is `422 weak_password` and the
link stays usable. Plan 3 adds the two-factor branch (`mfa_required` instead of a session): a client must treat
an unknown `status` as "not signed in".

## Administration (web only in v0.4.0)
Email addresses are validated as: one `@`, an ASCII local part (non-ASCII is `422 invalid_email`), an IDNA domain
stored in punycode, at most 254 bytes. Deleting another user, issuing a reset link and granting admin need the acting
administrator's own `currentPassword` (`422 password_required`, `403 wrong_password`).
`/api/admin/users`, `/api/admin/invites`, `/api/admin/settings/auth`, `/api/admin/audit` are used by the web
admin screens only; the Kotlin client needs just the routes above, `PUT /api/account/email`,
`GET /api/account/deletion-preview` and `DELETE /api/account` (self deletion: `{password, confirm}`; 409
`last_admin` for the last active administrator). Deleting an account removes its data in one transaction (the
exact list is in the project README, "Registration, invites and user management").

## Client rules
Send `deviceName`; treat the token as opaque; on 401 drop the token and show sign-in; on a 403 with a
restriction code show that screen; never retry a 429 or 503 automatically; never log tokens or passwords.


## Two-step sign-in and email codes (state machine)
credentials -> [mfa] -> [password change] -> [enrolment] -> full.
- `POST /api/auth/login` answers `mfa_required` (no token) when the account has an authenticator or
  the email method, or when the administrator requires two steps and the address is verified (then
  `methods` is `["email"]`). Answer with `POST /api/auth/login/mfa {challenge, method, code}`;
  `method` is `totp`, `recovery` (any case, spaces and dashes are ignored by the server) or `email`
  (ask for the mail first with `POST /api/auth/login/mfa/email`, 202 `{resendAfter: 60}`).
- Limits: 5 wrong codes per challenge (all methods together; resends do not reset them), challenge
  10 minutes, at most 3 mails per challenge 60 s apart, and per user 10 wrong codes / 15 min and 30 / day
  across fresh challenges (`429 rate_limited` with `Retry-After`). The steps are anonymous: bad
  codes are 401 (`code_invalid` + `attemptsLeft`, `challenge_expired`).
- Must-change-password comes after the second step: the second-step answer is
  `password_change_required` with a token. With two-step sign-in required and no verified address
  the login answer is `mfa_enrollment_required` WITH a token of a restricted session (`me.restriction`
  is `mfa_enrollment`); finish with `POST /api/account/mfa/totp/setup` + `confirm` or the email method.
- Sign in by emailed code (when `options.emailCodeLogin`): `POST /api/auth/email-login/start {login}`
  is always 202 with the same keys for any identifier; `verify {challenge, code}` answers like a login
  (`mfa_required` with `totp`/`recovery` for a user with an authenticator; `403 password_login_required`
  under enforcement without one). Resend = start again.
- Password reset by mail: `POST /api/auth/reset-request {login}` is always 202 `{}`;
  `409 mail_unavailable` when the server has no mail. Using a reset link for an account with two-step
  sign-in answers `mfa_required` (no session): sign in with the new password.
- `options.passwordReset` is true exactly when the server can send mail; `totpAvailable` is false
  without a usable `QINQIN_SECRET`; `mfaEnforced` is the effective switch.
- Email verification: `PUT /api/account/email` answers `verification`: `sent`, `unavailable` or
  `none`; `POST /api/account/email/verify {code}` (403 `code_invalid` / `challenge_expired`).
- The client never computes TOTP and never stores a challenge beyond its screen.

## Second-wave rules
- `mfa_required.methods` lists exactly what may be answered; `email` appears only after a password sign-in. After a
  reset link or an emailed sign-in code it is absent and `/login/mfa/email` answers 409 `method_unavailable`.
- `POST /api/auth/reset` may answer `{"status":"password_changed"}` (no token): the account's second step is email, so
  sign in with the new password.
- `POST /api/account/mfa/email {enabled:true}` in an enrolment session answers 202 `{confirm:true}` and mails a code;
  `POST /api/account/mfa/email/confirm {code}` finishes it (and only then ends the restriction).
- `POST /api/auth/login` may answer 503 `mail_outage` (second step by email while mail is down): retry later.
- `PUT /api/account/email` also takes `code` (authenticator or recovery code) for accounts with an authenticator.
