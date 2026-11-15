# v0.3.0 accounts — registration, invites, admin-created users, reset links (#64)

Part of `2026-11-15-v030-accounts-design.md` (shared rules, authorization matrix). Plan 2.

## 1. Settings row

Migration 032:

```sql
CREATE TABLE auth_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    registration TEXT NOT NULL DEFAULT 'closed' CHECK (registration IN ('closed','invite','open')),
    email_policy TEXT NOT NULL DEFAULT 'off' CHECK (email_policy IN ('off','optional','required')),
    mfa_enforced INTEGER NOT NULL DEFAULT 0,
    email_code_login INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    updated_by INTEGER
);
INSERT INTO auth_settings (id, updated_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%SZ','now'));
```

`users` gains `email TEXT`, `email_norm TEXT` (lower-cased, unique where not null),
`email_verified_at TEXT`, `disabled_at TEXT`, `must_change_password INTEGER NOT NULL DEFAULT 0`,
`created_at TEXT NOT NULL DEFAULT ''` (back-filled from `updated_at`), `password_changed_at TEXT`,
`must_change_after INTEGER` (session-id watermark, users spec §3). 032 rebuilds `users` with `AUTOINCREMENT` (overview).
`me` returns `email: null` while the policy is `off` (stored emails are hidden, §5).

- `GET /api/admin/settings/auth` → `{registration, emailPolicy, mfaEnforced, emailCodeLogin,
  mail:{configured}}`; `PATCH` the same keys (any subset) → the new object. `mfaEnforced` and
  `emailCodeLogin` can be switched on only while mail is configured (409 `mail_unavailable`);
  details in the smtp-mfa spec §5–§7. Every change is audited (`settings_changed`, field and
  new value; booleans and enum words only).
- `GET /api/auth/options` (public) → `{bootstrap, registration, emailPolicy, passwordReset,
  emailCodeLogin, passwordMinLength}`. `bootstrap` is true while no user exists.
  `passwordReset`/`emailCodeLogin` are the *effective* values (false without mail).
  Ruling: a public options route — the sign-in and register pages and the Kotlin client must
  know what to show before anyone is signed in; it reveals only instance-level switches — cost if
  wrong: an outsider learns the registration mode (they would learn it by trying anyway).

Ruling: email policy defaults to `off` — nothing personal is collected until an admin decides
— cost if wrong: an admin must flip one switch before users can add an email.

## 2. Registration modes

| Mode | Who can register | Invites |
|---|---|---|
| `closed` (default) | nobody (admins create users) | do not work (kept, shown as "inactive while closed") |
| `invite` | holders of a valid invite | work |
| `open` | anyone; an invite is accepted too and counts a use | work |

The zero-users bootstrap overrides every mode: the first registration always succeeds and becomes
admin (atomic `CreateFirstUser`, unchanged).
Ruling: switching to `closed` deactivates but does not delete invites — re-opening restores them,
and the admin sees exactly what exists — cost if wrong: an admin who expects "closed" to destroy
links must revoke them (the UI says so).

`POST /api/auth/register` `{username, password, email?, invite?}`:
1. Validate body (`username` rules §6, password policy, email per policy).
2. Zero users → bootstrap path (as today).
3. A valid, **unrestricted admin** principal → legacy admin path (users spec §4). Any other
   bearer (non-admin, expired, restricted) is ignored and the request follows the mode below.
   Anonymous registration in `invite`/`open` passes #86's L1 client bucket and the hash gate.
4. Else by mode: `closed` → 403 `registration_closed`; `invite` without/with bad invite → 403
   `invite_invalid` (one code for unknown, expired, used up, revoked); `open` → proceed.
5. 201 `User` (the `me` shape). The client then logs in as today (login may answer
   `mfa_enrollment_required` when MFA is enforced).

