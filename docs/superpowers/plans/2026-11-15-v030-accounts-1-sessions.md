# v0.3.0 accounts, plan 1 — hashed sessions, the access gate, change password, session control

> Execute subagent-driven (superpowers:subagent-driven-development): a fresh implementer per
> task, test first (superpowers:test-driven-development: write the test, SEE it fail, implement,
> see it pass), an independent review on the strongest model, one fix wave, a whole-branch review.

Specs: `docs/superpowers/specs/2026-11-15-v030-accounts-design.md` (shared rules, authorization
matrix) and `…-accounts-users-sessions-design.md` §1–§3, §8. Issue #64 (owner comments win).
Branch as built: `feature/v030-accounts-1` (worktree `.claude/worktrees/v030-accounts-1`), cut from `feature/v0.3.0` at `1914ed9`, then merged with the later tip (`8c3e8f8`).
Migration: `032_accounts.sql` (provisional number; renumber at merge if taken).
Rules: `/home/user/qinqin-v030/AGENT-RULES.md`. One commit per task, conventional, trailer
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Gates

```bash
WT=/home/user/www/github/qinqin/.claude/worktrees/v030-accounts-sessions
SP=/tmp/claude-1000/-home-user-www-github-qinqin--claude-worktrees-feature-reader/768f9452-f6f2-4d96-9ec8-321a7a58ebb3/scratchpad
GO() { docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -e GOPATH=/gp -e GOCACHE=/gc \
  -v $SP/gp-m:/gp -v $SP/gc-m:/gc -v $WT:/src -w /src/server -e GOTOOLCHAIN=auto \
  -e GOFLAGS=-buildvcs=false golang:1.26 sh -c "$*"; }
# per task:   GO "go vet ./internal/auth/... ./internal/api/... && go test -p 2 -run 'Pattern' ./internal/auth/ ./internal/api/"
# web:        npm --prefix $WT/apps/web run check; echo $?; npm --prefix $WT/apps/web test; echo $?
# last task:  GO "go vet ./... && go test -p 2 -timeout 30m ./..." and the three web gates incl. run build
```
Never two Go gates at once. After each gate: `git -C $WT status --short` clean apart from the
task's files, `find $WT -user root` empty.

## Rulings (plan-specific; the spec rulings apply as written)

- Ruling: the auth package returns a `Principal` but `requireUser` keeps returning
  `*model.User` — zero edits in the ~25 existing handler files — cost if wrong: handlers that later
  need the session id call `requirePrincipal`.
- Ruling: if #86 (`internal/ratelimit`, `authLimits` on `server`, `withHashGate`) has merged
  when this plan starts, account routes use it directly; otherwise `internal/api/authlimit.go`
  defines the seam `type limiter interface{ Allow(key string) (bool, time.Duration) }` (an adapter
  over `ratelimit.Bucket.Take` later) with a no-op default, and whichever branch merges second
  wires the real buckets and wraps the new argon2 calls in the hash gate — cost if wrong: until
  then re-auth guessing is bounded only by argon2 cost.
- Ruling: test passwords across the Go tests become `"secret-pass-1"`-style (≥ 10) in one
  mechanical task instead of exempting tests from the policy — the policy then has no test-only
  bypass — cost if wrong: a large but trivial diff.
- Ruling: `GET /api/auth/me` stays the user object (not wrapped) and gains fields — the web store
  and any script keep working — cost if wrong: none.

## Tasks

### Task 1 — Go steps in the migration runner + migration 032

