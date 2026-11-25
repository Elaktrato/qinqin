# Release checklist

Two parts: the **server and image** (browser walk-through) and the **Android APK** (sideloaded). Tags are cut from
`main` after a `release/<version>` branch ([Development](wiki/Development.md#branches-and-releases)); pushing a
`v*` tag builds the image, the signed APK and the GitHub Release. Never put a keystore, a password or a secret value
in the repository, an issue or a pull request.

## Owner-only prerequisites (before the first APK release)

Full steps: [`docs/superpowers/plans/2026-11-25-android-release-apk.md`](superpowers/plans/2026-11-25-android-release-apk.md).

- [ ] **Package id and app name** chosen and set in `apps/android/identity.json` (`appId`, `appName`). The file
  still holds a placeholder (`io.github.elaktrato.qinqin`, `qinqin`). The id can never change once an APK is
  installed anywhere: a different id is a different app.
- [ ] **Signing keystore** created once, offline (`keytool -genkeypair ... -alias qinqin`), with a backup and the
  passwords in a password manager. A lost keystore means no more updates for installed phones.
- [ ] **Environment `android-release`** created (Settings, Environments), its deployment restricted to `v*` tags
  (optionally with required reviewers), and the four secrets set there: `ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Repository-level secrets with the same
  names keep working until they are moved, but any collaborator's branch workflow can read those, so move them and
  delete the repository copies. A tag build fails, naming the missing secret and never printing a value, instead of
  publishing an unsigned APK.
- [ ] **Dry run**: Actions, `android-apk`, Run workflow. It builds a debug-signed `qinqin-<version>-dryrun.apk`
  with no secrets; never distribute it.
- [ ] **Signing fingerprint** (SHA-256 of the certificate: `keytool -list -v -keystore qinqin-release.jks -alias
  qinqin`) recorded, and the repository **variable** `ANDROID_CERT_SHA256` set to it (Settings, Secrets and
  variables, Actions, Variables; it is public, not a secret). From then on a release signed with any other
  certificate fails. Until it is set the job only prints the fingerprint (job summary) and warns; do that after the
  first release at the latest.

## Before tagging

### Version

Set from the tag, nothing to edit: the image version (`build.yml` strips the `v`; the tag must be
`vMAJOR.MINOR.PATCH[-pre]`, else the image job fails) and the APK's `versionName` (the tag without `v`) and
`versionCode` (`apps/android/scripts/version-code.mjs`). The code is `major*1000000 + minor*10000 + patch*100 +
slot`: release 99, `alpha.N` 1-29, `beta.N` 30-59, `rc.N` 60-89, so a pre-release is always below its release.
`node apps/android/scripts/version-code.mjs v0.7.0` prints the pair (`70099`). The `tag` job runs this script
before the image is published and the Android build refuses a pre-release other than exactly `alpha.N`, `beta.N` or
`rc.N` (no leading zeros: `rc`, `rc1` and `rc.01` are refused), and minor or patch above 99.

Edited by hand:

- [ ] `docs/releases/<tag>.md` (the GitHub Release text; without it GitHub generates notes) and the matching
  upgrade notes, moved in from `docs/releases/NEXT.md`.
- [ ] `server/internal/api/version.go`: `ContractVersion` (and `BridgeLevel`/`bridgeFeatures` if the web app
  started to use more of the shell), together with `docs/contracts/version/` fixtures and a
  `docs/contracts/CHANGELOG.md` entry; a Go test compares the constant with the newest `(contract N)` heading.
- [ ] Wiki and roadmap statements that name the release (`docs/wiki/Android.md` status line, `docs/ROADMAP.md`).
- Not bumped per release: `apps/android/package.json` `version` (the default of a local build, versionCode 1).

### Changelog and notes

- [ ] Every user-visible change since the last tag is in the release notes; breaking or one-way changes (new
  migrations, new environment variables, removed routes) are under "Upgrading", read from `git log <last-tag>..` and
  `docs/contracts/CHANGELOG.md`.
- [ ] The notes say what was verified only by hand (see the checklists below) and what is not part of the release.

### Shell and server compatibility

The shell is an APK that loads **the user's server**, so any installed shell meets any server version. Decide per
release, using `GET /api/version` (`contract`, `bridge.level`, `bridge.features`) and
`docs/contracts/version/bridge-compat.json`:

- **Server bridge level above the shell's, or the server lists a feature the shell lacks:** the shell's first-run
  screen warns that the app is outdated (`shellOutdated`, with the missing features named). Ship a new APK in the
  same release, and say in the notes that the app must be updated.
- **Shell level above the server's:** `serverOutdated`, a warning to update the server.
- **A feature is optional** (the web app also runs in a browser): a missing one is a warning, not a break. A level bump
  is for the web app starting to need a shell behaviour an older shell lacks: avoid it, or ship the new APK with it.
- **Contract version** (`contract`): bumped when a client must follow a new `CHANGELOG.md` entry. The shell never
  reads it: its compatibility check compares only the bridge (`level` and `features`,
  `apps/android/src/firstrun/verify.ts`, the rule of `bridge-compat.json`). Since the app is the server's own web
  app, a new server brings its own UI to an old APK; only a change of the native bridge needs a new APK.
- [ ] Walk the cases: new server with the previous APK (warning at most, app opens), new APK with the previous server
  (the same), and the new pair.

### Server and image

- [ ] CI green on the release branch (`go test`, web tests, `e2e`, the emulator jobs if the shell changed).
- [ ] The browser walk-through below.

## Smoke test of the APK on a clean device

On a phone (or emulator) with **no earlier qinqin install** and a server reachable over https, with a test account:

- [ ] Install the APK from the dry run or from a release candidate (see "Smoke-testing the signed APK" below);
  Android asks for "Install unknown apps" once.
- [ ] First start: the server address screen. A wrong address, a non-qinqin address and a plain-http address on the
  public internet are refused with a clear message; the real address shows the server version and opens the app.
- [ ] Sign in, study a few cards, grade (haptics), speak a word with the device voice, share a word out and share a
  text in, take or choose a photo, save a backup through the save screen. See [Android](wiki/Android.md#phone-features).
- [ ] Offline: with the server stopped or flight mode on, force-stop and reopen the app; decks open, a session is
  graded, and the reviews reach the server once it is back ([Android](wiki/Android.md#offline)). Over plain http there
  is no offline start; that is documented, not a defect.
- [ ] Reminders: turn them on (Settings, Notifications), allow the permission, **Send a test**
  ([Reminders](wiki/Reminders.md)).
- [ ] Change server (account menu or the launcher shortcut) returns to the first screen.
- [ ] The hand checklists, on a physical phone: [`android-pages.md`](superpowers/checklists/android-pages.md) (both
  themes) and [`android-ime.md`](superpowers/checklists/android-ime.md) (real keyboards and handwriting). CI cannot
  verify these; the writing pad on touch and real keyboards rest on them.

## Verify the artifacts

On the release (or the workflow artifact `android-apk`), with the APK and its `.sha256` in one folder:

```sh
sha256sum --check qinqin-<version>.apk.sha256        # qinqin-<version>.apk: OK
apksigner verify --verbose --print-certs qinqin-<version>.apk   # Android SDK build-tools
aapt2 dump badging qinqin-<version>.apk | grep '^package:'      # versionCode / versionName from the tag
```

- [ ] `sha256sum` says OK. The checksum file sits beside the APK, so it proves integrity, not origin.
- [ ] `apksigner` verifies, and the SHA-256 certificate digest equals the fingerprint recorded by the owner. It must
  not be "Android Debug", and it must be the same on every release.
- [ ] `package` shows the owner's package id, `versionName` is the tag without `v`, `versionCode` is the
  `version-code.mjs` value. (The workflow already fails a build where these differ.)
- [ ] The release lists the image tag, the APK and the `.sha256`; a tag with a hyphen is a pre-release.
- [ ] **The signing fingerprint is in the release notes** (the first Android release: from the job summary or
  `keytool`; later ones: the pinned `ANDROID_CERT_SHA256`) and **the DRAFT banner is removed** from
  `docs/releases/<tag>.md` before the tag is pushed.

### Smoke-testing the signed APK before the final tag

The release job creates the GitHub release as a **draft**, uploads the APK and its `.sha256`, and publishes it only
then, so a draft exists during the run only and cannot be used to test before tagging. To try the signed APK first,
push an `-rc.N` tag (for example `v0.7.0-rc.1`: same key, a pre-release with a lower versionCode than the final
release), smoke-test that APK, then tag the final version.

## Updating an installed APK

Install the new APK over the old one: the server address and local data stay. Android accepts it only when the
**signing certificate is the same** and the **versionCode is higher**. So: always release from the same keystore; a
debug or dry-run build never updates a release install (uninstall it first); any later tag has a higher code by
construction (`rc` below its release). Check on a phone that has the previous release installed before announcing.

## Rollback

- **APK:** Android refuses to install a lower versionCode over an installed app. Either uninstall first (this deletes
  the app's local data: the saved server address, offline decks and any reviews not yet sent; sign in again and the
  server restores the rest), or ship the old code again as a new tag with a **higher** versionCode (for example a
  patch release), which updates in place. Prefer the second. Withdraw a bad release by marking the GitHub Release as
  a pre-release or deleting it; an installed copy is not affected.
- **Server:** migrations are one-way and **downgrading is not supported** ([Upgrading](wiki/Admin-upgrading.md)): going
  back needs the backup taken before the upgrade. A restored older server has a lower contract and bridge, so check
  the compatibility rules above against the APKs in use: an APK ahead of the server warns (`serverOutdated`), it does
  not stop working.

## Browser walk-through (server and image)

CI proves the embed is servable and the stroke data is reachable
(`scripts/smoke-embed.sh`) and drives the main flows in Chromium (the `e2e`
job), but it does not look at pixels. Before tagging a
release, run the built image or `go run ./cmd/qinqin serve` with a fresh build
and walk through this in a real browser (desktop Chrome or Firefox, plus one
phone-width window):

1. Sign in; the home page loads without console errors.
2. Open a character entry (for example 好). The stroke diagram appears; **Play**
   draws the strokes in order and stops; **Loop** repeats until switched off;
   a character with many strokes (for example 趣) animates to the end.
3. Open a Japanese kanji entry: the stroke diagram and readings render.
4. The heatmap widget on the home page renders cells for the last weeks and
   shows a value on hover or focus.
5. Reload a deep link (for example `/entry/5`): the page loads, not a 404.
6. Sources page lists the packs; each licence text link
   (`/ARPHICPL.TXT`, `/OPENCC-JS-LICENSE.TXT`, `/FIGTREE-OFL.TXT`) opens.
7. A hard reload after the previous release picks up the new UI (index is
   `no-store`; hashed assets are cached for a year).

## What the browser suite already covers

The `e2e` CI job (`apps/web/e2e`, [Development](wiki/Development.md#browser-end-to-end-tests)) drives
Chromium through signing in, a study session (grade changes, mixed card types), the reader popup, offline
study and its sync, and the phone bottom bar. It does not look at pixels, stroke animations, the heatmap or
licence texts, and runs no other browser, so the walk-through above stays; the wiki page lists everything the
suite leaves to a person.
