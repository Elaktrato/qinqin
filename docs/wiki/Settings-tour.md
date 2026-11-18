# Settings tour

Settings is in the account menu (the avatar at the top right; in the menu drawer's account area on a phone). Administrators also find **Admin settings** there. The open tab is part of the address (`/settings?tab=home`), so you can bookmark or share a tab. Tabs are Workspaces, Home, Appearance, Study, Features, Plugins, AI and Account for everyone, and Data and Admin for administrators.

## Workspaces

Create, rename and delete workspaces ([Workspaces and languages](Workspaces-and-languages)); choose which dictionaries a workspace hides; and two audio options for the current workspace (pronunciation buttons on entries and, after the answer, on study cards).

## Home

Chooses and orders the home-page widgets. Each widget has an "On the home page" switch and **Move up** / **Move down** buttons (or drag a row by its handle). A preview shows the result and **Reset to default** restores the default layout (activity, flashcards, the daily goal, then this week). The Stats summary widgets **Summary** and **Reviews per day** can be added to the home page too. Changes save immediately to your account, so every device and workspace gets them. A widget whose plugin is disabled keeps its place and returns when the plugin is enabled again; one that does not fit the active workspace's language is marked "Not available for <language>".

While the Activity widget is on the home page its row also offers **Heatmap layout**: Garden grid (13 weeks), Month calendar or This week ([Stats and the heatmap](Stats-and-heatmap)). It saves at once to your account; Stats keeps the garden grid.

## Appearance

Your colour theme and adjustments (`/settings?tab=appearance`), saved to your account so every device gets them. **Mode** is System (follows your device's light or dark setting), Light or Dark; you pick a **Light theme** and a **Dark theme** (qinqin Day, Night and Deep and the Neon, Pigments and Pop extras, then Catppuccin, Rosé Pine, Nord, Gruvbox, Dracula, Solarized, Tokyo Night, Everforest, Kanagawa and any theme pack an administrator installed), each with an **accent** — only accents that stand out at least 3:1 against the theme's background are offered. **Corners** (Sharp, Soft, Round), **Spacing** (Compact, Comfortable) and the **Hanzi and kanji font** (Sans, Serif, Kai) complete it: every hanzi and kanji text in the app (cards, entries, search results, the reader unless it has a font of its own) uses it, in simplified, traditional or Japanese forms by the text's language, from a font pack an administrator installed or else your device's fonts (the group says when no pack provides the chosen face). Every change shows right away, with a preview of text, hanzi and kanji samples, the primary action, the grade colours and the reader's word marks; **Save** keeps it, **Discard changes** goes back, **Reset to defaults** restores qinqin Day and qinqin Night. Leaving the tab without saving returns to your saved look. **Theme** in the account menu switches the theme of the current mode in one click. The app remembers the last theme on this device, so it starts in your colours even offline.

## Study

- **Time zone.** Every "day" in qinqin (heatmap, streaks, daily XP bonus, reading totals, vacation, daily limits, daily goal, weekly summary) is your local day. The zone is stored on the server so every client agrees. The first time you sign in, the web app sends your browser's zone if your account has none. If your device zone later differs, Settings offers "Use <zone> from now on"; nothing changes by itself. The first zone you ever get applies to your whole history; later changes apply from the moment you save. Without a zone, days are UTC.
- **Daily goal**: what to count each day (reviews, new cards, minutes of flashcard study or another activity), the target, and whether to show the goal streak ([Daily goals](Daily-goals)).
- **Daily limits** and **Vacation** ([Decks, limits and vacation](Flashcards-decks-limits-vacation)).
- **Show my notes on the answer side** (per workspace, on by default): your personal notes on words below a revealed flashcard ([Flashcards: study sessions](Flashcards-study-sessions)).
- A link to Scheduling ([Scheduling and FSRS](Scheduling-and-FSRS)).

## Features

Switch **Decks** (flashcards) or the **Reader** off for yourself. A switched-off feature's page, navigation link and widgets are hidden for you only; nothing is deleted, and reviews and reading time from another device still count in your stats and goals. Switch it back on at any time.

## Plugins

Switch feature plugins on or off (Journal, Grammar and others). Each plugin lists the permissions it declared and the third-party material it uses. Switching a plugin off hides its pages and widgets.

## AI

Providers, keys and model per provider, the active provider, and this hour's usage ([Journal and AI providers](Journal-and-AI)). Administrators also register custom endpoints here.

## Account

**Interface language**: the language of menus, buttons and messages, and of the mails the server sends you. "Browser default" follows your browser's language settings; choosing a language stores it on the server for every device, and saving reloads the page. English is the only interface language today ([Translating qinqin](Translating-qinqin)). Dates and numbers follow your device's region (an English interface without a region shows "16 Nov 2026").

Profile (email, if the server asks for one), password, two-step sign-in, signed-in devices, access tokens for scripts ([API access tokens](API-Access-tokens)), "Your data" (export and restore, and a link to the lookup history), the app and offline section, and Delete account. See [Accounts and sign-in](Accounts-and-sign-in), [Your data](Your-data) and [Install as an app and study offline](Install-and-offline).

## Data (administrators)

Install dictionary, level and theme packs, register or remove languages ([Data and licences](Data-and-licences)). Each pack shows its data package (revision, size, state, and for administrators the error of a failed build); "Packages are being built" appears while the server builds them. A theme pack's review shows the measured contrast of each of its themes (pair, ratio, minimum, "Passes" or "Below"); a theme below a minimum can still be installed.

## Admin (administrators)

Sections Users, Invites, Email, Security and Backup (`/settings?tab=admin&section=users` and so on). See [Users, registration and invites](Admin-users-and-registration), [Email, two-step sign-in and security](Admin-email-and-security) and [Backup, recovery and the command line](Admin-backup-and-recovery).