Files: `server/internal/db/db.go`, `server/internal/db/migrations/032_accounts.sql`,
`server/internal/db/gosteps.go` (new), `server/internal/db/migrate_032_test.go` (new).
Interface: `var goSteps = map[string]func(*sql.Tx) error{"032_accounts": hashSessionTokens}` —
keyed by the **full** version name `versionOf` returns — run inside `applyMigration`'s
transaction right after the SQL.
SQL: rebuild `users` with `id INTEGER PRIMARY KEY AUTOINCREMENT` (pattern of
`022_workspaces_autoincrement.sql`, ids copied verbatim) adding `email`, `email_norm`,
`email_verified_at`, `disabled_at`, `must_change_password`, `must_change_set_at`, `created_at`
(from `updated_at`), `password_changed_at`;
`CREATE UNIQUE INDEX idx_users_email_norm ON users(email_norm) WHERE email_norm IS NOT NULL`);
sessions rebuild (spec §1); `auth_settings` + its row (registration spec §1); `auth_audit`
(users spec §7) + index `(at)`.
Test first: `migrateThrough(db, "031_ai_custom_name_key")`, insert two users and two sessions
with known plaintext tokens, run `migrate`; assert `token_hash = hex(sha256(token))`, `created_at =
last_used_at = old updated_at`, the settings row is `closed/off/0/0`, user defaults and ids kept;
deleting the highest-id user and inserting a new one gives a **new** id (AUTOINCREMENT); every
`goSteps` key names an embedded migration file; a failing Go step rolls back the SQL of that
version (inject a step via an unexported test hook).
Gate: `go test ./internal/db/`. Commit `feat(db): migration 032 accounts with hashed sessions`.

### Task 2 — Hashed session store, idle expiry, device label, warm dummy hash

Files: `server/internal/auth/auth.go`, `server/internal/auth/session.go` (new),
`server/internal/auth/principal.go` (new: the `Principal` type and `Restriction()` — the gate
that uses it is task 4), `server/internal/auth/device.go` (new), tests `session_test.go`,
`device_test.go`,
`server/internal/api/api.go` (call `auth.Warm()` in `New`).
Interfaces:
```go
type LoginOptions struct{ Device string; Level string } // Level "" = full
func NewSession(ctx, db, userID int64, o LoginOptions) (token string, err error)
func Authenticate(r *http.Request, db *sql.DB) (*Principal, error) // nil,nil = unauthenticated
func RevokeSession(ctx, db, userID, sessionID int64) (bool, error)
func RevokeSessions(ctx, db, userID int64, exceptSessionID int64) (int64, error) // 0 = all
func ListSessions(ctx, db, userID int64) ([]SessionInfo, error)
func DeviceLabel(userAgent string) string
func Warm() // computes dummyHash
const SessionIdle = 90 * 24 * time.Hour
```
`Login` keeps its signature but calls `NewSession`; `UserFromRequest` becomes a thin wrapper
returning `p.User` (removed in task 4).
Tests first: stored `token_hash` ≠ token and = sha256; a row inserted with the plaintext token as
`token_hash` does not authenticate; `last_used_at` older than 90 days → nil; `last_used_at`
updated only when older than 5 min (clock injected via an unexported `nowFunc`); disabled user
(`disabled_at` set) → nil; `DeviceLabel` table (Firefox/Linux, Chrome/Android, Safari/iOS,
Edge/Windows, curl → "Unknown device", empty, 2 KB garbage → ≤ 64 runes); `Warm` makes
`dummyHash` already computed (test seam: `dummyHashReady()`).
Gate: `-run 'Session|Device|Login|Warm' ./internal/auth/`. Commit `feat(auth): hash session tokens and expire idle sessions`.

### Task 3 — Password and username policy; test passwords

