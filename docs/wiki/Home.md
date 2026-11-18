# qinqin wiki

qinqin (勤勤, pronounced qínqín) is a self-hosted platform for studying Chinese and Japanese: dictionary lookup, character readings and stroke order, flashcards scheduled with FSRS, a Reader for books, short grammar lessons, a Journal with optional AI review, statistics, and themes of your choice. It is one small Docker stack: a Go server with a SQLite database and an embedded web app.

This wiki has five parts. Pick the one that matches why you are here.

## Using qinqin

- [Getting started](Getting-started): your account, the first sign-in, a first ten minutes.
- [Finding your way](Finding-your-way): the top bar, the phone menu, the workspace and account menus, the home page.
- [Workspaces and languages](Workspaces-and-languages)
- [Searching and entries](Searching-and-entries): search, radical and part lookup, entries, notes, lookup history.
- [Flashcards: study sessions](Flashcards-study-sessions), [Decks, limits and vacation](Flashcards-decks-limits-vacation), [Daily goals](Daily-goals), [Scheduling and the FSRS optimizer](Scheduling-and-FSRS)
- [Reader](Reader) and [Grammar lessons](Grammar-lessons)
- [Journal and AI providers](Journal-and-AI)
- [Stats and the activity heatmap](Stats-and-heatmap), [Weekly summary](Weekly-summary), [Milestones](Milestones)
- [Settings tour](Settings-tour) and [Appearance and themes](Appearance-and-themes): colour themes, accent, corners, spacing and the hanzi font.
- [Accounts and sign-in](Accounts-and-sign-in)
- [Your data: export and restore](Your-data)
- [Install as an app and study offline](Install-and-offline)

## Running a server

- [Deploying with Docker or Portainer](Admin-deploying)
- [Upgrading](Admin-upgrading): the routine, log lines after an upgrade, notes per release.
- [Environment variables](Admin-environment-variables)
- [Users, registration and invites](Admin-users-and-registration)
- [Email, two-step sign-in and security](Admin-email-and-security)
- [Reverse proxy, rate limiting and trusted proxies](Admin-proxy-and-rate-limiting)
- [Backup, recovery and the command line](Admin-backup-and-recovery)
- [Data packs on the server](Admin-data-packs): installing and removing packs, data packages, languages.
- [AI providers and offline OCR](Admin-AI-and-OCR): `QINQIN_SECRET`, allowed providers, custom endpoints, Tesseract.

## Building a client

- [API overview](API-Overview): sessions, restrictions, conventions.
- [API reference](API-Reference): every route with its rules, by area.
- [API routes](API-Routes) and [API errors](API-Errors): both generated from the code.
- [API access tokens](API-Access-tokens) for scripts and other clients.
- [Plugin data API](Plugin-data-api), [Plugin format](Plugin-format) and [Data pack format](Data-pack-format).

## Reference

- [Data and licences](Data-and-licences)
- [Dictionary data model](Dictionary-data-model): entries, forms, readings, senses, frequency and components.
- [Troubleshooting](Troubleshooting)
- [FAQ](FAQ)

## Developing

- [Development](Development): running from a checkout, the gates, how the build fits together.
- [Project layout](Project-layout): what lives where in the repository.
- [Translating qinqin](Translating-qinqin): the interface catalogue and how a language is added.

## About this documentation

The wiki is generated from the folder `docs/wiki/` of the repository and is published from there (see `docs/wiki/README.md`). Edit the files in the repository, not on the wiki. When a page and the program disagree, the program is right: please open an issue. Features that the developers have not been able to check on real devices or with real accounts are marked as such on their pages.
