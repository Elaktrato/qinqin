# Settings tour

Settings is in the account menu (the avatar at the top right, your profile picture or your initial; in the menu drawer's account area on a phone, which also has a Settings button). Administrators also find **Admin settings** there. The open tab is part of the address (`/settings?tab=home`), so you can bookmark or share a tab. Tabs are Workspaces, Layout, Appearance, Study, Features, Notifications, AI and Account for everyone, and Data and Admin for administrators. The tabs wrap onto a second line on narrow screens, so all of them stay visible.

## Workspaces

Create, rename and delete workspaces ([Workspaces and languages](Workspaces-and-languages)); choose which dictionaries a workspace hides; and two audio options for the current workspace: **Play audio on reveal** (after a flashcard's answer) and **Use device voice when no recording exists** (pronunciation buttons appear on entries and, after the answer, on study cards).

## Home

Chooses and orders the home-page widgets. Each widget has an "On the home page" switch and **Move up** / **Move down** buttons (or drag a row by its handle). A preview shows the result and **Reset to default** restores the default layout (activity, flashcards, the daily goal, then this week). The Stats summary widgets **Summary** and **Reviews per day** can be added to the home page too. Changes save immediately to your account, so every device and workspace gets them. A widget whose plugin is disabled keeps its place and returns when the plugin is enabled again; one that does not fit the active workspace's language is marked "Not available for <language>".

While the Activity widget is on the home page its row also offers **Heatmap layout**: Garden grid (52 weeks), Month calendar or This week ([Stats and the heatmap](Stats-and-heatmap)). It saves at once to your account; Stats keeps the garden grid.

## Appearance

Your colour theme and adjustments (`/settings?tab=appearance`), saved to your account so every device gets them: **Mode** (System, Light or Dark), a **Light theme** and a **Dark theme** with an **accent** each (qinqin Day, Night and Deep, the Neon, Pigments and Pop extras, Catppuccin, Rosé Pine, Nord, Gruvbox, Dracula, Solarized, Tokyo Night, Everforest, Kanagawa and any installed theme pack), **Corners**, **Spacing** and the **Hanzi and kanji font** (Sans, Serif, Kai). Changes show at once with a preview; **Save**, **Discard changes** and **Reset to defaults**. **Theme** in the account menu switches the theme in one click. Everything in detail: [Appearance and themes](Appearance-and-themes).

## Study

- **Study day** (time zone). Every "day" in qinqin is your local day, starting at midnight in your time zone: the heatmap, streaks, the daily XP bonus, reading totals, vacation, daily limits, the daily goal, the weekly summary, milestones and the Reader's suggestions for today. The zone is stored on the server, so every device and client agrees. **Search time zones** picks one (IANA names such as Asia/Tokyo).
  - The first time you sign in, the web app sends your browser's zone if your account has none. If your device's zone later differs, Settings says "This device is set to …" and offers **Use <zone> from now on**; nothing changes by itself.
  - The first zone your account ever gets applies to your whole history, so past days are read once in that zone. Later changes apply from the moment you save: past days never move, a date never repeats (moving west makes the current day longer) and a skipped date simply has no activity. Days with a daylight-saving change are 23 or 25 hours long and still one day.
  - Without a zone, days are UTC. A browser that does not know a zone you used counts that period in UTC and says so.
  - An account can hold only a limited number of zone changes ("This account has too many time zone changes recorded to add another").
- **Daily goal**: what to count each day (reviews, new cards, minutes of flashcard study or another activity), the target, and whether to show the goal streak ([Daily goals](Daily-goals)).
- **What you already know** (per workspace): tell qinqin what you can already read so that you do not start from zero. Pick a level list (HSK, JLPT, ...), choose **Everything up to** a level and press **Mark as known**: after a confirmation, every word (or character, for a character list) of those levels that is not marked yet becomes known. Or press **Take the placement test**: a short quiz shows words or characters from different levels, you answer **I know it** or **Not sure** (only say yes if you can tell what it means), and it proposes a level; you can change that level and nothing is marked until you press **Mark as known** on the result. Known words are not underlined as new in the Reader, count in Stats and in the word coverage, and starter decks skip them. No flashcards are created, your reviews and the character map do not change, and a word you mark known and later add a card for is scheduled as a new card. Every declaration is listed below with an **Undo**, which removes exactly the marks it made (not marks you made yourself with **I know this**). A new workspace with no cards and no marks offers this on the home page (**Not now** hides the offer on this device). See also [Reader](Reader).
- **Level check** (experimental, per workspace): an estimate of how much of an HSK or JLPT level's vocabulary you cover. It estimates vocabulary and character knowledge only: it is **not** the official exam and does not cover listening, grammar or reading. Pick a level list and a level and press **Start the check**. The words of that level and the levels below it that you know (marked, or well reviewed) or are learning are counted from your own cards and marks; then you answer up to 20 questions, **I know it** or **Not sure**, about words you have not studied yet. The result shows how many entries are known, learning and not started, an estimate with a range, the estimate for each level, and the lowest level that is not covered yet with a **Study** button that starts a study session on it. The estimate leans on your own honesty (say yes only if you can tell what it means) and a small sample, so read it as a rough guide. Nothing is marked or changed; use **What you already know** to mark words.
- **Daily limits** and **Vacation** ([Decks, limits and vacation](Flashcards-decks-limits-vacation)).
- **Show my notes on the answer side** (per workspace, on by default): your personal notes on words below a revealed flashcard ([Flashcards: study sessions](Flashcards-study-sessions)).
- A link to Scheduling ([Scheduling and FSRS](Scheduling-and-FSRS)).

## Features

Switch **Decks** (flashcards), the **Reader**, the **Journal** or **Grammar** off for yourself. A switched-off feature's page, navigation link and widgets are hidden for you only; nothing is deleted, and reviews and reading time from another device still count in your stats and goals. Switch it back on at any time.

## Notifications

Opt-in study reminders (due cards, a goal not met, a streak at risk) by email, web push or, in the Android app, device notifications, with times and quiet hours. Everything is off until you turn it on. See [Reminders](Reminders).

## AI

Providers, keys and model per provider, the active provider, and this hour's usage ([Journal and AI providers](Journal-and-AI)). Administrators also register custom endpoints here.

## Account

**Language** → **Interface language**: the language of menus, buttons and messages, and of the mails the server sends you. "Browser default" follows your browser's language settings; choosing a language and pressing **Save language** stores it on the server for every device, and reloads the page. A browser that blocks site storage keeps its current language on that page until you reload; your other devices and the mails already use the new one. English is the only interface language today ([Translating qinqin](Translating-qinqin)). Chinese and Japanese study text keeps its own language whatever the interface language, so screen readers pronounce it and the hanzi and kanji font picks the right forms. Dates and numbers follow your device's region (an English interface without a region shows "16 Nov 2026").

Profile (your [profile picture](Accounts-and-sign-in#profile-picture), and email if the server asks for one), password, two-step sign-in, signed-in devices, access tokens for scripts ([API access tokens](API-Access-tokens)), "Your data" (export and restore, and a link to the lookup history), the app and offline section, and Delete account. See [Accounts and sign-in](Accounts-and-sign-in), [Your data](Your-data) and [Install as an app and study offline](Install-and-offline).

## Data (administrators)

The tab has two parts, **Packs** and **Languages**. Under Packs administrators install and remove packs: dictionaries, level lists, sentences, frequency lists, grammar lessons, audio, character components, stroke data, themes and fonts; under Languages they register or remove languages. Each pack shows its licence, its data package (revision, size, state, or the error of a failed build), and a theme pack its measured contrast. See [Data packs on the server](Admin-data-packs) ([Settings → Data](Admin-data-packs#settings--data-administrators), [Languages](Admin-data-packs#languages)).

Other users do not see this tab. What it changes reaches everyone: a new dictionary adds meanings to entries and lookups, a level list adds badges, level decks and the Level filters, a frequency list adds frequency chips, the frequency order and starter decks, a grammar pack adds lessons, a theme pack adds themes to Appearance, a font pack adds the faces of the Hanzi and kanji font. The **Sources** page (account menu) lists everything installed, with credits and licences, for every user.

**Data packages** are the downloadable form of the installed data, built by the server for native clients such as the planned Android app (`GET /api/packages`). The web app does not download them; it reads dictionaries from the server while online ([Install and offline](Install-and-offline)).

## Admin (administrators)

Sections Users, Invites, Email, Security and Backup (`/settings?tab=admin&section=users` and so on). See [Users, registration and invites](Admin-users-and-registration), [Email, two-step sign-in and security](Admin-email-and-security) and [Backup, recovery and the command line](Admin-backup-and-recovery).
