# Users, registration and invites

All of this lives in **Settings → Admin** (`/settings?tab=admin`), which only administrators see. Its sections are Users, Invites, Email, Security and Backup (`/settings?tab=admin&section=users` and so on).

## The first administrator

The very first registration on an empty database always works and makes that person the administrator, in every registration mode. So create the admin before the port is reachable from outside your LAN: with `qinqin adduser --admin --username <name>` in the container, or automatically with `QINQIN_BOOTSTRAP_ADMIN` ([Deploying](Admin-deploying#deploying-with-portainer)), which creates the admin before the port opens. Afterwards the default mode `closed` refuses everyone but an administrator.

## Registration and email policy (Admin → Security)

Who may create an account:

- `closed` (the default): nobody registers; administrators create accounts.
- `invite`: only people holding an invite link.
- `open`: anyone who reaches the server.

The **email policy** decides whether addresses are collected: `off` (the default: nothing personal is asked or shown), `optional`, or `required` (new accounts need one; existing accounts are only asked, never locked out).

Opening registration or lowering the email policy asks for your own password again (see "Re-authentication" below); tightening does not.

Account rules the server enforces: usernames are 3 to 32 letters, digits, dots, underscores or hyphens, unique regardless of case and width (`Bob`, `bob` and a fullwidth `Ｂob` are one name; a name mixing Latin with Cyrillic or Greek letters is refused). Passwords need 10 to 256 characters and may not equal the username. Email domains are stored in their ASCII (punycode) form, so `bücher.de` and `xn--bcher-kva.de` are one address; a part before the `@` with non-ASCII letters is refused.

## Invites (Admin → Invites)

**Create invite link** with 1 to 100 uses, an expiry of 1, 7, 30 or 90 days or never, and an optional note. The link has the form `https://your-server/register#invite=...` and is shown **once**, when created; the server keeps only a hash, and the token sits in the URL fragment, which browsers never send to a server. **Revoke** a link at any time. While registration is `closed` invites are kept but inactive ("Invites do not work while registration is closed"). An expired, used up, revoked or unknown link all get the same answer.

## Users (Admin → Users)

- **Create user**: username, an optional email, a temporary password (**Generate** makes one) and the **Administrator** box. The new user must choose their own password at the first sign-in; their session can do nothing else until then. Ticking Administrator asks for your own password as well.
- **Reset link**: shown once, valid 24 hours by default (1 to 168), usable once, one live link per user. Using it sets the password, signs the person out of every device and signs them in on that one. **Revoke reset link** cancels a pending one. Pending links also die with every containment action: a password change, a forced change, disabling, signing out everywhere, `qinqin recover`, using a link.
- **Require password change**, **Disable** / **Enable**, **Make admin** / **Remove admin**, **Sign out everywhere** (ends the user's sessions and revokes their [access tokens](API-Access-tokens)). Disabling deletes the account's sessions; enabling never brings them back. Forcing a password change signs the user out everywhere.
- **Reset two-step sign-in**: for someone who lost their authenticator and recovery codes. The action appears only for another user who has a second step (an authenticator app or emailed codes); your own are in Settings → Account. The dialog says what happens: their authenticator app and all its recovery codes are removed, emailed codes are turned off, they are signed out on every device, their personal access tokens are revoked and pending reset links stop working. They then sign in with the password alone, or set up a second step again if the server requires one. Make sure the request really comes from them.
- **Delete**: a preview lists what goes (below).
- **The last active administrator** cannot be demoted, disabled or deleted ("The last administrator cannot be removed"); the server enforces this even when two administrators act at the same moment.

A disabled account answers `account_disabled` when the right password is given, so the person knows why; a wrong password still gets the usual 401. This tells someone who already holds the password that the account exists and is disabled, which was judged better than a mystery refusal.

### What deleting an account removes

The same list applies when an administrator deletes someone and when people delete themselves (Settings → Account, with their password and username typed). Removed in one step: workspaces, study events, plugin data (flashcards, journal entries, reader settings), edited dictionary entries, sentences the user added, library books with their bookmarks, highlights and files, journal photo drafts and their files, AI keys and selection, AI usage records, time-zone history, sessions, reset links, and invites the account created.

**Kept**: AI endpoints the account registered as administrator (their creator becomes nobody), installed packs, languages and dictionaries, and the audit log (the name in it becomes `deleted user #<id>`). The last active administrator cannot delete themselves.

### Re-authentication

These actions ask for **your own password again** and, if you have an authenticator app, a current code from it or an unused recovery code:

- making someone an administrator (also by creating them as one);
- removing admin from, or disabling, another administrator;
- setting or removing anyone's email address in Admin → Users (your own too);
- deleting another user;
- issuing a reset link;
- resetting someone's two-step sign-in;
- saving or removing the email settings;
- a Security change that lowers a protection (turning required two-step sign-in off, allowing sign-in by emailed code, opening registration, lowering the email policy) or signs everyone else out;
- a server backup.

An administrator whose only second step is an emailed code gives the password alone, so give administrators an authenticator app. Wrong codes here have their own budget (10 per 15 minutes, 30 a day) and do not lock you out of signing in. The exact rules are in `docs/contracts/auth/README.md` ("Administration") and `admin-reauth.json`.

## Audit log (Admin → Security, Recent activity)

Lists who did what, newest first (**Load older** pages back), never a password, token or address. An hourly janitor drops rows older than 180 days.

## Locked out as administrator

Run `qinqin recover` in the container ([Backup, recovery and the command line](Admin-backup-and-recovery#the-command-line)).

## Related

[Email, two-step sign-in and security](Admin-email-and-security), [Accounts and sign-in](Accounts-and-sign-in) (the user's side).
