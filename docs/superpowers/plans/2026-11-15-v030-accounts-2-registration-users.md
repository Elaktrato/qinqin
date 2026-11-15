# v0.3.0 accounts, plan 2 — registration policy, invites, user management, reset links, deletion

> Execute subagent-driven (superpowers:subagent-driven-development), test first, independent
> review on the strongest model, one fix wave, whole-branch review. Starts after plan 1 is merged
> into `feature/v0.3.0`.

Specs: `docs/superpowers/specs/2026-11-15-v030-accounts-design.md`, `…-registration-design.md`,
`…-users-sessions-design.md` §4–§8. Issue #64 (owner comments win).
Branch: `git worktree add -b feature/v030-accounts-registration-users .claude/worktrees/v030-accounts-reg feature/v0.3.0`.
Migration: `033_invites_resets.sql` (provisional). Gates: as plan 1 (`WT` = this worktree).

## Rulings (plan-specific)

- Ruling: `auth_settings` is read per request (one indexed row) rather than cached — admins'
  changes apply instantly with no invalidation code — cost if wrong: one tiny query on
  register/login/options.
- Ruling: admin user routes live in `handlers_admin_users.go` and call an `auth.Users` service
  (`server/internal/auth/users.go`) that owns every guarded statement and `usersMu` — the
  last-admin rule is testable without HTTP — cost if wrong: none.
- Ruling: the deletion preview and the deletion share one table list (`userTables` in
  `server/internal/auth/delete.go`) — the dialog cannot promise something the delete does not do
  — cost if wrong: none.
- Ruling: the web Admin tab is added in this plan with sections Users, Invites, Security; Email
  arrives in plan 3 — cost if wrong: none.

## Tasks

### Task 1 — Make workspace deletion atomic (found bug)

Files: `server/internal/api/handlers_workspaces.go` (`deleteWorkspace`: every statement on `tx`),
`server/internal/api/handlers_workspaces_delete_test.go`.
Test first: create a normal (not TEMP) `CREATE TRIGGER boom BEFORE DELETE ON library_books BEGIN
SELECT RAISE(ABORT,'boom'); END` in the test database, keep the default pool (with one connection
the current code deadlocks instead of failing), give the request a 10 s context timeout, call
DELETE → 500 and the workspace row **and its study events still exist** (today they are gone).
Commit `fix(api): delete a workspace in one transaction`.

### Task 2 — Migration 033

Files: `server/internal/db/migrations/033_invites_resets.sql` (registration spec §3, §4 tables +
`idx_password_resets_user`), `server/internal/db/migrate_033_test.go`. Test: tables exist, CHECK on
`max_uses` rejects 0 and 101. Commit `feat(db): invites and password resets`.

### Task 3 — Auth settings and the public options route

Files: `server/internal/auth/settings.go` (new: `type Settings{Registration, EmailPolicy string;
MFAEnforced, EmailCodeLogin bool}`, `LoadSettings`, `UpdateSettings(ctx, db, actorID, patch)`
validating enums and writing an audit row per changed field), `server/internal/api/handlers_admin_settings.go`
(new: `GET/PATCH /api/admin/settings/auth`), `handlers_auth.go` (`GET /api/auth/options`), tests.
Until plan 3, `mail.configured` is false: `mfaEnforced`/`emailCodeLogin: true` → 409
`mail_unavailable`; `options.passwordReset`/`emailCodeLogin` false.
Tests first: defaults; invalid enum → 422; non-admin → 403; PwC admin → 403 restricted; audit
rows; `options` is public, `bootstrap` true on an empty DB and false after the first user.
Commit `feat(auth): registration and email policy settings`.

### Task 4 — Registration modes and invite consumption

