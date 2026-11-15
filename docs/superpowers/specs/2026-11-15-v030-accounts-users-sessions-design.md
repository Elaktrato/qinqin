# v0.3.0 accounts — sessions, access gate, user management (#64)

Part of `2026-11-15-v030-accounts-design.md` (shared rules, authorization matrix). §1–§3 are
plan 1; §4–§8 are plan 2.

## 1. Sessions

Migration 032 rebuilds `sessions`:

```sql
CREATE TABLE sessions_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,   -- public id for list/revoke; never the token
    token_hash TEXT NOT NULL UNIQUE,        -- hex SHA-256 of the 64-hex bearer token
    user_id INTEGER NOT NULL REFERENCES users(id),
    level TEXT NOT NULL DEFAULT 'full' CHECK (level IN ('full','enroll')),
    device TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
);
INSERT INTO sessions_new (token_hash, user_id, created_at, last_used_at, device)
    SELECT token, user_id, updated_at, updated_at, '' FROM sessions;
DROP TABLE sessions; ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX idx_sessions_user ON sessions (user_id);
```

The Go step of 032 (same transaction, keyed by the full version name `032_accounts`) replaces
every copied `token_hash` with `hex(sha256(token))`. Existing logins survive the upgrade. A test
asserts every `goSteps` key names an embedded migration, so a renumber at merge cannot silently
skip the hashing.
Ruling: hash session tokens now — a server backup (#61) or a copied database file must not hand
out live sessions — cost if wrong: one SHA-256 per request (negligible).
Ruling: a Go migration step instead of lazy re-hashing on first use — one code path for lookup,
atomic with the schema change — cost if wrong: the runner grows a small hook.

- **Lookup**: `token → sha256 → SELECT … FROM sessions JOIN users … WHERE token_hash = ?`.
- **Idle expiry**: a session unused for 90 days is invalid (lookup condition
  `last_used_at > now-90d`) and pruned by the janitor. No absolute expiry.
  Ruling: 90 days idle, no absolute limit — an offline-first Android client syncs rarely; a stolen
  token is handled by revoke — cost if wrong: very long-lived web sessions on shared machines.
- **last_used_at** is written at most every 5 minutes per session (a conditional `UPDATE … WHERE
  last_used_at < now-5min`), so reads do not become writes.
- **device**: login bodies may carry `deviceName` (≤ 64 runes, control characters stripped; the
  Kotlin client sends e.g. "qinqin Android · Pixel 8"). Without it the server derives a coarse
  label from `User-Agent` ("Firefox on Linux", "Safari on iOS", "Unknown device"); the raw
  User-Agent is never stored; an empty label (rows migrated from before 032) is shown as
  "Unknown device" by the list route. Pure function `auth.DeviceLabel(ua string) string`, table-tested.
- **Logout**: `POST /api/auth/logout` deletes the current session row (204). The web `logout()`
  calls it best-effort, then clears local state as today.

## 2. The access gate

`auth.UserFromRequest` becomes `auth.Authenticate(r, db) (*Principal, error)`:

```go
type Principal struct {
    User      model.User // + Email, EmailVerified, MustChangePassword, Disabled
    SessionID int64
    Level     string     // "full" | "enroll"
}
// Restriction is "" (full access), "password_change" or "mfa_enrollment".
// password_change wins: the temporary password goes first.
func (p *Principal) Restriction() string
```

Disabled users never authenticate (their sessions are deleted on disable; the lookup also
filters `disabled_at IS NULL`). In `api`:

- `requireUser(w, r) *model.User` — unchanged signature, so no existing handler changes; now
  answers 403 `password_change_required` / `mfa_enrollment_required` for a restricted principal.
- `requireAdmin` — same, restriction checked before the admin bit.
- `requirePrincipal(w, r, allow ...string) *auth.Principal` — the only way to get a restricted
  principal; the allowlisted handlers (matrix) pass the restrictions they accept.
- `optionalUser(r)` replaces the direct `auth.UserFromRequest` call in `handleGetEntry`;
  restricted principals are anonymous there.

Ruling: the gate lives in the three helpers, not in a pattern allowlist on the mux — handlers
opt in to restricted sessions explicitly, the default is deny — cost if wrong: a future handler
that calls `auth.Authenticate` directly bypasses it; a test greps the `api` package and fails on
any `auth.Authenticate` call outside `handlers_auth.go` (plan 1 task 4).

Routes move into a table `routes() []route{pattern, handler}` in `api.go` so the authorization
test can iterate every pattern with a PwC and an Enr token and assert 403 except on the
allowlist.

## 3. Change password and sessions

- `POST /api/account/password` `{currentPassword, newPassword, signOutOthers}` → 200
  `{"status":"ok"}`. `currentPassword` is required for a full session (403 `wrong_password`
  if wrong) and ignored for a `password_change` session **only if that session was created after the flag
  was set** (`sessions.created_at >= users.must_change_set_at`, i.e. it came from a login with the
  temporary password); a live session restricted by a flag an admin set later must still give the
  current password — otherwise a stolen old session could take the account over. `signOutOthers` defaults to **true** (the UI shows it checked);
  forced changes always sign out the others. Clears `must_change_password`, sets
  `password_changed_at`, audits `password_changed`.
  Ruling: revoke other sessions by default — the usual reason to change a password is suspicion —
  cost if wrong: the user logs in again on their phone.
- `GET /api/account/sessions` → `{"sessions":[{"id","device","createdAt","lastUsedAt","current"}]}`
  newest use first.
- `DELETE /api/account/sessions/{id}` → 204; another user's id is 404. Revoking the current one
  is allowed (= logout).
- `POST /api/account/sessions/revoke` `{"scope":"others"|"all"}` → `{"revoked":n}`. "Log out
  everywhere else" is `others`; "Log out everywhere" is `all` (the web app then signs out).

## 4. User management (admin)

Routes (all `requireAdmin`; matrix in the overview):

- `GET /api/admin/users` → `{"users":[AdminUser]}`, `AdminUser = {id, username, email,
  emailVerified, admin, disabled, mustChangePassword, mfa:{totp, email}, createdAt, lastSeenAt}`
  (`lastSeenAt` = max session `last_used_at`, null if none; `mfa` is added by plan 3). Ordered
  by username.
- `POST /api/admin/users` `{username, password, email?, admin?}` → 201 `AdminUser` with
  `mustChangePassword: true`. Email per policy (registration spec §5). Admin-entered emails count
  as verified.
- `PATCH /api/admin/users/{id}` `{admin?, disabled?, email?, mustChangePassword?}`:
  `disabled:true` deletes all the user's sessions in the same transaction; `mustChangePassword`
  accepts only `true` (an admin can force a change, never cancel one silently).
- `POST /api/admin/users/{id}/sessions/revoke` → `{"revoked":n}`.
- `GET /api/admin/users/{id}/deletion-preview` → counts (§6); `DELETE /api/admin/users/{id}`
  `{"confirm":"<username>"}` → 204; 422 `confirm_mismatch`.
- Reset links and MFA reset: registration spec §4, smtp-mfa spec §5.
- An admin acting on **themselves** through `/api/admin/users/{id}`: disable and delete are 409
  `self_target` (use Settings → Account to delete yourself); demote is allowed while another
  active admin remains.

The legacy path `POST /api/auth/register` with an admin bearer stays and keeps today's meaning
(creates a non-admin user with the given password, no forced change).
Ruling: keep the legacy path unchanged — scripts and every existing test use it; the UI uses
`/api/admin/users` — cost if wrong: two creation paths to keep consistent (both call one
`auth.CreateUser` with options; the policy checks are shared).

## 5. The last-admin rule and races

"Active admin" = `admin = 1 AND disabled_at IS NULL`. Demote, disable and delete must leave at
least one. Each is **one guarded statement**, e.g.

```sql
UPDATE users SET admin = 0, updated_at = ?2 WHERE id = ?1 AND admin = 1
  AND EXISTS (SELECT 1 FROM users WHERE id <> ?1 AND admin = 1 AND disabled_at IS NULL)
```

0 rows → re-read to tell 404 / no-op / 409 `last_admin`. The delete transaction starts with the
guarded `DELETE FROM users`, as its first statement and on `tx`. In addition the api server holds
`usersMu` around every admin-state mutation (single process).
Ruling: guarded statement **and** an in-process mutex — the statement is the real guarantee,
the mutex removes SQLite busy-retry surprises between two admins clicking at once — cost if
wrong: admin mutations serialize (rare, cheap).
Test: two goroutines demote two admins (and: delete A / demote B) concurrently, 50 rounds; exactly
one succeeds each round; run with `-race` on `internal/auth` only.

## 6. Deleting a user (admin or self)

One transaction, every statement on `tx`, guarded first statement (§5). **Removed:**
the `users` row; `sessions`, `password_resets`, `auth_challenges`, `mfa_totp`,
`mfa_recovery_codes`; `workspaces`, `study_events`, `plugin_states`, `plugin_data` (workspace and
user-global rows: flashcards, journal entries, reader settings, FSRS sets), `user_edits`
(overlays), `sentences WHERE user_id = ?` (sentences the user added), `library_books`,
`library_bookmarks`, `library_highlights`, `journal_photos`, `ai_keys`, `ai_selection`,
`ai_calls`, `invites` the user created. After commit: the directories `<data>/books/<id>/` and
`<data>/journal/<id>/` (failure logged, not fatal, like workspace deletion).
**Kept** (shared, not personal): admin-registered AI endpoints (`ai_custom_providers.created_by`
set to 0), installed packs, languages, plugins, dictionaries; `auth_audit` rows (the user's name
in them is replaced by `deleted user #<id>`); `*_settings.updated_by` set to NULL. The tables of
plan 3 (`auth_challenges`, `mfa_totp`, `mfa_recovery_codes`) join the delete list in plan 3's
migration task; plan 2's list leaves them out (they do not exist yet), and the schema guard
enforces the addition. `DeleteUser` is a method of `auth.Users` and holds `usersMu` (§5).
Ruling: delete invites the user created — they were that admin's hand-outs — cost if wrong: a
pending invite stops working; another admin issues a new one.

`deletion-preview` answers `{"workspaces","studyEvents","pluginData","books","journalPhotos",
"aiKeys","sessions","overlays","sentences"}` counts so the dialog states exactly what goes.
Guard test: walks `sqlite_master` + `pragma_table_info` for every table with a `user_id`,
`created_by`, `updated_by`, `actor_id` or `target_id` column and fails if a table is neither in
the delete list nor in the kept list — a future migration cannot forget user deletion.

**Self-delete**: `DELETE /api/account` `{password, code?, confirm}` — `password` re-auth (403
`wrong_password`), `code` when the user has TOTP (403 `code_invalid`), `confirm` = username;
409 `last_admin` for the last active admin ("make someone else admin first"). Responds 204; the
client signs out. The UI recommends the backup export (#61) first and links to it once it exists.
Ruling: the last active admin can never delete themselves, even on a one-user instance — zero
users would reopen the first-user bootstrap to anyone who reaches the URL — cost if wrong: a
sole user deletes the data volume instead.

## 7. Audit log

`auth_audit(id AUTOINCREMENT, at, action, actor_id, actor_name, target_id, target_name,
detail TEXT)`; `detail` is a small JSON object of non-secret facts (`{"scope":"others"}`,
`{"field":"registration","to":"invite"}`, `{"maxUses":5}`). Never a password, token, code,
email address, SMTP host or IP. Actions: `user_created`, `user_deleted`, `user_disabled`,
`user_enabled`, `admin_granted`, `admin_revoked`, `password_changed`, `password_change_forced`,
`reset_link_issued`, `password_reset`, `mfa_enabled`, `mfa_disabled`, `mfa_reset`,
`recovery_code_used`, `invite_created`, `invite_revoked`, `invite_used`, `settings_changed`,
`sessions_revoked`, `account_deleted`. Failed logins are not logged (no IP, high noise).
Retention 180 days (janitor). `GET /api/admin/audit?before=<id>&limit=50` →
`{"events":[{id, at, action, actor:{id,name}|null, target:{id,name}|null, detail}], "next": id|null}`.
Ruling: keep a minimal audit log — with several admins someone must see who promoted, disabled or
reset whom — cost if wrong: one table and a list view.

## 8. Web UI (sessions and users parts)

- **Settings → Account** (new tab `account`, every user): Profile (username; email per policy,
  smtp-mfa spec), Password (current, new, confirm, "Sign out my other sessions" checked),
  Two-factor (smtp-mfa spec), Sessions (table: device, signed in, last active, "This device";
  Revoke per row; "Log out everywhere else"; "Log out everywhere"), Delete account (preview
  counts, password, code if TOTP, type the username).
- **Settings → Admin** (new tab `admin`, admins only) with a sub-navigation Users · Invites ·
  Email · Security (`?tab=admin&section=users`). Users: table (username, email, role, status,
  two-factor, last seen) with a row menu: Make admin / Remove admin, Disable / Enable, Require
  password change, Reset link, Reset two-factor, Sign out everywhere, Delete (dialog with the
  preview counts and type-the-username). Actions that would hit the last-admin rule are disabled
  with the reason as text (the server still decides). "Create user" form: username, temporary
  password with a Generate button (16 chars from `crypto.getRandomValues`), email per policy,
  Admin checkbox; result note "They must choose a new password when they first sign in."
  Ruling: one Admin tab with sections instead of four new tabs — the tablist already has five
  entries and must fit 360 px — cost if wrong: one more click for admins.
- **Forced password change**: `/account/password` page (layout guard sends a `password_change`
  session there from any other page; the only other way out is Sign out).
- Pure, tested modules; Svelte stays thin: `lib/account/sessionsView.ts` (rows, labels, which
  revoke buttons), `lib/admin/usersView.ts` (row actions and disabled reasons incl. last admin,
  self), `lib/account/passwordRules.ts` (client mirror of the policy for inline hints),
  `lib/routeAccess.ts` gains a `restricted` decision.
- a11y: every input labelled; errors `role="alert"`; success notes `role="status"`; dialogs reuse
  the DeleteWorkspaceDialog focus handling; tables with `<th scope>`; state never by colour alone
  ("Disabled" text badge); focus moves to the page heading after each step.
