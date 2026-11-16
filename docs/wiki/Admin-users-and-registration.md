# Users, registration and invites

All of this lives in Settings, Admin (`/settings?tab=admin`), which only administrators see.

## Registration policy

Admin, Security sets who may create an account:

- `closed` (the default): nobody registers; administrators create accounts.
- `invite`: only people holding an invite link.
- `open`: anyone who reaches the server.

The very first registration on an empty database always works and becomes the administrator in every mode. An **email policy** decides whether addresses are collected: `off` (default), `optional`, or `required` (new accounts need one; existing accounts are asked but never locked out).

## Invites (Admin, Invites)

Create a link with 1 to 100 uses, an expiry of 1, 7, 30 or 90 days or none, and an optional note. The link has the form `https://your-server/register#invite=...` and is shown **once**, when created; the server keeps only a hash. The token is in the URL fragment, which browsers never send to a server. Revoke a link any time. While registration is `closed`, invites are kept but inactive. An expired, used-up, revoked or unknown link all get the same answer.

## Users (Admin, Users)

- **Create a user.** The new user gets a temporary password and must choose their own at first sign-in; their session can do nothing else until then. Ticking Administrator asks for your own password (and code) as well.
- **Reset link.** A row action; shown once, valid 24 hours by default (1 to 168), usable once. Using it sets the password, signs the person out everywhere and signs them in on that device. You can revoke a pending link.
- **Disable, enable, make administrator, end sessions.** Disabling deletes the account's sessions; re-enabling does not bring them back.
- **Reset two-step sign-in.** For someone who lost their authenticator and recovery codes. The row action appears only for another user who has a second step (an authenticator app or emailed codes); your own are in Settings, Account. A dialog says what happens: their authenticator app and all of its recovery codes are removed, emailed codes are turned off, they are signed out on every device, their personal access tokens are revoked and pending reset links stop working. They then sign in with the password alone, or set up a second step again if the server requires one. It asks for your own password and, if you have an authenticator, your authenticator or recovery code. Make sure the request really comes from them.
- **Delete a user.** A preview lists what goes (the same as when users delete themselves). Making someone an administrator (also when creating them), deleting another user, issuing a reset link, resetting someone's two-step sign-in and a server backup ask for your own password again and, if you have an authenticator app, a current code from it (or an unused recovery code). If your only second step is an emailed code, the password is enough; give administrators an authenticator app.
- The **last active administrator** cannot be demoted, disabled or deleted; the server enforces this even if two admins act at once.

Disabled accounts answer `account_disabled` when the right password is given, so the person knows why; a wrong password still gets the usual 401.

## Audit log (Admin, Security)

Lists who did what, never a password, token or address. Rows older than 180 days are dropped by an hourly janitor.

## Locked out as administrator

Run `qinqin recover` on the server ([Backup, recovery and the command line](Admin-backup-and-recovery)).

## Related

[Email, two-step sign-in and security](Admin-email-and-security), [Accounts and sign-in](Accounts-and-sign-in).
