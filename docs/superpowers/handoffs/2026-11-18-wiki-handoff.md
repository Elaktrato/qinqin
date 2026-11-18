# Wiki handoff — 2026-11-18

Issue #80: the user, admin and API documentation as the repository's GitHub wiki, and a short README. All of it is
on `develop` (branch `docs/wiki`, merged `--no-ff`). Nothing went to `main`, no tag, no release.

**The wiki is not published yet.** This environment cannot push to `qinqin.wiki.git` (the session's git proxy
only authorises `Elaktrato/qinqin`, and the wiki repository cannot be attached). The wiki repository exists and
still holds only the placeholder `Home.md`. See §4 for the two ways to publish. Whether the `WIKI_TOKEN` secret
exists could not be checked from here (the Actions secrets API is blocked through this proxy).

## 1. What changed

- `docs/wiki/`: 47 files (44 pages plus `_Sidebar.md`, `_Footer.md` and the folder's `README.md`), every page
  brought in line with the code on `develop`, the README's long chapters folded in.
- New pages: Finding-your-way (the frame: icon bar, account menu, workspace flag/menu, phone drawer),
  Appearance-and-themes (Settings → Appearance, theme packs, the qinqin Day/Night/Deep house themes and the
  extras, interface font, hanzi/kanji font packs), Grammar-lessons, Admin-upgrading, Admin-data-packs (Settings →
  Data for admins, staged uploads, data packages, stroke data, font packs, local packs), Admin-AI-and-OCR,
  API-Reference, Dictionary-data-model, Development, Project-layout.
- `README.md`: 2,002 → 177 lines — what qinqin is, features, 3 screenshots plus 10 in a collapsed block, the Docker
  Compose quick start (with the first-start auto-seed), release images and versions, a Documentation section of
  about 30 wiki links, development in brief, licence and credits (`docs/sources.md` and the in-app Sources page stay
  the licence reference).
- `.github/workflows/wiki.yml`: publishes `docs/wiki` (without its `README.md`) to the wiki on pushes to `main`
  that change `docs/wiki`, and by **Run workflow** (`workflow_dispatch`). Uses the `WIKI_TOKEN` secret; without it
  the job prints a notice and succeeds without publishing.
- Texts outside the wiki that pointed at README sections now point at wiki pages: the in-app backup hint
  (`admin.backup.schedule`), `docs/contracts/auth/errors.json` and its README (regenerated `API-Errors.md`),
  `docs/sources.md`, `plugins/data/README.md`, the `docker-compose.yml` comments, `docs/git-flow.md` (automatic
  GitHub Release per `v*` tag, `wiki.yml`), `scripts/gen-api-docs.mjs` (API-Routes intro).
- Tests: new `apps/web/src/lib/readmeDocs.test.ts` (every README wiki link points at an existing `docs/wiki` page
  and heading, repository links resolve, the main pages are linked, README under 220 lines, the licence statement
  matches whether a LICENSE file exists); `wikiDocs.test.ts` now also checks `#anchors` of internal wiki links
  (shared helper `lib/testing/mdAnchors.ts`); `readmeGallery.test.ts` follows the smaller gallery; the Go
  `deploy_env_test.go` reads the "Server variables" table of `docs/wiki/Admin-environment-variables.md`.

## 2. What moved where (README chapter → wiki page)

| Old README chapter | Wiki page(s) |
|---|---|
| Features | every feature is on its page; themes → Appearance-and-themes; interface and study-text language → Settings-tour |
| Screenshots | kept in the README (the wiki has no images by convention) |
| Quick start; Release images and versions | Admin-deploying (quick start, the auto-seed, what `qinqin seed` does, release images, the GitHub Release per tag); the README keeps a short quick start |
| Deploying with Portainer (steps) | Admin-deploying; bootstrap admin also in Admin-environment-variables |
| Data directory | Admin-deploying; `packages/` in Admin-data-packs |
| Backup | Admin-backup-and-recovery; the personal part in Your-data |
| Upgrading (and migration notes) | Admin-upgrading |
| Reverse proxy and HTTPS; Sign-in throttling | Admin-proxy-and-rate-limiting |
| Accounts and sign-in | user side: Accounts-and-sign-in, Getting-started; admin side: Admin-users-and-registration, Admin-email-and-security |
| AI journal (admin), Journal and AI, Custom AI endpoints, Photo routes, Offline OCR, Server secret | Journal-and-AI (users) and Admin-AI-and-OCR (admins); routes in API-Reference; variables in Admin-environment-variables |
| Checklist after deploying | Admin-deploying |
| Troubleshooting | Troubleshooting |
| Workspaces | Workspaces-and-languages; the frame, navigation and old addresses in Finding-your-way |
| Reader; Reader display | Reader |
| Study day and time zone | Settings-tour (Study) |
| Vacation mode and daily limits | Flashcards-decks-limits-vacation |
| Install as an app and study offline | Install-and-offline |
| Studying | Flashcards-study-sessions (cards, sessions, XP, mascot); Flashcards-decks-limits-vacation (decks, level decks); Stats-and-heatmap (character map, widgets) |
| Studying → API | API-Reference (route table, body limits); token notes in API-Access-tokens |
| Studying → Operations | Admin-email-and-security ("Outbound requests") |
| Studying → Feature plugins; Extending: plugin pages | Plugin-format (incl. widget ids and plugin pages) |
| Studying → Credits and the Sources page | Data-and-licences |
| Dictionary data model | Dictionary-data-model |
| Frequency data | Dictionary-data-model (ranking), Data-pack-format (format), Data-and-licences (local-only) |
| Bundled data | Data-and-licences (full table), Admin-data-packs (stroke data) |
| Development; Project layout; Branches | Development, Project-layout ("Branches and releases" in Development; `docs/git-flow.md` stays) |

A fact-by-fact inventory (57 rows, 318 grep checks) was made before the README was cut; an independent review then
compared the old README section by section with the wiki and found three missing facts (`adduser` reads
`QINQIN_PASSWORD`, the `POST /api/workspaces` language rules, `routeAccess.ts`), all added.

## 3. Rewritten because out of date (checked against the code)

- **Statements dropped as untrue:** "Add to study" (the button is **Add to deck**); UTC days for the XP bonus,
  streaks, the reading-time windows and the reader's daily suggestions (they are learner days); "seven widgets"
  (nine); the home default "Activity, then Flashcards" (also the daily goal and this week); the reader font
  "system fonts only" (app setting plus Sans/Serif/Kai from font packs); `ACTIVITY_SOURCES` (no such constant);
  `GET /api/languages` without `kind`; "the package is private" for this project's image (it is public; the note now
  applies to forks); the missing-secret error (the secret is optional); the old compose path
  `deploy/portainer-stack.yml` (one `docker-compose.yml` now); the health-check start period (300 s, not 15 s).