Files: `server/internal/auth/policy.go` (new) + test; `server/internal/api/autherr.go` (new:
`writeAuthError`, used from here on); `handlers_auth.go` (register applies them);
`server/cmd/qinqin/adduser.go`; every Go test that registers with a short password (at least
`internal/auth/auth_test.go`, `internal/api/handlers_workspaces_test.go`,
`internal/api/handlers_body_limits_test.go`, `internal/events/events_test.go`,
`internal/sync/sync_test.go`, `internal/sentences/sentences_test.go`, cmd tests — `grep -rn
'"secret"\|"pw' server --include=*_test.go`).
Interfaces: `func CheckPassword(username, password string) error` (`ErrWeakPassword` with a
reason), `func CheckNewUsername(ctx, db, name string) error` (`ErrInvalidUsername`,
`ErrUsernameTaken` case-insensitive).
Tests first: table for both (9 runes, 10, 256, 257, equals username in other case, `@` in name,
2/3/32/33 runes, Unicode letters ok, `Alice` taken when `alice` exists); register with a weak
password → 422 `weak_password`; the setup `register(...)` calls in `auth_test.go` now assert 201.
Gate: `go test -p 2 ./internal/...` (touches many packages; this is the one wide run before task 13).
Overlap: #86's plan also edits `internal/sync/sync_test.go` (`registerAndLogin` asserting 201);
expect a trivial merge conflict there and keep both changes.
Commit `feat(auth): password and username policy`.

### Task 4 — Principal, the gate, the route table, JSON auth errors

Files: `server/internal/api/handlers_auth.go`,
`server/internal/api/api.go` (routes → `func (s *server) routes() []route`),
`server/internal/api/handlers_entries.go`
(`optionalUser`), tests `gate_test.go`, `gate_static_test.go` (new).
Interfaces:
```go
func (s *server) requirePrincipal(w, r, allow ...string) *auth.Principal
func (s *server) optionalUser(r *http.Request) *model.User
func writeAuthError(w http.ResponseWriter, status int, code, message string)
```
`model.User` gains `Email *string`, `EmailVerified bool`, `MustChangePassword bool`,
`CreatedAt string` (json `email`, `emailVerified`, `mustChangePassword`, `createdAt`).
Tests first: (a) **route walk** — requests use valid path ids and a well-formed body, so a
handler that validates before authenticating cannot answer 400/404 instead; a handler found to
check auth late is fixed to authenticate first — for every pattern in `routes()`, request it with a PwC token
(user with `must_change_password=1`) and an Enr token (session `level='enroll'`): status is 403
with `password_change_required` / `mfa_enrollment_required`, except the allowlist (matrix in the
overview spec; at this point only `me`; tasks 6 and 7 add `logout` and `account/password` to the
test's allowlist) and the public routes, which are listed explicitly in the test (a new public
route must be added there on purpose); (b) admin
routes with a restricted admin's token → 403 restricted, not served; (c) `GET /api/entries/{id}`
with a restricted token is the anonymous view; (d) **static guard** — parse `internal/api/*.go`
(non-test) with `go/parser` and fail on any call to `auth.Authenticate` or `auth.UserFromRequest`
outside `handlers_auth.go`.
Gate: `-run 'Gate|Auth|Register|Login|Me' ./internal/api/ ./internal/auth/`. Commit `feat(api): restricted sessions and the access gate`.

### Task 5 — Login response, deviceName, `me`, JSON errors on login/register (server + web)

Files: `handlers_auth.go`; tests in `internal/auth/auth_test.go`;
`apps/web/src/lib/auth.ts`, `apps/web/src/lib/auth.test.ts`, `apps/web/src/routes/login/+page.svelte`,
`apps/web/src/routes/register/+page.svelte`, `apps/web/src/lib/api/client.ts`
(`apiErrorBody` already parses `{error,message}`).
Shapes: login → `{"status":"ok","token","user"}` or `{"status":"password_change_required","token","user"}`;
401 `bad_credentials`; 403 `account_disabled` only after a correct password (disabled users still
run argon2 first). Body `{username,password,deviceName?}`.
Tests first (Go): status words; a disabled user with the wrong password gets 401 (not 403);
the verifier seam counts exactly one argon2 run for unknown, wrong, disabled; error bodies are
JSON. (web, vitest): `login()` stores the token for both statuses and sets
`auth.restriction`; the login page shows "Wrong username or password." for 401 and the disabled
sentence for 403 `account_disabled`.
Gates: Go `-run 'Login|Register|Me'`; web check + test. Commit `feat(auth): login statuses and JSON auth errors`.

