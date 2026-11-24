# Getting started

## Before your first sign-in

An administrator runs the server (see [Deploying](Admin-deploying)). You need its address and an account. How you get one depends on the server's registration mode:

- **Closed** (the default): an administrator creates your account and gives you a temporary password. At your first sign-in you must choose your own password before anything else works.
- **Invite**: you get an invite link of the form `https://your-server/register#invite=...`. Open it and register.
- **Open**: anyone who reaches the server can register at `/register`.

The very first account on an empty server always registers successfully and becomes the administrator, whatever the mode (the registration page says "This is a new instance: the first account becomes the administrator."). See [Users, registration and invites](Admin-users-and-registration).

## Signing in

Open the server's address; signed-out visitors land on `/login`. Enter your username and password. If you set up two-step sign-in a second screen asks for an authenticator code, an emailed code or a recovery code (see [Accounts and sign-in](Accounts-and-sign-in)).

Rules for new accounts: a password of 10 to 256 characters that is not your username (no other rules); a username of 3 to 32 letters, digits, dots, underscores or hyphens. Usernames are compared without regard to case or to wide and narrow letter forms, so `Bob`, `bob` and a fullwidth `Ｂob` are the same name; a name that mixes Latin with Cyrillic or Greek letters is refused. Older accounts whose names collide under this rule keep working.

If you have forgotten your password and the server has email set up, the sign-in page offers a reset link by mail. Otherwise ask an administrator for a reset link.

## The home page and the menus

After signing in you land on the home page: a greeting, today's date, a search box and your widgets. A new account shows the activity heatmap, the flashcards summary, the daily goal and this week; choose and order them under Settings → Home. A widget that does not apply to the current workspace's language is left out.

The top bar (on a phone, the menu) leads to Search, Decks, Reader, Journal, Grammar and Stats; the flag switches workspace and your avatar opens Settings, the theme switch, Sources and Sign out. [Finding your way](Finding-your-way) describes the frame in detail.

## A first ten minutes

1. Search for a word you know ([Searching and entries](Searching-and-entries)) and press **Add to deck** on its entry. Or open **Decks** and press **Add** on a starter or level deck to copy a whole list of words in one click ([Decks, limits and vacation](Flashcards-decks-limits-vacation)).
2. Press **Study** on a deck, or open the study setup (`/study`), keep the defaults and press **Start studying** ([Flashcards: study sessions](Flashcards-study-sessions)).
3. Open a book in the [Reader](Reader), or a lesson in [Grammar](Grammar-lessons), and look words up as you go.
4. Optional: check your time zone under Settings → Study, so that "today" matches your day ([Settings tour](Settings-tour#study)).
5. Optional: pick your colours under Settings → Appearance ([Appearance and themes](Appearance-and-themes)) and your interface language under Settings → Account → Language.
6. Optional: add an authenticator app for two-step sign-in ([Accounts and sign-in](Accounts-and-sign-in)).
