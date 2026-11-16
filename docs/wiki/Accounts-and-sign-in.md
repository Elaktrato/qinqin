# Accounts and sign-in

## Sessions

Signing in gives your browser a random token (64 hex characters). The server stores only a hash of it. A session you have not used for 90 days stops working. **Sign out** ends the session on the server too.

Settings, Account, Sessions lists your signed-in devices with a coarse label such as "Firefox on Linux" (never the raw User-Agent, never an address). You can end one, **Log out everywhere else**, or **Log out everywhere**.

If a session ends (it expired, you revoked it elsewhere, or an administrator signed you out), the app returns you to sign-in. Reviews you made offline stay queued for your account and are sent after you sign in again ([Install as an app and study offline](Install-and-offline)).

## Two-step sign-in

- **Authenticator app** (TOTP: 6 digits, 30 seconds). Add it in Settings, Account. You scan a QR code or type the secret, confirm with a code, and receive **10 single-use recovery codes**. Save them somewhere safe: each code works once, and they are shown only when created. An authenticator code can only be used once (replay is refused).
- **Emailed code**, where the server has email set up. A code lives 10 minutes and can be tried 5 times.
- An administrator can require two-step sign-in for everyone. It applies at your next sign-in; if you have no method yet you are sent to a setup page first.
- Where enabled, **Sign in with an emailed code** is a password-free route. An account with an authenticator still has to give the authenticator code.
- A password reset never removes two-step sign-in.

### Locked out

Use a recovery code at the second step. If you have none, ask an administrator to reset your two-step sign-in (Admin, Users), or the server owner can run `qinqin recover --username NAME --reset-mfa` ([Backup, recovery and the command line](Admin-backup-and-recovery)). If your only second step is an emailed code and the server's email is down, you cannot sign in until mail works.

## Changing your password

Settings, Account, Password. You enter the current password and a new one (10 to 256 characters, not your username). Other sessions are signed out by default. If an administrator gave you a temporary password, the app takes you to this page first and nothing else works until you change it.

Changing your password also revokes all your [access tokens](API-Access-tokens), so scripts that use one stop working until you give them a new token.

## Access tokens

Settings, Account, Access tokens: personal access tokens for your own scripts (read only or read and write, all workspaces or one, 7 to 365 days). Creating one asks for your password; the token is shown once. Logging out other devices, a password change or reset, and the administrator's security actions revoke them. See [API access tokens](API-Access-tokens).

## Email address

If the server's email policy is `optional` or `required`, set or change your address in Settings, Account. Changing it needs your password and, if you have one, an authenticator code; it cancels open reset links and notifies the old address. With email policy `off` (the default) no address is asked for or shown.

## Forgot your password

If the server has email, the sign-in page links "Forgot password?" and sends a one-time reset link (valid for a limited time). Otherwise ask an administrator for a reset link. Using a reset link sets your password, signs you out everywhere and signs you in on this device.

## Deleting your account

Settings, Account, Delete account. The dialog shows what is removed: workspaces, study history, flashcards, journal entries, reader settings, your dictionary edits and sentences, library books with bookmarks and highlights and their files, photo drafts, AI keys and usage, time-zone history, sessions, reset links and invites you created. Confirm with your password and by typing your username. Kept: admin-registered AI endpoints, installed packs and languages, and the audit log (your name becomes `deleted user #id`). The last active administrator cannot delete themselves. Consider downloading [your data](Your-data) first.

## Sign-in throttling

Too many failed attempts are refused with a "try again in a moment" answer (HTTP 429). It does not reveal whether a username exists. Details for administrators: [Reverse proxy, rate limiting and trusted proxies](Admin-proxy-and-rate-limiting).