### Task 6 — Logout on the server

Files: `handlers_auth.go` (`POST /api/auth/logout`, `requirePrincipal` with both restrictions),
`apps/web/src/lib/auth.ts` (`logout()` posts best-effort, then clears as today; never throws),
tests.
Tests first: after logout the token is 401 on `me`; other sessions of the same user still work;
web: `logout()` calls the route and clears state even when the request fails (fetch mocked).
Commit `feat(auth): server-side logout`.

### Task 7 — Audit writer, limiter seam, change password

Files: `server/internal/auth/audit.go` (new: `func Audit(ctx, ex execer, e AuditEvent) error`,
`AuditEvent{Action, ActorID, TargetID *int64, Detail map[string]any}` — names are copied from
`users` at write time), `server/internal/api/authlimit.go` (new: `type limiter interface{
Allow(key string) (bool, time.Duration) }`, `noLimit`), `server/internal/api/handlers_account.go`
(new), `server/internal/auth/password.go` (new: `ChangePassword(ctx, db, userID, newPassword,
keepSessionID int64, revokeOthers bool) error`), tests.
Route: `POST /api/account/password` (spec §3).
Tests first: full session: wrong current → **403** `wrong_password` (assert the web client would
not drop the token: status ≠ 401); weak → 422; success → old password fails, new works,
`must_change_password` cleared, other sessions gone when `signOutOthers` true/absent and kept when
false; PwC session: no current password needed, always revokes others, the same token then
reaches `GET /api/workspaces`; a session created **before** an admin set the flag (set
`must_change_set_at` after it) must give the current password (403 without it); Enr session →
403 `mfa_enrollment_required`; the new hash is computed before `BeginTx`; an audit row
`password_changed` without any password text (`detail` checked); limiter seam: a fake limiter
refusing `reauth:<id>` → 429 with `Retry-After`.
Commit `feat(account): change password`.

### Task 8 — Session list and revoke

Files: `handlers_account.go`, tests. Routes: `GET /api/account/sessions`,
`DELETE /api/account/sessions/{id}`, `POST /api/account/sessions/revoke {scope}` (spec §3).
Tests first: list shows `current` for the caller only, never a token or hash (assert the JSON has
exactly the documented keys); another user's id → 404 and nothing deleted; `others` keeps the
caller; `all` kills the caller (next `me` 401); bad scope → 400; audit `sessions_revoked`.
Commit `feat(account): list and revoke sessions`.

### Task 9 — Janitor

Files: `server/internal/auth/janitor.go` (new: `RunJanitor(ctx, db, every, logf)` pruning
sessions idle > 90 d and audit rows > 180 d), `server/cmd/qinqin/main.go` (start it like
`aiJanitor`), test with injected clock. Commit `feat(auth): prune idle sessions and old audit rows`.

### Task 10 — Web: restricted sessions and the forced change page

Files: `apps/web/src/lib/routeAccess.ts` (+ test): new export
`restrictedTarget(path, restriction): string | null` (`password_change` → `/account/password`,
`mfa_enrollment` → `/account/two-factor-setup`, only those pages and `/sources` allowed);
`apps/web/src/routes/+layout.svelte` (use it); `apps/web/src/lib/auth.ts` (`restriction` in
`AuthState`, derived from `me`); `apps/web/src/lib/api/client.ts` (a 403 whose JSON code is
`password_change_required`/`mfa_enrollment_required` calls a registered `restrictedHandler` that
reloads `me`); `apps/web/src/routes/account/password/+page.svelte` (new);
`apps/web/src/lib/account/passwordRules.ts` (+ test).
Tests first: `routeAccess.test.ts` cases for every page kind × restriction; `layout.dom.test.ts`:
a restricted session on `/study` lands on `/account/password`; the page: new + confirm mismatch
message, policy hint, success → full session (mock `me` without restriction) → `/`.
Gates: web check + test. Commit `feat(web): forced password change`.

