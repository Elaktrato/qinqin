# Getting started

## Before your first sign-in

An administrator runs the server (see [Deploying](Admin-deploying)). You need its address and an account. How you get one depends on the server's registration mode:

- **Closed** (the default): an administrator creates your account and gives you a temporary password. At your first sign-in you must choose your own password before anything else works.
- **Invite**: you get an invite link of the form `https://your-server/register#invite=...`. Open it and register.
- **Open**: anyone who reaches the server can register at `/register`.

The very first account on an empty server always registers successfully and becomes the administrator, whatever the mode. See [Users, registration and invites](Admin-users-and-registration).

## Signing in

Open the server's address; signed-out visitors land on `/login`. Enter your username and password. If you set up two-step sign-in a second screen asks for an authenticator code, an emailed code or a recovery code (see [Accounts and sign-in](Accounts-and-sign-in)).

Rules for new accounts: a password of 10 to 256 characters that is not your username (no other rules); a username of 3 to 32 letters, digits, dots, underscores or hyphens. Usernames are compared case-insensitively, so `Bob` and `bob` are the same name.

If you have forgotten your password and the server has email set up, the sign-in page offers a reset link by mail. Otherwise ask an administrator for a reset link.

## The home page

The logo is the link to the home page. The home page shows widgets in the order you choose under Settings, Home. By default these are the activity heatmap and the flashcards summary. A widget that does not apply to the current workspace's language is left out.

## Finding your way around

- The **top bar** (720 px and wider) has the logo, which takes you home, the sections as icons in the middle — Decks and Reader (unless you switched them off under Settings, Features), one item per enabled plugin page (for example Journal; the set depends on which plugins are on under Settings, Plugins), then Search and Stats — and on the right your workspace's flag and your avatar. Hover or focus an icon to see its name. Study sessions start from `/study`, the Decks page and the home widget.
- On narrow screens (under 720 px) the bar shows a **menu button**, the page title and the flag; the menu opens a drawer with your workspaces as flags, the sections with their names (Home first) and your account.
- The **flag** opens the workspace menu: switch between your study spaces, or **Manage workspaces** to create one ([Workspaces and languages](Workspaces-and-languages)).
- The **avatar** opens the account menu: **Settings**, **Theme** (switch the theme in one click), **Admin settings** for administrators, **Sources** and **Sign out**. Sources (credits and licences for all bundled data) is also open to visitors who are not signed in.
- The first Tab stop on every page is a "Skip to content" link.

## A first ten minutes

1. Search for a word you know ([Searching and entries](Searching-and-entries)) and press **Add to study** on its entry.
2. Open **Study**, keep the defaults and start a session ([Flashcards: study sessions](Flashcards-study-sessions)).
3. Open the Decks page to see what is due and what is new.
4. Optional: set your time zone under Settings, Study, so that "today" matches your day ([Settings tour](Settings-tour)).
5. Optional: add an authenticator app for two-step sign-in.
