# qinqin wiki

qinqin (勤勤, pronounced qínqín) is a self-hosted platform for studying Chinese and Japanese: dictionary lookup, character readings and stroke order, flashcards scheduled with FSRS, a Reader for books, a Journal with optional AI review, and statistics. It is one small Docker stack: a Go server with a SQLite database and an embedded web app.

This wiki has four parts. Pick the one that matches why you are here.

## Using qinqin

- [Getting started](Getting-started): first sign-in, the home page, the main areas.
- [Workspaces and languages](Workspaces-and-languages)
- [Searching and entries](Searching-and-entries)
- [Flashcards: study sessions](Flashcards-study-sessions), [Decks, limits and vacation](Flashcards-decks-limits-vacation), [Daily goals](Daily-goals), [Scheduling and the FSRS optimizer](Scheduling-and-FSRS)
- [Reader](Reader)
- [Journal and AI providers](Journal-and-AI)
- [Stats and the activity heatmap](Stats-and-heatmap), [Weekly summary](Weekly-summary)
- [Settings tour](Settings-tour)
- [Accounts and sign-in](Accounts-and-sign-in)
- [Your data: export and restore](Your-data)
- [Install as an app and study offline](Install-and-offline)

## Running a server

- [Deploying with Docker or Portainer](Admin-deploying)
- [Environment variables](Admin-environment-variables)
- [Users, registration and invites](Admin-users-and-registration)
- [Email, two-step sign-in and security](Admin-email-and-security)
- [Reverse proxy, rate limiting and trusted proxies](Admin-proxy-and-rate-limiting)
- [Backup, recovery and the command line](Admin-backup-and-recovery)

## Building a client

- [API overview](API-Overview): sessions, restrictions, conventions.
- [API routes](API-Routes) and [API errors](API-Errors): both generated from the code.
- [Plugin data API](Plugin-data-api), [Plugin format](Plugin-format) and [Data pack format](Data-pack-format).

## Reference

- [Data and licences](Data-and-licences)
- [Troubleshooting](Troubleshooting)
- [FAQ](FAQ)

## About this documentation

The wiki is generated from the folder `docs/wiki/` of the repository and is published from there (see `docs/wiki/README.md`). Edit the files in the repository, not on the wiki. When a page and the program disagree, the program is right: please open an issue. Features that the developers have not been able to check on real devices or with real accounts are marked as such on their pages.