### Task 11 — Web: Settings → Account (password, sessions)

Files: `apps/web/src/lib/settings/tabs.ts` (+ test: `account` visible for everyone, order
`workspaces, home, plugins, ai, account, data`), `apps/web/src/lib/settings/AccountSettings.svelte`
(new), `apps/web/src/lib/account/sessionsView.ts` (+ test), `apps/web/src/lib/api/account.ts`
(new), `apps/web/src/lib/settings/AccountSettings.dom.test.ts` (new), `routes/settings/+page.svelte`.
Tests first: `sessionsView` (labels "This device", relative times from an injected now, revoke
button hidden on the current row, "Log out everywhere" confirm text); dom test: password form
sends `signOutOthers:true` by default, 403 `wrong_password` shows "The current password is
wrong." and keeps the user signed in; revoking a row removes it; "Log out everywhere" signs out.
a11y: labelled inputs, `role="alert"` errors, `role="status"` success, table headers with scope.
Commit `feat(web): account settings with password and sessions`.

### Task 12 — Contract and docs

Files: `docs/contracts/auth/README.md` (new: token handling, 401 vs 403 rule, restriction
states, login statuses, device names), `docs/contracts/auth/{login-responses,errors,me,sessions}.json`,
`server/internal/api/contract_auth_test.go` (new: decodes each fixture, performs the matching
request on a test server, compares key sets and JSON types recursively), `README.md` (API table
rows for the new routes; "Accounts and sign-in" section start: sessions, logout, change password,
90-day idle expiry).
Commit `docs(contracts): auth sessions contract and fixtures`.

### Task 13 — Gates and real-app check

Full Go gate, web check/test/build (read exit codes). Real-app check (curl only), port `P` free
per `ss -ltn` (not 8080/8085/8300):
1. Build the **develop** binary (smoke-embed staging, in `$SP/acct1-old`), start it on a fresh
   data dir, register `owner` / `owner-pass-123`, log in, keep token `T0`. Stop it.
2. Build this branch's binary (copy of `$WT` in `$SP/acct1-new`, web built in the copy), start it
   on the **same** data dir: `curl -H "Authorization: Bearer $T0" /api/auth/me` → 200 (upgrade kept
   the session); `sqlite3`-free check: `GET /api/account/sessions` lists one session with device
   "Unknown device" (the list maps the migrated empty label).
3. Login with `deviceName` → `status:"ok"`; change password with a wrong current → 403 JSON (not
   401); with the right one → 200, `T0` now 401, new token works.
4. Create user `bob` via the legacy admin-bearer register; set `must_change_password` via
   `sqlite3` in a throw-away `alpine` container on the data dir; bob logs in →
   `password_change_required`; `GET /api/workspaces` with that token → 403
   `password_change_required`; change → 200; same token → 200.
5. `POST /api/auth/logout` → 204, token 401. `revoke {"scope":"all"}` → caller 401.
Kill both processes, remove `$SP/acct1-*` (root-owned files via an alpine container).

## Review Focus

- **Token hashing**: no code path stores or compares a plaintext session token; the Go step
  hashes every copied row (keyed `032_accounts`); a crash mid-migration leaves the version unapplied.
- **Forced-change bypass**: the route walk covers every pattern; `optionalUser` treats restricted
  as anonymous; no direct `auth.Authenticate` outside `handlers_auth.go`; admin routes check the
  restriction before the admin bit; a session older than `must_change_set_at` cannot skip the
  current password; `goSteps` keyed by full version names.
- **401 vs 403**: every wrong password/code on an authenticated route is 403 (the web client
  logs out on 401).
- **Timing**: disabled/must-change decided after argon2; `Warm()` called before serving.
- **Secret leakage**: session list JSON has no token or hash; audit `detail` never holds a
  password; no new log line prints a token.
- **Races**: `ChangePassword` and session revocation in one transaction; `last_used_at` update is
  conditional.

