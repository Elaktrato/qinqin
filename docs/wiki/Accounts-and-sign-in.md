# Accounts and sign-in

This page is the user's side: signing in, sessions, two-step sign-in and your password. Registration modes, invites, account management and the mail setup are for administrators: see [Users, registration and invites](Admin-users-and-registration) and [Email, two-step sign-in and security](Admin-email-and-security).

## Signing in

The sign-in page asks for your **Username** and password. Depending on the server it also offers:

- **Forgot password?** where the server has email: enter your username or the email address of your account, and if it has a verified address a reset link is mailed to it; the link works for one hour. Without email the page says "Forgot your password? Ask your administrator for a reset link." A link from an administrator works for 24 hours by default.
- **Email me a sign-in code**, where the administrator turned sign-in by emailed code on (see Two-step sign-in below).
- **Create one** (a link to registration) when registration is open, or a note about invite links.

Usernames are matched exactly at sign-in; for new names, `Bob`, `bob` and a fullwidth `Ｂob` count as the same name ([Getting started](Getting-started#signing-in)). A disabled account gets "This account is disabled. Ask an administrator to enable it." with the right password, and the usual refusal with a wrong one.

If an administrator gave you a temporary password, or the server requires two-step sign-in and you have no second step yet, your first page is **Choose a new password** or **Two-step sign-in is required**. Until you have done that, only that page, the Sources page and **Sign out instead** are open.

## Sessions

Signing in gives your browser a random token (64 hex characters). The server stores only a hash of it, so a copy of the database or a backup hands out no live session. A session you have not used for 90 days stops working. **Sign out** ends the session on the server too, and the app forgets everything it kept in memory for you (cards, decks, entries, audio, the journal, offline copies), so the next person who signs in on the same device sees none of it. The same happens when a session expires or another tab signs in as someone else; only an explicit sign-out also forgets the chosen workspace.

Settings → Account → Sessions lists your signed-in devices with a coarse label such as "Firefox on Linux" (never the raw User-Agent, never an address), when each signed in and when it was last active. You can end one, **Log out everywhere else**, or **Log out everywhere**.

If a session ends (it expired, you revoked it elsewhere, or an administrator signed you out), the app returns you to sign-in. Reviews you made offline stay queued for your account and are sent after you sign in again ([Install as an app and study offline](Install-and-offline)).

## Two-step sign-in

- **Authenticator app** (TOTP: 6 digits, 30 seconds). Add it in Settings → Account → Two-step sign-in (**Set up two-step sign-in**). You scan a QR code (drawn in your browser; the secret is never sent anywhere else) or type the secret, confirm with a code, and receive **10 single-use recovery codes** (copy them or **Download .txt**, then tick **I have saved these codes**). Each code works once, and they are shown only when created; the page warns when few are left and offers **Make new recovery codes**. An authenticator code can only be used once (replay is refused). Authenticator apps need the server secret; without it the page says so.
- **Emailed code** (**Add email codes**), where the server has email set up and your address is confirmed. A code lives 10 minutes and can be tried 5 times; at most 10 wrong codes per account in 15 minutes count across all sign-ins.
- At the second step you can switch between **Use my authenticator app**, **Email me a code instead** and **Use a recovery code**. Settings shows which methods are on, and turns each one off separately (with your password).
- An administrator can require two-step sign-in for everyone. It applies at your next sign-in; if you have no method yet you are sent to a setup page first.
- Where enabled, **Sign in with an emailed code** is a password-free route: enter your username or address and the code that arrives. An account with an authenticator still has to give the authenticator code, and while two-step sign-in is required an account without an authenticator must use its password.
- A password reset or reset link never removes two-step sign-in, and a reset link or an emailed code is never accepted as the second step after itself.
- If your only second step is an emailed code, your mailbox alone protects the account; while the server cannot send mail you cannot sign in ("Two-step sign-in by email is not working right now…"). An authenticator app makes you independent of mail.

### Locked out

Use a recovery code at the second step. If you have none, ask an administrator to reset your two-step sign-in (Admin, Users), or the server owner can run `qinqin recover --username NAME --reset-mfa` ([Backup, recovery and the command line](Admin-backup-and-recovery)). If your only second step is an emailed code and the server's email is down, you cannot sign in until mail works.

## Changing your password

Settings → Account → Password. You enter the current password and a new one twice (10 to 256 characters, not your username). **Sign out my other sessions** is ticked by default. If an administrator gave you a temporary password, the app takes you to this page first and nothing else works until you change it.

Changing your password also revokes all your [access tokens](API-Access-tokens), so scripts that use one stop working until you give them a new token.

## Access tokens

Settings, Account, Access tokens: personal access tokens for your own scripts (read only or read and write, all workspaces or one, 7 to 365 days). Creating one asks for your password; the token is shown once. Logging out other devices, a password change or reset, and the administrator's security actions revoke them. See [API access tokens](API-Access-tokens).

## Profile picture

Settings → Account → Profile: **Choose a picture** opens your device's picker; on a phone or tablet **Take a photo** opens the front camera. A JPEG, PNG or WebP works; other files (GIF, SVG, HEIC, AVIF, BMP) and animated pictures do not. Crop it to the circle: drag the picture (mouse or finger), zoom with the slider, the mouse wheel or two fingers, or focus the crop area and use the arrow keys to move and `+` / `−` to zoom (Escape cancels). **Save picture** uploads the square you chose. **Replace picture** starts again, **Remove picture** goes back to the letter.

The picture shows on the account button of the top bar and the phone bar, in the account menu and in the administrators' user list; wherever there is no picture, or it cannot load (offline, for example), the first letter of your username stays. Everyone signed in to this server can see it; it is never public. The server decodes every upload and stores new square files (256 and 64 pixels), so nothing of the original file is kept: no location, camera data or other metadata. Limits: 5 MB per upload, 25 megapixels (half that for 16-bit pictures), 10 changes an hour. An administrator can remove a picture (recorded in the audit log). The picture is in [your data](Your-data) downloads and is deleted with your account.

## Email address

If the server's email policy is `optional` or `required`, set or change your address in Settings, Account. Changing it needs your password and, if you have one, an authenticator code; it cancels open reset links and notifies the old address. With email policy `off` (the default) no address is asked for or shown.

## Mails in your language

The mails qinqin sends (password reset, sign-in codes, email confirmation, address changes) use your interface language from Settings → Account; with "Browser default" a mail you trigger uses your browser's language, and English when the server has no mail text in it.

## Forgot your password

If the server has email, the sign-in page links "Forgot password?" and sends a one-time reset link, valid for one hour. Otherwise ask an administrator for a reset link. Using a reset link sets your password, signs you out everywhere and signs you in on this device.

## Deleting your account

Settings, Account, Delete account. The dialog shows what is removed: workspaces, study history, flashcards, journal entries, reader settings, your dictionary edits and sentences, library books with bookmarks and highlights and their files, your profile picture, photo drafts, AI keys and usage, time-zone history, sessions, reset links and invites you created. Confirm with your password and by typing your username. Kept: admin-registered AI endpoints, installed packs and languages, and the audit log (your name becomes `deleted user #id`). The last active administrator cannot delete themselves. The full list, also for an administrator deleting someone else's account, is on [Users, registration and invites](Admin-users-and-registration#what-deleting-an-account-removes). Consider downloading [your data](Your-data) first.

## Sign-in throttling

Too many failed attempts are refused with a "try again in a moment" answer (HTTP 429). It does not reveal whether a username exists. Details for administrators: [Reverse proxy, rate limiting and trusted proxies](Admin-proxy-and-rate-limiting).
