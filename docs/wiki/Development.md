# Development

Working on qinqin itself: running it from a checkout, the checks CI runs, branches and releases. The repository layout is on [Project layout](Project-layout).

## Prerequisites

Go 1.26 or newer (the `modernc.org/sqlite` floor; pure Go, no CGO) and Node.js 24 or newer (CI uses Node 26). Optional: `tesseract` with its language models for offline photo reading, `python3` for `scripts/smtp-sink.py` and the Jiten conversion.

## Running from a checkout

Run the API; it also serves the embedded web app when one has been built:

```sh
cd server
go run ./cmd/qinqin
```

First seed and an admin user, in a second terminal:

```sh
cd server
go run ./cmd/qinqin seed --packs ../plugins/data
go run ./cmd/qinqin adduser --admin --username you
```

Stroke animations need the stroke pack, which is not committed: `npm --prefix apps/web ci`, then `node scripts/prepare-strokes-pack.mjs --out plugins/data-strokes/hanzi-writer-strokes`, and seed with `--packs ../plugins/data,../plugins/data-strokes` (from `server/`; without `--packs`, run from the repository root, `seed` picks up `plugins/data-strokes`, `plugins/data-audio` and `plugins/data-local` when they exist).

To work on the web app, start its hot-reload dev server in another terminal; Vite proxies `/api` to the Go server on `127.0.0.1:8080`:

```sh
npm --prefix apps/web install
npm --prefix apps/web run dev
```

Mail: `python3 scripts/smtp-sink.py --port 2525 --dir ./mail` ([Email, two-step sign-in and security](Admin-email-and-security)). AI without a key: `QINQIN_AI_PROVIDER=fake` (a deterministic test provider that never leaves the server). Without `tesseract` offline OCR shows as unavailable, which is normal.

## Gates

```sh
npm --prefix apps/web run check
npm --prefix apps/web test
npm --prefix apps/web run build
cd server && go vet ./... && go test ./...
node scripts/check-sources.mjs && node --test scripts/*.test.mjs
npm --prefix apps/web run e2e
```

- A slow opt-in test seeds the real bundled packs and checks lookups against them: `QINQIN_REAL_DATA_TESTS=1 go test ./cmd/qinqin -run RealPacks -v` (from `server/`). Other test-only switches: `QINQIN_REQUIRE_TESSERACT=1` (the OCR test fails instead of skipping when the binary is missing; CI sets it), `QINQIN_BIG_TESTS`, `QINQIN_PERF_BUDGET_MS`.
- Doc checks: `cd apps/web && npx vitest run src/lib/wikiDocs.test.ts src/lib/contractsDocs.test.ts src/lib/readmeGallery.test.ts src/lib/readmeDocs.test.ts src/lib/architectureDocs.test.ts` and `node scripts/gen-api-docs.mjs --check` (every wiki page is in `_Sidebar.md`, every link resolves, the generated API pages are current; every wiki link in `README.md` points at an existing `docs/wiki` page and heading; every architecture record follows the template of `docs/architecture/README.md` and is in its index).
- Timing tests (icons, weekly and milestone performance, schedule timeline, reader readings) can fail on a loaded machine and pass alone. Concurrent builds in one worktree clobber `.svelte-kit`.

## Browser end-to-end tests