Files: `handlers_auth.go` (`handleRegister` per registration spec §2: legacy path only for a
valid unrestricted admin principal; anonymous invite/open registration through #86's L1 bucket
and hash gate when present; the password hashed before `BeginTx`), `server/internal/auth/invites.go`
(new: `CreateInvite`, `ListInvites`, `RevokeInvite`, `CheckInvite`, and `RegisterWithInvite(ctx,
db, token, user NewUser) (model.User, error)` doing the guarded `UPDATE invites` and the insert on
one `tx`), `server/internal/auth/users.go` (`NewUser{Username, Password, Email *string, Admin,
MustChange, EmailVerified bool}` and `CreateUserWith(ctx, ex, NewUser)`), tests.
Tests first: zero users → bootstrap in every mode; `closed` → 403 `registration_closed`;
`invite` without invite / unknown / expired / used up / revoked → 403 `invite_invalid` (same body
for all five); `open` → 201; email policy `required` without email → 422 `email_required`; `off`
with email → 422 `email_disabled`; taken email (case-insensitive) → 409 `email_taken`; a 1-use
invite raced by 8 goroutines → exactly one 201, `uses = 1`; a username clash after a valid invite
rolls the use back (`uses` unchanged); legacy admin-bearer register unchanged (no must-change);
in `open` mode a non-admin bearer registers by policy instead of getting 403.
Commit `feat(auth): registration modes and invites`.

### Task 5 — Invite admin routes and the check route

Files: `server/internal/api/handlers_admin_invites.go` (new), `handlers_auth.go`
(`POST /api/auth/invite/check`), tests.
Tests first: create → 201 with `token` (43 base64url chars) and `path` `/register#invite=…`, DB
holds only the hash; list never contains `token` (assert key set); state words incl. `inactive`
while closed; revoke → 204, then `invite/check` 403; validation (`maxUses` 0/101, `expiresInDays`
0/91, note > 100 runes) → 422; non-admin 403; audit `invite_created`/`invite_revoked`/`invite_used`.
Commit `feat(admin): invite links`.

### Task 6 — Admin user list, create, patch; the last-admin rule

Files: `server/internal/auth/users.go` (`ListUsers`, `SetAdmin`, `SetDisabled`, `SetEmail`,
`ForcePasswordChange`, each one guarded statement, all under `usersMu`), 
`server/internal/api/handlers_admin_users.go` (new: `GET/POST /api/admin/users`,
`GET/PATCH /api/admin/users/{id}`, `POST /api/admin/users/{id}/sessions/revoke`),
`server/internal/auth/users_test.go`, `server/internal/api/handlers_admin_users_test.go`.
Errors: 409 `last_admin`, 409 `self_target`, 404 `not_found`, 422 as registration.
Tests first: create → `mustChangePassword:true`, login answers `password_change_required`;
admin-entered email is verified; demote the only active admin → 409 and nothing changes; with two
admins, demote one → ok, the other → 409; disabling an admin counts them out; disabled user's
sessions are gone and login is 403 `account_disabled`; self-disable → 409 `self_target`;
`mustChangePassword:false` → 422; **race** (auth package, `-race`): two admins A and B, 50 rounds
of concurrent `SetAdmin(A,false)` ‖ `SetAdmin(B,false)` and `SetDisabled(A)` ‖ `SetAdmin(B,false)`:
exactly one succeeds each round, an active admin always remains. Authorization: every route ×
{anon, user, PwC admin, admin} per the matrix.
Gate: `-run 'Users|AdminUsers' ./internal/auth/ ./internal/api/` and `go test -race -run Users ./internal/auth/`.
Commit `feat(admin): user management with the last-admin rule`.

### Task 7 — Admin reset links and the reset routes

Files: `server/internal/auth/resets.go` (new: `IssueReset(ctx, db, userID int64, createdBy *int64,
ttl) (token string, expires time.Time, err)`, `CheckReset`, `UseReset(ctx, db, token, newPassword)
(userID int64, err)`), `handlers_admin_users.go` (`POST …/{id}/reset-link`), `handlers_auth.go`
(`POST /api/auth/reset/check`, `POST /api/auth/reset`), tests.
Tests first: issue returns `path` `/reset#t=…`, DB has the hash only; a second issue invalidates
the first; check → username + expiry; expired / used / unknown / disabled-user token → 400
`token_invalid` (identical bodies); use → password set, `must_change_password` cleared, **all**
sessions of the user deleted, response is a login (`status:"ok"` + token); using twice → second
400; weak password → 422 and the token stays usable; two concurrent uses → one wins;
`expiresInHours` 0/169 → 422; audit `reset_link_issued`, `password_reset`.
Commit `feat(auth): admin-issued password reset links`.

### Task 8 — User deletion core and the schema guard

