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

The first start on an empty data directory creates the administrator `admin` and prints its password once (`bootstrap: initial password (shown once, never again): ...`); sign in with it and choose your own. `QINQIN_BOOTSTRAP_ADMIN=you go run ./cmd/qinqin` picks the name instead (add `QINQIN_BOOTSTRAP_PASSWORD` to choose the password too). To create the admin yourself, start with `QINQIN_BOOTSTRAP_ADMIN=off` and run `go run ./cmd/qinqin adduser --admin --username you` (without `off`, `adduser` adds a second administrator). See [Deploying](Admin-deploying#the-bootstrap-administrator).

The demo and local packs, in a second terminal:

```sh
cd server
go run ./cmd/qinqin seed --packs ../plugins/data
```

Japanese stroke order (and the kana Write mode) needs `scripts/fetch-kanjivg-strokes.sh` (git and Node; it writes `plugins/data-strokes/kanjivg-strokes`). Stroke animations need the stroke pack, which is not committed: `npm --prefix apps/web ci`, then `node scripts/prepare-strokes-pack.mjs --out plugins/data-strokes/hanzi-writer-strokes`, and seed with `--packs ../plugins/data,../plugins/data-strokes` (from `server/`; without `--packs`, run from the repository root, `seed` picks up `plugins/data-strokes`, `plugins/data-audio` and `plugins/data-local` when they exist).

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
- Repository checks, in `apps/web/tests/repo/` (the docs, the README, the wiki, the shipped licence texts, the bundle size, the web folder rules of [record 0004](https://github.com/Elaktrato/qinqin/blob/develop/docs/architecture/0004-web-folder-rules.md) in `folderRules.test.ts`; `npm test` runs them with the unit tests): `cd apps/web && npx vitest run tests/repo/` and `node scripts/gen-api-docs.mjs --check` (every wiki page is in `_Sidebar.md`, every link resolves, the generated API pages are current; every wiki link in `README.md` points at an existing `docs/wiki` page and heading; every architecture record follows the template of `docs/architecture/README.md` and is in its index).
- Test helpers ([record 0005](https://github.com/Elaktrato/qinqin/blob/develop/docs/architecture/0005-test-conventions.md)): a Go test takes its database from `dbtest.Open(t)` (`server/internal/dbtest`; `OpenPath` also returns the file, `File` writes one where the code under test opens it), a copy of a template migrated once per test process; `dbtest.User`, `dbtest.Workspace` and `dbtest.DictPack` are the shared fixtures, and `dbtest.Counting` counts the SQL statements of a performance test. The api tests hash passwords at a lowered argon2id cost (`auth.SetHashCostForTests` in their `TestMain`). Web state lives in one app context per tab and one session per signed-in session ([record 0009](https://github.com/Elaktrato/qinqin/blob/develop/docs/architecture/0009-web-state-model.md), `apps/web/src/lib/context/`): components read it with `useApp()` / `useSession()`, and a web test builds a fresh context from fakes with `apps/web/src/lib/testing/context.ts` (`testContext()`, then `render(Component, { props, context: ctx.context })`); there are no global resets, and `stateModel.lint.test.ts` fails on a `svelte/store` import, an exported `…ForTests` or module-level state outside its allow-list. Web tests build cards, reviews and histories with `apps/web/src/lib/testing/study.ts`; the other test support (the legacy codec mirror, fake caches, DOM setup, a fake study server `studyServer.ts` that counts the requests a read or a write costs, wire keyed rows `keyed.ts`) is in `apps/web/src/lib/testing/` too. No unit test asserts a wall-clock time: performance tests count operations, and a guard test (`noWallClock.test.ts`) fails on a measured duration.
- Concurrent builds in one worktree clobber `.svelte-kit`.

## Browser end-to-end tests

A Playwright suite in `apps/web/e2e/` drives Chromium against the real binary with the built SPA embedded
([record 0007](https://github.com/Elaktrato/qinqin/blob/develop/docs/architecture/0007-browser-end-to-end-tests.md)).
It needs Go and Node, and `npm --prefix apps/web ci` once:

```sh
cd apps/web
npx playwright install chromium   # once per Playwright version; CI adds --with-deps
npm run e2e                        # builds the SPA and the binary, then runs the suite
npm run e2e -- study               # one spec file
npm run e2e -- --headed --debug    # watch and step through
```

- The global setup runs `npm run build`, copies `server/` to a scratch directory, embeds `apps/web/build` and
  runs `go build` (your checkout is not modified), then seeds a template data directory from the tiny packs in
  `apps/web/e2e/fixtures/packs` and adds an admin. The tests take about 20 s with 2 workers; the web build and
  the first Go build add to that. `QINQIN_E2E_REUSE_BUILD=1` reuses the existing `apps/web/build` instead of
  building it (CI sets it after its own web build); `QINQIN_E2E_BINARY=/path/to/qinqin` skips both builds and
  runs that binary (a build with a deliberate mutation, for example).
- Each worker runs its own server on a free loopback port over a copy of the template, with
  `QINQIN_AUTO_SEED=0` and no mail or other network; the AI is the fake provider (`QINQIN_AI_PROVIDER=fake` with a
  throw-away `QINQIN_SECRET`), which never leaves the server. Each test signs in as a new user of its own.
- A browser other than the one the pinned `@playwright/test` version installs:
  `QINQIN_E2E_CHROMIUM=/path/to/chrome npm run e2e`.
- On a failure the trace, screenshot and video are kept in `apps/web/e2e/test-results/` (open a trace with
  `npx playwright show-trace <file>`), with each worker's server log (`server-w<N>.log`). `--trace off` skips
  the traces locally.
- The rules: role and text locators, no fixed sleeps (wait for a condition), no retries, data written through
  the API, no network but the local server (a request to any other host fails the test);
  `tests/conventions.spec.ts` checks the sleeps and the retries. `npm run check` type-checks the suite.
- A failure's trace holds the learner's session token and, in the sign-in tests, the password typed: they
  belong to the throw-away instance and die with it, but do not reuse those names or passwords anywhere.

Covered: signing in and out (and a wrong password); registration in open mode; search and adding a word to
study; switching the workspace; a study session mixing two card types (#132) and changing grades with Z and
Back (#131), with the reviews the server stores; the reader popup on hover (desktop; the longest match first,
no stale lookup) and from a selection (phone sheet), and on a phone a long entry in a sheet capped at 60 % of the screen that scrolls
inside, with the word above it; offline study after the service worker cached the app and
today's cards (a deck's reverse cards included), and the sync of each review exactly once, with its grade and
grading time, when back online and after a reload; the phone bottom bar at 360 px (on the bottom edge while a
long page scrolls), More, and the side menu option of Settings → Layout, kept for the account, and back; a
journal conversation with the fake AI partner (its opening, the lookup popup on a reply, corrections in the
margin, saving it as an entry); AI example sentences on an entry with the fake provider (generating them, the
one without the word left out, keeping one, reporting one, the AI-written mark after a reload).

Not covered, still checked by hand: Firefox and Safari (WebKit), real phones and the installed app (install
prompt, home-screen app, safe areas, the on-screen keyboard), the update bar after a new version, the stroke
animations, writing, tone, sentence and cloze cards, Japanese deinflection in the reader (the fixture has no
rule-table pack), audio, the journal, grammar lessons, Settings → Admin (users, packs, backup) and the account
backup download, two-step sign-in and email, and anything that looks wrong without failing (layout, colours,
themes).

## How the build fits together

`npm --prefix apps/web run build` writes the SPA to `apps/web/build`; the Dockerfile copies that directory into the Go binary (`//go:embed` in `server/internal/webdist`) before compiling. The build also writes `build/service-worker.js` (hand-written, no Workbox; the logic lives in `apps/web/src/lib/pwa/sw/`; its version is `QINQIN_BUILD_ID` or the git hash plus the build time). The app icons are generated by `node apps/web/scripts/make-icons.mjs` and committed. Set the version, commit and build date the binary reports (`GET /api/version`, the text sources' user agent) with `go build -ldflags "-X main.version=1.2.3 -X main.commit=<sha> -X main.buildDate=<RFC 3339>" ./cmd/qinqin` (default `dev`; without the flags commit and date come from the Go VCS stamps when present). The Dockerfile takes them as `ARG VERSION`, `COMMIT`, `BUILD_DATE`; the image job passes the tag without its `v` (`dev` for a build that is not a tag), `github.sha` and the commit date in UTC. The release check reads the GitHub Releases the `release` job creates, so a tag must parse as a semantic version (`v0.7.0`, `v0.7.0-rc1`); the image job fails on a `v*` tag that does not (it would otherwise report `dev`). The Dockerfile quotes each `-X` value, so a value with spaces survives.

The Dockerfile has six stages: `web` (the SPA and the stroke pack), `build` (the static Go binary), `images` (the picture packs), `kanjivg` (the Japanese stroke pack; `--build-arg WITH_KANJIVG=0` skips it), `audio` (the Kanji alive pack; `--build-arg WITH_AUDIO=0` skips it, and `KANJIALIVE_*` build arguments override the pins in `scripts/fetch-audio-kanjialive.sh`) and the Alpine runtime (Tesseract unless `--build-arg WITH_OCR=0`; Alpine, not scratch, because the healthcheck needs `wget`). The image has no `USER`, sets `QINQIN_DATA=/data` and `QINQIN_PACKS`, and runs `qinqin serve`.

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

## When you add a feature or a language

There are no plugins ([record 0006](https://github.com/Elaktrato/qinqin/blob/develop/docs/architecture/0006-core-features-instead-of-code-plugins.md)).
A feature is core code with a switch: its id in `server/internal/features/features.go` (the only list the server
checks; `feature_switches` has no list of ids since migration 055), `docs/contracts/features/switches.json` and
`apps/web/src/lib/features/index.ts`;
its data gets typed storage in its own package with a contract. Content is a data pack
([Data pack format](Data-pack-format)).

Web code goes in the folder of its owner ([record 0004](https://github.com/Elaktrato/qinqin/blob/develop/docs/architecture/0004-web-folder-rules.md),
[Project layout](Project-layout)): a feature's components and logic in its feature folder, generic building
blocks in `apps/web/src/lib/ui/`, a widget in `apps/web/src/lib/components/` only once a second feature uses
it, no component in a logic folder and nothing loose at the top of `lib/`. A new route folder names its
feature in `ROUTE_FEATURES` (`apps/web/tests/repo/folderRules.ts`); `folderRules.test.ts` checks the rest.

A language is a profile: a row in `docs/contracts/languages/profiles.json` and the same row in
`server/internal/lang/profile.go` and `apps/web/src/lib/languages/profiles.ts`, then its data packs, and reading
code only when the profile names something new (`docs/contracts/languages/README.md`, "How to add a language").
Availability checks ask the profile (`docs/contracts/languages/README.md` says which member decides what), not `language === 'zh'`; what remains language code is reading code (pinyin, kana, fonts, audio, the online-library sources) and the Chinese-only data notes.

## CI

`.github/workflows/build.yml` runs on pushes to `main` and `develop`, on `v*` tags and on pull requests into `main` and `develop`:

1. **test**: source and script checks (`check-sources.mjs`, `node --test scripts/*.test.mjs`), the seed archive check (`scripts/check-archives.sh`), web check and tests, the font pack script test, `go vet` and `go test` with Tesseract installed and `QINQIN_REQUIRE_TESSERACT=1`, the web build, and the embed smoke test (`scripts/smoke-embed.sh`: the real binary with the real SPA, asserted through HTTP).
2. **e2e** (beside `test`): installs Chromium (cached per Playwright version; its system libraries every run),
   builds the web app and runs the browser end-to-end suite
   (`npm run e2e`; above). On a failure the traces, screenshots, videos, the HTML report and the server logs
   are uploaded as the `e2e-failure` artifact, kept 7 days.
3. **image** (pushes to `main` and `v*` tags only, after `test` and `e2e`): builds and pushes `ghcr.io/elaktrato/qinqin` with the tags `latest` (from `main`), the version tag and `sha-<commit>`. A release tag that is not semver fails here.
4. **release** (`v*` tags only, after the image): creates the GitHub Release `qinqin <tag>` as a **draft**, with `docs/releases/<tag>.md` as its text when that file exists and GitHub's generated notes otherwise. A tag with a hyphen becomes a pre-release. A re-run for a tag that already has a release changes nothing.

The Android APK is **not built or signed in CI**. The owner builds it on their own machine with `apps/android/scripts/release-local.sh <tag>`, uploads it to the draft release and publishes it ([release checklist](https://github.com/Elaktrato/qinqin/blob/develop/docs/release-checklist.md)); the keystore never leaves that machine and GitHub holds no signing secret. Pull requests that touch the shell still run the emulator workflow (`android-emulator.yml`).

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

## Android app

`apps/android` is a Capacitor project (the shell, [record 0010](https://github.com/Elaktrato/qinqin/blob/develop/docs/architecture/0010-android-shell-and-native-bridge.md)). It needs Node, JDK 21 and the Android SDK (platform 36, build-tools 36; `ANDROID_HOME` set, licences accepted). Gradle comes with the project (`./gradlew`).

```sh
cd apps/android
npm ci
npm test                 # address and verification rules, first-run screen (vitest)
npm run check            # tsc
npm run assemble         # builds the first-run screen, cap sync, ./gradlew assembleDebug
# the APK: android/app/build/outputs/apk/debug/app-debug.apk
cd android && ./gradlew --no-daemon testDebugUnitTest   # JVM tests
```

Android Studio opens `apps/android/android`. The package id and the launcher name are in `apps/android/identity.json` (a placeholder until the owner confirms them); a local build's version is `apps/android/package.json`'s with versionCode 1; a release build takes both from the tag. Signing keys are never in the repository or in GitHub: the owner signs on their own machine with `apps/android/scripts/release-local.sh vX.Y.Z` (needs `JAVA_HOME`, `ANDROID_HOME`, a local keystore given by `QINQIN_KEYSTORE_FILE` and `QINQIN_KEY_ALIAS`; it asks for the passwords; the script's header explains everything), which writes `dist/qinqin-<version>.apk` and its `.sha256` ([Android](Android#install)).
