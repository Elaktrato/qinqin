# Reset another user's two-step sign-in from Settings, Admin, Users — design (issue #91)

Status: Draft (2026-11-16), v0.4.0 prep item 1. Written unattended; every non-obvious call is a
**Ruling** (`what — why — cost if wrong`). Direction: "Same protections as other destructive admin
actions (current password + authenticator code when set)."

## Intent and why

A user who lost their authenticator and their recovery codes is locked out. The server has had the
lockout recovery since v0.3.0 (`POST /api/admin/users/{id}/mfa/reset`, tested), and the wiki already
tells people to "ask an administrator to reset your two-step sign-in (Admin, Users)", but the Users
table has no such action. Today the only way is `qinqin recover --reset-mfa` on the server's shell.

## What the route really does (read, not assumed)

- `handleAdminResetMFA`: admin only, personal access tokens refused (`noTok`), `409 self_target` for the
  acting administrator's own id (checked before the password), then `requireAdminPassword`
  (`422 password_required`, `403 wrong_password` through the reauth limiter), then
  `Users.ResetUserMFA` (`404 not_found` for an unknown id, only after the password), `204`.
- `auth.ResetMFA` in one transaction with an `mfa_reset` audit row: deletes the authenticator row
  (confirmed **and** a pending, unconfirmed setup), deletes every recovery code, turns the emailed-code
  second step off (`mfa_email = 0`), drops open second-step sign-in challenges, and
  `revokeCredentials(…, 0)`: deletes **every** session and revokes **every** personal access token.
- **Gap found:** the route does NOT ask for the acting administrator's authenticator code, although
  the v0.3.0 handoff lists "MFA reset of another user" among the actions that need it. Only
  `POST /api/admin/backup` does (`HasTOTP` + `secondFactorOK`).

## Decisions

- Ruling: the route asks an administrator who has an authenticator for a current authenticator or
  recovery code (`code`, `403 code_invalid`, the per-user code budget), checked after the password,
  exactly like the server backup — removing someone's strongest defence is as sensitive as the backup
  and the issue asks for it; a stolen admin session plus a phished password must not be enough —
  cost if wrong: one more field for admins with an authenticator; older web builds (none shipped with
  a button) are unaffected.
- Ruling (superseded by the review fix wave, see below): delete user, reset link and grant admin stay
  password-only in this item.
- Ruling: the order stays self → password → code → target lookup, so password and code are spent
  (a recovery code is used up, an authenticator code's step is consumed) before an unknown id is found —
  an unknown id answers 404 only to someone who already proved password and code, so the route cannot
  probe ids; the web app only offers ids from the list it just loaded, so a spent factor on a 404 means
  the account was deleted in between — cost if wrong: on that race the admin spends one recovery code
  or waits 30 s for the next authenticator code.
- Ruling: `wrong_password` and `code_invalid` stay distinct (as for the backup and self-deletion) —
  both are rate limited per user, and other admin routes already reveal whether a password is right —
  cost if wrong: an attacker holding a session learns the password was right before the code step.
- Ruling: the action is shown only when the row's user has a second step (`mfa.totp || mfa.email` from
  the list, which counts a confirmed authenticator only) and never on the own row — the server refuses
  the own id (`self_target`; Settings, Account manages one's own factors) and a reset of a user without
  a second step would only sign them out (there is "Sign out everywhere" for that) — cost if wrong: a
  user with only a pending, unconfirmed setup has no button (that setup cannot sign them in anyway).
- Ruling: a modal `<dialog>` like the delete dialog, not the inline password form — the action needs
  an explanation of what is removed and revoked, a password and maybe a code; the inline form holds one
  password field — cost: one more small component.
- Ruling: the code field is shown when the acting administrator's own `user.mfa.totp` is true (as in
  Server backup); the field accepts an authenticator or a recovery code — cost if wrong: the server
  still refuses with `code_invalid`, which the dialog explains.
- Ruling: the dialog never shows the server's message; it maps error codes to fixed sentences
  (`not_found` → "This account does not exist any more." and the list reloads) — enumeration-safe and
  stable — cost: a new server code falls back to one generic sentence.
- Ruling: focus — on open the password field; after a refused attempt the field to fix (code field on
  `code_invalid`, else password; both cleared on `wrong_password`/`code_invalid` as appropriate); after
  success or Cancel/Escape the dialog closes, the Users heading takes focus and a status line says
  what happened — same as after a deletion — cost: none known.
- Ruling: the audit log names the event "reset two-step sign-in" instead of the fallback "mfa reset".

## Review fix wave (independent security review)

The review found pre-existing holes, also in v0.3.0: creating a user with `admin: true` needed no
re-authentication at all (a stolen admin session alone could mint an administrator, who could then
reset the owner's two-step sign-in with only their own password), and only the backup asked for the code.

- Ruling: one helper `requireAdminReauth(password, code)` (password through the reauth limiter, then
  `HasTOTP` → `secondFactorOK` through the per-user code budget) for every destructive admin action:
  grant admin, create an administrator, delete another user, issue a reset link, reset another user's
  two-step sign-in, server backup — a stolen session plus a phished password is not enough anywhere —
  cost: admins with an authenticator type a code more often.
- Ruling: creating a user with `admin: true` is granting admin; creating a plain user needs nothing more
  (as before) — cost: none known.
- Ruling: an administrator whose only second step is the emailed code is asked for the password alone,
  as for the backup — sending an emailed code here would make the mailbox the proof, which is weaker
  than the password-plus-session the attacker is assumed to have, and email is down exactly when
  recovery is needed — cost if wrong: such admins are protected by their password only; the wiki
  recommends an authenticator for administrators.
- Ruling: a two-step sign-in reset also ends pending reset links (containment, like every other
  credential-revoking action) and its audit row counts revoked sessions and tokens (`revoked`,
  `tokens`; counts only).
- Ruling: the web asks for the code when the signed-in copy says the admin has an authenticator OR
  after the server answered `code_invalid`, so a stale copy (authenticator added in another tab) can
  still finish — cost: one refused attempt in that case.

## Confirmation text

Title: `Reset two-step sign-in for “<username>”?` Body (only what applies):

- "Their authenticator app and all of its recovery codes are removed." (when `mfa.totp`)
- "Sign-in codes by email are turned off." (when `mfa.email`)
- Always: "They are signed out on every device, and all of their personal access tokens are revoked."
- Always: "Next time they sign in with their password alone, or set up a second step again if this
  server requires one. Use this only after making sure the request really comes from them."

Success status: `Two-step sign-in of <username> was reset; they were signed out everywhere.`

## Pieces

- Server: `handleAdminResetMFA` gains `code` (Go test first); contract case `mfa_reset` in
  `docs/contracts/auth/admin-users.json` (+ `_doc`), decoded by the Go contract test and a web test;
  README of the auth contract and `API-Errors.md`/`errors.json` mention the reset.
- Web: `resetUserMfa(id, currentPassword, code?)` and `mfa` in `AdminUserDto`; pure
  `lib/admin/mfaResetView.ts` (lines, `canSubmit`, `resetError`, `focusAfterError`); `usersView`
  action `resetMfa`; thin `ResetMfaDialog.svelte`; `UsersAdmin.svelte` wiring; audit label.
- Docs: wiki Admin-users-and-registration, Admin-email-and-security, README sentence; the v0.3.0
  handoff's open line about the missing button is marked done.

## Non-goals

A server-side "has a second step" check, an email to the affected user, resetting one factor only,
adding the code requirement to the other admin actions.