Files: `server/internal/auth/delete.go` (new: `userTables`, `keptTables`,
`DeletionPreview(ctx, db, id) (Preview, error)`, `(*Users).DeleteUser(ctx, id int64, dataDir
string) error` under `usersMu` — the 034 tables are not in the list yet (plan 3 adds them) —
guarded first statement, everything on `tx`, files after commit, audit names
anonymised), `server/internal/auth/delete_test.go`.
Tests first: seed one user with a row in every user table (helpers from existing packages) and a
second user with the same; delete the first → every table has zero rows for them, the second
user's rows are untouched, `<data>/books/<id>` and `<data>/journal/<id>` are gone, custom AI
provider kept with `created_by = 0`, audit names replaced; preview counts match the seed;
**schema guard**: list every table with a `user_id`/`created_by`/`updated_by`/`actor_id`/
`target_id` column from `sqlite_master` + `pragma_table_info` and fail if any is in neither list;
last active admin → `ErrLastAdmin`, nothing deleted; a failure injected in the middle (temp
trigger, normal not TEMP, default pool) rolls everything back.
Commit `feat(auth): delete a user and all their data`.

### Task 9 — Delete routes (admin and self)

Files: `handlers_admin_users.go` (`GET …/{id}/deletion-preview`, `DELETE …/{id}` with `confirm`),
`handlers_account.go` (`GET /api/account/deletion-preview`, `DELETE /api/account` with
`password`, `confirm`; `code` arrives in plan 3), tests.
Tests first: confirm mismatch → 422 `confirm_mismatch`; wrong password → 403 `wrong_password`;
admin deleting self via admin route → 409 `self_target`; last admin self-delete → 409 `last_admin`;
success → 204 and the token is 401; authorization matrix rows. Commit `feat(account): delete accounts`.

### Task 10 — Audit list route

Files: `server/internal/api/handlers_admin_audit.go` (new: `GET /api/admin/audit?before&limit`),
test: paging (`limit` 1–100, default 50), newest first, `next`, non-admin 403, no secret-looking
values in any row produced by tasks 3–9 (scan `detail` for the test passwords/tokens).
Commit `feat(admin): audit log`.

### Task 11 — CLI `recover`; `adduser` policy

Files: `server/cmd/qinqin/recover.go` (new), `main.go` (dispatch), `recover_test.go`.
Tests first: sets a new password (policy enforced) with `must_change_password = 1`, deletes
sessions, `--enable` clears `disabled_at`, `--admin` sets admin, audit actor name `cli`,
unknown user → error; `--reset-mfa` is accepted and reports "no two-factor data" until plan 3
wires it. Commit `feat(cli): recover a locked-out account`.

### Task 12 — Web: options, login and register variants, reset page

Files: `apps/web/src/lib/api/account.ts` (options, invite check, reset check/use),
`apps/web/src/lib/account/loginFlow.ts` (+ test: states `credentials → done | passwordChange`,
extensible for plan 3), `apps/web/src/lib/account/fragment.ts` (+ test: reads `invite`/`t`,
returns a cleaned URL), `routes/login/+page.svelte`, `routes/register/+page.svelte`,
`routes/reset/+page.svelte` (new), `lib/routeAccess.ts` (`/reset` is `open`: a signed-in
person opening a reset link must not be bounced home; a successful reset replaces the stored
token), dom tests for the three pages.
Tests first: links shown per options (bootstrap, closed, invite, open); register page with
`#invite=` checks it, strips the fragment (`history.replaceState` spy), shows email per policy;
an invalid invite shows the sentence; reset page with `#t=` → form → signed in; without
fragment and no mail → the "ask your administrator" text.
Commit `feat(web): registration modes, invites and reset links`.

### Task 13 — Web: Admin tab shell and Users section