## Contract notes

- `docs/contracts/auth/login-responses.json`: `ok`, `password_change_required` (and placeholders
  for plan 3's `mfa_required`, `mfa_enrollment_required`, added there).
- `errors.json`: `{code: {status, meaning}}` for `bad_credentials`, `account_disabled`,
  `unauthorized`, `rate_limited` (429) and `busy` (503) from #86, `password_change_required`, `mfa_enrollment_required`, `wrong_password`,
  `weak_password`, `invalid_username`, `username_taken`, `bad_request`.
- `me.json`, `sessions.json`. Rule for clients: send `deviceName`; treat the token as opaque; 401
  = drop the token and show sign-in; 403 with a restriction code = show that screen; never log the
  token.

## Execution record (rulings and deviations made while building)

Built unattended on 2026-11-15; #86 was already merged, so its seam is used as is.

- Ruling: the access policy is declared in the route table. `routes()` returns `route{pattern, handler,
  access, allow}` (`accPublic`, `accUser`, `accAdmin`, `accAdminSignedIn`, `accSession`); `New` mounts
  only that table. `gate_test.go` walks every row as anonymous, user, admin, password-change (user and
  admin) and enrolment (user and admin) callers and checks the handler really enforces what the row
  declares; a row without an access, a handler that skips the gate, a direct `auth.Authenticate`
  outside `handlers_auth.go` and a mux registration outside the table each fail (all five verified by
  deliberate mutation). Cost if wrong: a new route needs one extra word.
- Ruling: `accAdminSignedIn` exists for the AI custom-endpoint routes, which answer anonymous callers 401
  and non-admins 403 (an existing behaviour with tests).
- Ruling: no `autherr.go`; `writeAuthError` and the limiter seam already exist in `authlimit.go` (#86).
  The seam is real: `authLimiter("reauth")` with `DefaultAuthPolicy().Named["reauth"]` = burst 5, one
  token per 3 minutes (5 wrong passwords per 15 minutes), the token is refunded when the password was
  right (`namedLimiter.Refund`). Change password also runs behind the hash gate.
- Ruling: the JSON-vs-plain-text conflict is moot (#86 already made login/register JSON). One catalogue:
  `docs/contracts/auth/errors.json`; `contract_auth_test.go` checks that `throttle-responses.json` and
  every literal `writeAuthError` call site agree with it on code and status. `go test` does not track
  files outside the module, so run the contract tests with `-count=1` after editing fixtures.
- Ruling: `requireUser`/`requireAdmin` now answer JSON (`unauthorized`, `forbidden`); `internal` errors are
  JSON too. `requireAdmin` checks the restriction before the admin bit.
- Ruling: `GET /api/auth/me` returns the user object plus `restriction` (`""`, `password_change`,
  `mfa_enrollment`); the web `restriction` store is derived from `user.restriction` instead of a new
  `AuthState` field (no change to the many tests that build `AuthState`).
- Ruling: `Login` keeps its signature as a wrapper; `LoginWith(…, LoginOptions)` returns the user too;
  `ErrAccountDisabled` is returned only after the password verified; the throttle treats it as a success
  (the password was right), not a failure. Unknown, wrong and disabled all cost exactly one argon2 run.
- Ruling: `ChangePassword(ctx, db, userID, newHash, keepSessionID, revokeOthers)` takes the digest, because
  the hash gate lives in `api`; `VerifyUserPassword` is the matching check. A forced change (flag set)
  always revokes the other sessions. `must_change_set_at` NULL (flag set by hand) counts as "session older
  than the flag": the current password is required.
- Ruling: register answers 403 `admin_required` to an anonymous caller before any username or password
  check once users exist, so a closed instance cannot be probed for usernames (409) or policy; the legacy
  admin-bearer path ignores a restricted admin. Username uniqueness is case-insensitive for ASCII only
  (SQLite `COLLATE NOCASE`); non-ASCII letters compare exactly.
- Ruling: `Audit` refuses detail keys that look like secrets (password, token, secret, code, email, host,
  hash, ip, address); single-session revoke is audited as `sessions_revoked` with scope `one`.
- Ruling: logout is allowed for restricted sessions (it is the way out of a forced change).
- Ruling: `optionalUser` treats an authentication error as anonymous (the entry still renders; the error
  would also surface in the entry query).
- Ruling: the web client sends no `deviceName` (the server derives the label from the User-Agent);
  `sessionsView` formats dates with `Intl` (the #84 `utcGuard` forbids UTC day arithmetic).
- Deviation: Task 1 also switched `Login`/session lookup in `auth.go` to `token_hash`, so every commit
  builds and passes; Task 2 then added the session store proper.
- Deviation: the test password convention is `secret-pass-<name>` (`"pw-"+name` became
  `"secret-pass-"+name`); direct `auth.CreateUser` calls in tests keep short passwords (the policy is
  applied by the API and the CLI, not by `CreateUser`).
- Merge: `feature/v0.3.0` (with #84 and #57) was merged into the topic branch before the final gates;
  conflicts were `api.go` (the two `/api/me/time-zone` routes became `accUser` rows), `auth.ts`,
  `tabs.ts`/`tabs.test.ts` (tab order is now `workspaces, home, study, plugins, ai, account, data`) and
  `docs/contracts/README.md`. Migration numbers: this branch has 032; #84 holds 035; 033/034 stay free
  for plans 2 and 3.

### What plans 2 and 3 build on

- Gate helpers (`handlers_auth.go`): `requirePrincipal(w, r, allow...)`, `requireUser`, `requireAdmin`,
  `optionalUser`, `authenticate`; restrictions are the constants `restrictionPasswordChange` and
  `restrictionMFAEnrollment`. A new route is one `route{}` row with an access; plan 3's account/MFA routes
  use `accSession` with `allow` listing `mfa_enrollment` (and the walk then proves it). Admin routes
  (`/api/admin/users…`, settings, audit) are `accAdmin`.
- Session store (`auth/session.go`): `NewSession(ctx, db, uid, LoginOptions{Device, Level})` (`Level`
  `LevelEnroll` makes an enrolment session), `Authenticate`, `RevokeSession(s)`, `ListSessions`, `Principal`
  (`SessionID`, `Level`, `SessionCreated`, `MustChangeSetAt`, `Restriction()`). Disabling a user: set
  `users.disabled_at` and delete their sessions in the same transaction (`Authenticate` already refuses
  disabled users).
- Audit: `auth.Audit(ctx, execer, AuditEvent{Action, ActorID, TargetID, Detail})`, usable on a `*sql.Tx`;
  names are copied at write time; the janitor prunes rows after 180 days.
- Limiter: `s.authLimiter(name)` plus `refunder`; named policies live in `DefaultAuthPolicy().Named`
  (`reauth` exists; add `ident`, `reset-mail`, `smtp-test`, `mfa`, `mfa-day`, `mailcode` there). Hash work
  goes through `s.withHashGate`; hashing for new passwords through `s.hash.hash`.
- There is no `userTables` registry yet: plan 2 creates the delete list and the schema-walking guard
  (users spec section 6). Tables with a user reference today (verify with the guard): `workspaces`,
  `study_events`, `plugin_states`, `plugin_data`, `user_edits`, `sentences.user_id`, `library_books`,
  `library_bookmarks`, `library_highlights`, `journal_photos`, `ai_keys`, `ai_selection`, `ai_calls`,
  `ai_custom_providers.created_by`, `sessions`, `auth_audit.actor_id/target_id` (kept, names replaced),
  `auth_settings.updated_by`, and from #84 `user_time_zones.user_id` (migration 035: add it to the delete
  list).
- Fixtures: plans 2 and 3 add rows to `errors.json` (the catalogue test fails on an uncatalogued code) and
  new files under `docs/contracts/auth/`.
