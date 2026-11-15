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

## Tokens
- A bearer token is 64 hex characters, returned once by login. Treat it as opaque; never log it,
  never show it, keep it in secure storage (the web app: `localStorage` key `qinqin.token`).
- The server stores only its SHA-256. A session unused for 90 days stops working (there is no
  absolute lifetime); each use refreshes it (at most one write per 5 minutes).
- Send `Authorization: Bearer <token>`. `POST /api/auth/logout` ends exactly that session (204).

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
must give the current password. A `password_change` session born from the login with the temporary
password may omit it; a session older than the administrator's flag may not. A forced change always
signs the other sessions out. Wrong current password: 403 `wrong_password`; repeated wrong ones:
429 (5 per 15 minutes, a right password gives its token back).

## Sessions
`GET /api/account/sessions` -> `{"sessions":[{id,device,createdAt,lastUsedAt,current}]}` newest use
first, never a token or hash. `DELETE /api/account/sessions/{id}` (204; another user's id is 404),
`POST /api/account/sessions/revoke {scope:"others"|"all"}` -> `{"revoked":n}`; `all` ends the caller
too, so clear local state afterwards.

## Client rules
Send `deviceName`; treat the token as opaque; on 401 drop the token and show sign-in; on a 403 with a
restriction code show that screen; never retry a 429 or 503 automatically; never log tokens or passwords.