Files: `lib/settings/tabs.ts` (`admin` tab, admins only, after `data`; `?section=`),
`lib/settings/AdminSettings.svelte` (new, section nav), `lib/admin/UsersAdmin.svelte` (new),
`lib/admin/usersView.ts` (+ test), `lib/api/adminUsers.ts` (new), `lib/admin/UsersAdmin.dom.test.ts`,
`lib/admin/DeleteUserDialog.svelte` (new, focus handling as DeleteWorkspaceDialog).
Tests first: `usersView` — actions per row (self: no disable/delete; last active admin: "Remove
admin" disabled with "The last administrator cannot be removed."), status badges as text;
dom — create user with Generate (16 chars, `crypto.getRandomValues` mocked) shows the
must-change note; reset link result shows the full link once with Copy and disappears on close;
delete dialog lists preview counts and enables Delete only when the typed name matches.
Commit `feat(web): admin user management`.

### Task 14 — Web: Invites and Security sections

Files: `lib/admin/InvitesAdmin.svelte`, `lib/admin/invitesView.ts` (+ test),
`lib/admin/SecurityAdmin.svelte`, `lib/admin/securityView.ts` (+ test), dom tests.
Tests first: expiry choices → `expiresInDays` (1/7/30/90/null); state labels; the link shown once;
registration radio group sends PATCH and shows `role="status"`; "Invites do not work while
registration is closed" note in `closed`; MFA/email-code switches hidden with the "needs email"
sentence (mail unconfigured); audit list paging.
Commit `feat(web): invites and sign-in policy for admins`.

### Task 15 — Web: Account profile email and Delete account

Files: `lib/settings/AccountSettings.svelte` (profile email per policy: off hidden, optional
editable, required not clearable; banner when required and missing — also on Home via
`routes/+page.svelte`), `lib/settings/DeleteAccountDialog.svelte`, dom tests.
Tests first: policy variants; delete flow: preview counts, password, typed username; 409
`last_admin` sentence; success signs out. (Email *verification* UI is plan 3.)
Commit `feat(web): account email and deletion`.

### Task 16 — Contract and docs

Files: `docs/contracts/auth/{options,admin-users,invites}.json`, extend `errors.json`
(`registration_closed`, `invite_invalid`, `email_required`, `email_taken`, `email_disabled`,
`invalid_email`, `token_invalid`, `last_admin`, `self_target`, `confirm_mismatch`,
`mail_unavailable`), `docs/contracts/auth/README.md` (registration and reset flows),
`contract_auth_test.go` cases, `README.md` ("Accounts and sign-in": modes, invites,
admin-created users, reset links, deleting accounts with the exact removed/kept list, `qinqin
recover`; API rows; the Portainer/compose notes that mention first-user registration).
Commit `docs: accounts, registration and user management`.

### Task 17 — Gates and real-app check

Full gates. Real-app check (curl only, free port, fresh data dir in `$SP/acct2`):
1. Register `owner` (bootstrap). `options` → `registration:"closed"`. Anonymous register → 403.
2. PATCH registration `invite`; create a 2-use invite; register `a1`, `a2` with it → 201; third →
   403 `invite_invalid`. Revoke check.
3. Admin creates `bob` → bob login `password_change_required` → `GET /api/workspaces` 403 →
   change → 200.
4. Reset link for bob → `reset/check` → `reset` → bob's old tokens 401, new token works.
5. Demote owner while alone → 409 `last_admin`; promote a1, demote owner → ok; a1 demotes self →
   409.
6. Give a2 data (a workspace, a review event via `POST /api/events/batch`, a plugin data key);
   preview counts; delete a2 → 204; a2's token 401; `GET /api/admin/audit` shows the actions with
   no password or token text (grep the body for the test passwords and token prefixes).
Kill, remove `$SP/acct2`.

## Review Focus

- **Last-admin races**: guarded statements are the first write; `usersMu` held; `-race` test.
- **Invite races / enumeration**: one error body for every bad invite; guarded `uses` update and
  user insert on one `tx`.
- **Reset tokens**: hashed, single use (guarded update), expiry enforced in SQL, all sessions
  revoked, MFA not bypassed (plan 3 adds the MFA branch; leave the seam).
- **Deletion completeness**: schema guard; files removed after commit only; kept tables really
  shared.
- **Forced-change bypass**: admin-created users cannot reach any route before changing; the
  restricted admin cannot use admin routes.
- **Secret leakage**: tokens only in the creating response; list endpoints' key sets asserted;
  audit detail clean.

## Contract notes

- `options.json` (all four modes / bootstrap), `admin-users.json` (`AdminUser`), `invites.json`
  (create response with a fake token, list item), reset flow in `README.md` (check → reset →
  login-shaped response), new error codes in `errors.json`.
- Kotlin client: reads `options` before showing sign-in; registration by invite uses the token
  from the link fragment (deep link `…/register#invite=`); admin screens are web-only for v0.4.0
  (say so in the contract README).