A Playwright suite in `apps/web/e2e/` drives Chromium against the real binary with the built SPA embedded
([record 0007](https://github.com/Elaktrato/qinqin/blob/develop/docs/architecture/0007-browser-end-to-end-tests.md)).
It needs Go and Node, and `npm --prefix apps/web ci` once:

```sh
cd apps/web
npx playwright install chromium   # once per Playwright version; CI adds --with-deps
npm run build                      # the SPA the binary embeds (built when missing)
npm run e2e                        # about 15 s with 2 workers after the first Go build
npm run e2e -- study               # one spec file
npm run e2e -- --headed --debug    # watch and step through
```

- The global setup copies `server/` to a scratch directory, embeds `apps/web/build` and runs `go build` (your
  checkout is not modified), then seeds a template data directory from the tiny packs in
  `apps/web/e2e/fixtures/packs` and adds an admin. `QINQIN_E2E_BINARY=/path/to/qinqin` skips the build. Run
  `npm run build` again after changing the web app: the suite tests what is in `apps/web/build`.
- Each worker runs its own server on a free loopback port over a copy of the template, with
  `QINQIN_AUTO_SEED=0` and no AI, mail or other network; each test signs in as a new user of its own.
- A browser other than the one the pinned `@playwright/test` version installs:
  `QINQIN_E2E_CHROMIUM=/path/to/chrome npm run e2e`.
- On a failure the trace, screenshot and video are kept in `apps/web/e2e/test-results/` (open a trace with
  `npx playwright show-trace <file>`), with each worker's server log (`server-w<N>.log`). `--trace off` skips
  the traces locally.
- The rules: role and text locators, no fixed sleeps (wait for a condition), no retries, data written through
  the API; `tests/conventions.spec.ts` checks the first two. `npm run check` type-checks the suite.

Covered: signing in and out (and a wrong password); registration in open mode; search and adding a word to
study; switching the workspace; a study session mixing two card types (#132) and changing grades with Z and
Back (#131), with the reviews the server stores; the reader popup on hover (desktop) and from a selection
(phone sheet); offline study after the service worker cached the app and today's cards, and the sync of each
review exactly once when back online and after a reload; the phone bottom bar at 360 px, More, and the side
menu option of Settings → Layout and back.

Not covered, still checked by hand: Firefox and Safari (WebKit), real phones and the installed app (install
prompt, home-screen app, safe areas, the on-screen keyboard), the update bar after a new version, the stroke
animations, writing, tone, sentence and cloze cards, Japanese deinflection in the reader (the fixture has no
rule-table pack), audio, the journal, grammar lessons, Settings → Admin (users, packs, backup) and the account
backup download, two-step sign-in and email, and anything that looks wrong without failing (layout, colours,
themes).

## How the build fits together

`npm --prefix apps/web run build` writes the SPA to `apps/web/build`; the Dockerfile copies that directory into the Go binary (`//go:embed` in `server/internal/webdist`) before compiling. The build also writes `build/service-worker.js` (hand-written, no Workbox; the logic lives in `apps/web/src/lib/pwa/sw/`; its version is `QINQIN_BUILD_ID` or the git hash plus the build time). The app icons are generated by `node apps/web/scripts/make-icons.mjs` and committed. Set the version the binary reports to the text sources with `go build -ldflags "-X main.version=1.2.3" ./cmd/qinqin` (default `dev`).

The Dockerfile has four stages: `web` (the SPA and the stroke pack), `build` (the static Go binary), `audio` (the Kanji alive pack; `--build-arg WITH_AUDIO=0` skips it, and `KANJIALIVE_*` build arguments override the pins in `scripts/fetch-audio-kanjialive.sh`) and the Alpine runtime (Tesseract unless `--build-arg WITH_OCR=0`; Alpine, not scratch, because the healthcheck needs `wget`). The image has no `USER`, sets `QINQIN_DATA=/data` and `QINQIN_PACKS`, and runs `qinqin serve`.

**Mascot art.** The flashcards mascot looks for `/mascot/<stage>-<mood>.svg` (stages 1 to 4, moods `sleepy`, `happy`, `proud`, `cheering`) and draws a built-in placeholder when the file is missing. No art is bundled; a build that adds the files under `apps/web/static/mascot/` shows them (the files are embedded in the binary, so they cannot be dropped into a running container).

## Architecture records

The rules of the code's structure (what the API layer may do, where web code lives, how errors are answered and
shown, how unreadable sync rows are handled, test conventions, browser end-to-end tests, core features instead
of code plugins) are
written down as architecture records in [`docs/architecture/`](https://github.com/Elaktrato/qinqin/tree/develop/docs/architecture),
each with how it is enforced. The data rules every client shares are the contracts in `docs/contracts/`. Read
the record before changing the structure it covers; an issue that changes a rule updates its record.

## When you add a route

1. Register it in the route table in `server/internal/api/api.go` with its access class and token rule.
2. Regenerate the route fixture: `UPDATE_ROUTES_FIXTURE=1 go test -run RoutesFixture ./internal/api/` (from `server/`); for token rules `UPDATE_TOKEN_ROUTES_FIXTURE=1 go test -run TokenRoutesFixture ./internal/api/` (it writes `docs/contracts/auth/tokens-routes.json`).
3. Decide in `apps/web/src/lib/pwa/sw/classify.ts` whether the service worker may cache it offline (default: no).
4. Run `node scripts/gen-api-docs.mjs` to refresh [API routes](API-Routes) and [API errors](API-Errors), and describe the route on [API reference](API-Reference). A new error code goes into `docs/contracts/auth/errors.json` and gets an `apiError.<code>` key in the catalogue.

## CI

`.github/workflows/build.yml` runs on pushes to `main` and `develop`, on `v*` tags and on pull requests into `main` and `develop`:

1. **test**: source and script checks (`check-sources.mjs`, `node --test scripts/*.test.mjs`), the seed archive check (`scripts/check-archives.sh`), web check and tests, the font pack script test, `go vet` and `go test` with Tesseract installed and `QINQIN_REQUIRE_TESSERACT=1`, the web build, and the embed smoke test (`scripts/smoke-embed.sh`: the real binary with the real SPA, asserted through HTTP).
2. **e2e** (beside `test`): installs Chromium, builds the web app and runs the browser end-to-end suite
   (`npm run e2e`; above). On a failure the traces, screenshots, videos, the HTML report and the server logs
   are uploaded as the `e2e-failure` artifact, kept 7 days.
3. **image** (pushes to `main` and `v*` tags only, after `test` and `e2e`): builds and pushes `ghcr.io/elaktrato/qinqin` with the tags `latest` (from `main`), the version tag and `sha-<commit>`.
4. **release** (`v*` tags only, after the image): creates the GitHub Release `qinqin <tag>`, with `docs/releases/<tag>.md` as its text when that file exists and GitHub's generated notes otherwise; a tag with a hyphen becomes a pre-release, and a re-run for a tag that already has a release does nothing.

`.github/workflows/audio-stage.yml` builds only the Dockerfile's `audio` stage on pull requests that touch the Dockerfile, `.github/` or the audio scripts, weekly, and by hand, so a broken pin or an unreachable `media.kanjialive.com` shows before release day.

`.github/workflows/wiki.yml` publishes `docs/wiki/` to the GitHub wiki on pushes to `main` that change `docs/wiki/`, and by hand from any branch (Run workflow). It needs the repository secret `WIKI_TOKEN`; without it the job prints a notice and succeeds without publishing (`docs/wiki/README.md`).

## Branches and releases

The repository follows git-flow (`docs/git-flow.md`):

| Branch | Purpose |
|---|---|
| `main` | Production. Every commit is a released state, tagged `vX.Y.Z`. Never committed to directly |
| `develop` | Integration. Finished features land here |
| `feature/<name>` | One feature or change, from `develop` back into `develop` |
| `release/<version>` | Release stabilisation, from `develop` into `main` (plus the tag) and back into `develop` |
| `hotfix/<version>` | An emergency fix, from `main` into `main` (plus the tag) and back into `develop` |

Pull requests are merged with merge commits only (no squash or rebase), so git-flow's merge topology stays intact. Before tagging, walk through `docs/release-checklist.md` in a real browser and write `docs/releases/<tag>.md`; pushing the tag then publishes the image and the GitHub Release.

## The wiki

These pages are generated from `docs/wiki/` in the repository; edit them there, never on the wiki (`docs/wiki/README.md` explains publishing).