- **Frame and pages:** Search first in the icon bar; the theme drill-in in the account menu; the reader's import is
  the "browse public-domain texts" link (no Sources button); the character map uses one hue; the interface font is
  Figtree.
- **Server:** default pack roots include `plugins/data-audio` and `plugins/data-strokes`; the image's `QINQIN_PACKS`;
  the first-start auto-seed (`QINQIN_AUTO_SEED`, merged from develop during this run); the bootstrap admin; the
  automatic GitHub Release; limits taken from the code (staged uploads, zip limits, every named rate limit); the
  server backup does not include `/data/fonts`; `QINQIN_SECRET` also seals authenticator secrets and the mail
  password.
- **Missing routes** added to API-Reference (admin packs, staged uploads, languages, SMTP, grammar, sentence packs,
  entry bases, interface language, lookup deletion, account two-step and email routes, email-code sign-in, reset
  request, admin two-step reset).

## 4. How publishing works now — what you must do

`wiki.yml` copies `docs/wiki` into the wiki repository and pushes. Two facts decide how you publish the first time:

1. **Token.** Add the repository secret `WIKI_TOKEN` (Settings → Secrets and variables → Actions). The dependable
   choice is a **classic** personal access token with the `public_repo` scope; fine-grained tokens and GitHub App
   installation tokens are reported to be refused by the wiki remote (not verified here). If you created a
   fine-grained token and the run fails at `git clone`/`git push`, replace it with a classic one.
2. **Run workflow needs the file on `main`.** GitHub only offers "Run workflow" for workflows on the default branch.
   Until `wiki.yml` reaches `main` (your next release), publish once by hand:

```sh
git clone https://github.com/Elaktrato/qinqin.git /tmp/qinqin-src
cd /tmp/qinqin-src && git checkout develop
git clone https://github.com/Elaktrato/qinqin.wiki.git /tmp/qinqin-wiki
rsync -a --delete --exclude .git --exclude README.md docs/wiki/ /tmp/qinqin-wiki/
cd /tmp/qinqin-wiki
git add -A && git commit -m "docs: publish the wiki from docs/wiki (develop)" && git push
```

   After that, every merge to `main` that touches `docs/wiki` republishes, and "Run workflow" works from any branch.

Then check the wiki: https://github.com/Elaktrato/qinqin/wiki — Home, the sidebar on every page, and a few links
(the link and anchor checks run in the tests, but the live rendering was not seen from here). The footer says the
wiki describes the branch it was published from (normally `main`); a manual publish from `develop` describes
`develop` until the next release.

Close #80 once the wiki is live.

## 5. Not verified

- The live wiki (not published from here), how GitHub renders the anchors (the tests use a copy of GitHub's anchor
  rule), and the token types (above).
- Nothing was seen in a browser; the pages describe the UI from the code and the English catalogue.
- No server was run for the docs; the facts were checked by reading code and running the existing tests.
- Some statements come only from the old README where the code was not traced: a link from an administrator lasting
  24 hours by default, and the same user starting with an empty offline copy after signing in again.

## 6. Gates

On the merged branch: `npm run check` 0 errors; `npm run build` exit 0; full vitest under Node 26: 12,054 passed,
2 skipped; `node scripts/gen-api-docs.mjs --check` and `node --test scripts/*.test.mjs` exit 0; Go `./cmd/...` and
`./internal/api` pass. (Under this machine's Node 22, five DOM tests in `AccountSettings.dom` and `BookView.dom`
fail on the base commit as well; they pass under Node 26, which CI uses. Four build-output tests need a fresh
`npm run build` first.)
