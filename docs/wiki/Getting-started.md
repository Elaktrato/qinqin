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

- The **navigation** (a bottom tab bar on narrow screens, under 720 px) holds Search and one item per enabled plugin page (for example Decks, Reader, Journal; the exact set depends on which plugins are on under Settings, Plugins). Study sessions start from `/study`, the Decks page and the home widget.
- The **workspace picker** in the header switches between your study spaces and can create a new one ([Workspaces and languages](Workspaces-and-languages)).
- **Stats**, **Sources** and **Settings** live in the footer of every signed-in page. Sources (credits and licences for all bundled data) is also open to visitors who are not signed in.
- The first Tab stop on every page is a "Skip to content" link.

## A first ten minutes

1. Search for a word you know ([Searching and entries](Searching-and-entries)) and press **Add to study** on its entry.
2. Open **Study**, keep the defaults and start a session ([Flashcards: study sessions](Flashcards-study-sessions)).
3. Open the Decks page to see what is due and what is new.
4. Optional: set your time zone under Settings, Study, so that "today" matches your day ([Settings tour](Settings-tour)).
5. Optional: add an authenticator app for two-step sign-in.