Errors: 409 `username_taken`, 409 `email_taken`, 422 `weak_password`, 422 `invalid_username`,
422 `email_required`, 422 `invalid_email`, 422 `email_disabled` (policy off and an email was sent).
Username and email collisions are disclosed — unavoidable for registration — and rate-limited
(#86 limiter, key `register`).

## 3. Invites

Migration 033 (with `password_resets`, §4):

```sql
CREATE TABLE invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    note TEXT NOT NULL DEFAULT '',          -- admin's label, ≤ 100 runes
    max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 100),
    uses INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,                         -- NULL = no expiry
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT
);
```

- `POST /api/admin/invites` `{maxUses (default 1), expiresInDays (1–90 or null; UI default 7),
  note}` → 201 `{invite: Invite, token, path: "/register#invite=<token>"}`.
  `Invite = {id, note, maxUses, uses, expiresAt, createdAt, createdBy:{id,name}, state}` with
  `state ∈ active | expired | used_up | revoked | inactive` (`inactive` = mode closed).
- `GET /api/admin/invites` → `{"invites":[Invite]}` (no tokens, ever). `DELETE …/{id}` → 204
  (sets `revoked_at`).
- `POST /api/auth/invite/check` `{invite}` → 200 `{expiresAt, emailPolicy}` or 403
  `invite_invalid` (the register page shows "this invite link is no longer valid").
- **Consume atomically** in the registration transaction: first statement
  `UPDATE invites SET uses = uses + 1 WHERE token_hash = ? AND uses < max_uses AND revoked_at IS
  NULL AND (expires_at IS NULL OR expires_at > ?)`; 0 rows → 403 `invite_invalid`; then the user
  insert on the same `tx`; a username clash rolls the use back. Test: a 1-use invite raced by 8
  goroutines creates exactly one user.
- The web client builds the full link from `location.origin + path`; the mail-less instance needs
  no public URL for this.
Ruling: invites carry no pre-set username or email — the owner asked for links with uses and
expiry, nothing more — cost if wrong: an admin wanting a personal invite creates the user instead.

## 4. Admin-created users and the forced change

`POST /api/admin/users` (users spec §4) stores `must_change_password = 1`. Login with the
temporary password answers `{"status":"password_change_required","token",user}`: a real session
whose principal is restricted (users spec §2) until `POST /api/account/password` succeeds. The
admin can also set the flag later (`PATCH … {mustChangePassword:true}`), which restricts every
existing session of that user on their next request.
Ruling: enforce through the user flag at every request, not a session property — a flag set later
takes effect on live sessions too, and there is one source of truth — cost if wrong: none found.

**Admin-issued reset links**:

```sql
CREATE TABLE password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    created_by INTEGER,                       -- admin id, NULL = requested by mail
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);
```

- `POST /api/admin/users/{id}/reset-link` `{expiresInHours: 1–168, default 24}` → 201
  `{path: "/reset#t=<token>", expiresAt}`. Issuing deletes the user's earlier unused resets
  (one live link per user). Does not touch the password or sessions until it is used.
- `POST /api/auth/reset/check` `{token}` → 200 `{username, expiresAt}` | 400 `token_invalid`.
- `POST /api/auth/reset` `{token, password, deviceName?}` → in one transaction: mark used
  (guarded `UPDATE … WHERE used_at IS NULL AND expires_at > now`), set the hash, clear
  `must_change_password`, delete **all** the user's sessions; then answers like a login
  (`ok`, or `mfa_required` when the user has MFA: a reset does not remove MFA). A disabled user's
  link answers 400 `token_invalid` (no disclosure beyond the token holder).
Ruling: a used reset signs the user in — they just proved possession of a fresh secret — cost if
wrong: none; MFA still applies.
Ruling: admin reset links default to 24 h, mail ones 1 h (smtp-mfa spec §4) — an admin hands a
link over by chat, a mail arrives within seconds — cost if wrong: an expired link, issue another.

## 5. Email policy

- `off`: no email field anywhere; stored emails are kept but unused and hidden (switching back to
  optional brings them back). Mail features are off.
- `optional`: the user may add/remove one (Account settings); admin may set one.
- `required`: register and admin-create need one (422 `email_required`); users cannot remove
  theirs. Existing users without one are **not** blocked; they see a banner in Settings and on Home
  asking them to add one.
  Ruling: no forced "add email" gate for existing users — a soft prompt avoids locking out
  someone on a phone without mail access; enforcement of a verified channel is MFA's job — cost
  if wrong: some accounts stay without email under `required`.
- Validation: `net/mail.ParseAddress`, keep only `addr.Address`, ≤ 254 bytes, no control
  characters, exactly one `@` with a dot-containing domain; `email_norm` = lower-cased. Unique
  across users (409 `email_taken`). Emails entered by an admin count as verified; user-entered ones
  need the code (smtp-mfa spec §3); without mail they stay unverified.

## 6. Usernames and the CLI

New usernames: 3–32 runes of letters, digits, `.`, `_`, `-` (Unicode letters allowed), no `@`
(so a login identifier with `@` is an email), unique case-insensitively against existing names.
Existing names are grandfathered; login stays an exact match.
Ruling: no `@` in new usernames — "username or email" fields stay unambiguous — cost if wrong:
someone wanting an email-shaped username picks another.

CLI: `qinqin adduser` applies the password policy. New `qinqin recover --username X
[--reset-mfa] [--enable] [--admin]`: reads a new password from `QINQIN_PASSWORD` or stdin, sets it
with `must_change_password = 1`, deletes the user's sessions, optionally removes TOTP and recovery
codes, re-enables and/or makes admin, writes an audit row with actor `cli`. This is the lockout
recovery for an instance whose only admin lost the password or the authenticator.

## 7. Web UI (registration part)

- `/login`: username, password; links shown from `options`: "Create an account" (bootstrap or
  mode `open`; for `invite` the text "Have an invite link? Open it to register."), "Forgot
  password?" (when `passwordReset`; else "Ask your administrator for a reset link" as plain
  text), "Email me a sign-in code" (smtp-mfa spec §7). Steps (MFA, code entry) are one state
  machine in `lib/account/loginFlow.ts`.
- `/register`: reads `#invite=` (then strips it), checks it, shows the email field per policy;
  when registration is closed and there is no invite: "Registration is closed. Ask the
  administrator for an invite link or an account." The bootstrap notice stays.
- `/reset`: with `#t=`: check, then new password + confirm, then signed in. Without: the
  request-by-mail form when `passwordReset`, otherwise the admin hint.
- Settings → Admin → **Invites**: create form (uses 1–100, expiry: 1/7/30/90 days or none,
  note); the result shows the full link once in a read-only field with Copy and "This link is
  shown once." List with state badges (text), uses `2 / 5`, expiry, Revoke.
  → **Security**: registration mode radio group with one sentence each; email policy radio group;
  MFA and email-code switches (smtp-mfa spec); audit log list with "Load older".
- Pure modules: `lib/account/loginFlow.ts`, `lib/account/fragment.ts` (read and strip
  `#invite=` / `#t=`), `lib/admin/invitesView.ts` (state labels, expiry choices → payload),
  `lib/admin/securityView.ts` (which switches are available and why).
