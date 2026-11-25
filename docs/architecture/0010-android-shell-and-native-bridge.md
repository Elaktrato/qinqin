# 0010. Android shell and native bridge

## Status

Accepted

Touched by: #35, #36, #37, #148. A merge from one of these issues that changes what this record names updates the record.

## Context

The owner decided (2026-11-23, `docs/superpowers/specs/2026-11-23-android-shell-design.md`) that the Android app is
the web app in a native shell, not a Kotlin rebuild: every screen and rule exists once. #34 built the shell
(`docs/superpowers/plans/2026-11-25-android-shell.md` has the rulings and the manual checks). The shell must not
leak into the web app's structure (the same build runs in browsers), and the web app must not become a second
UI in native code.

## Decision

- **The shell is a Capacitor project, `apps/android`.** It bundles one small page, the first-run "Server
  address" screen (`apps/android/src/firstrun/`), and loads **the web app from the user's own server**, never a
  copy in the APK. The server's API is reached with relative paths from its own origin: no CORS, and the web
  app's version is always the server's. Native code is added only where a WebView falls short, through
  Capacitor plugins.
- **Loading from a runtime address.** Capacitor's `server.url` is a build-time value, so MainActivity
  (`apps/android/android/app/src/main/java/qinqin/shell/MainActivity.java`) builds Capacitor's configuration on every start:
  with a saved server, the server URL is that origin; without one (first run, after Change server, or when the
  saved server failed to load) it is the bundled screen at `https://localhost`, which gets the failure kind in
  its query. The address is kept in private SharedPreferences (`ServerStore.java`) and changed only through
  the shell's own plugin `QinqinShell` (`ShellPlugin.java`), which restarts the activity.
- **The bridge is for one origin.** Capacitor injects its bridge with a document-start script and a message
  listener limited to the allowed origin rules, which here are the server's origin and the bundled screen's;
  `Bridge.launchIntent` sends every navigation to another host to the system browser. No other site gets
  the bridge. A WebView too old for these features (the web message listener and the document-start script) would make
  Capacitor fall back to an interface every frame can reach, so MainActivity refuses to open a remote server there and
  shows the first-run screen ("update Android System WebView"). Even the one origin with the bridge is limited:
  the plugin methods setServer and retry work only while the bundled first-run screen is the page (the server's own
  page cannot repoint the app); clearServer and `setBars` are callable from the server's page.
- **A failed load never shows Chrome's error page for the app's own origin.** `ShellWebViewClient.java` turns a
  main-frame failure of the saved server (no connection, timeout, certificate) into the first-run screen with
  Retry and Change server. When a service worker can serve the app offline, the navigation does not fail, so the
  web app's own offline start (#35) is untouched. A saved origin that answers with something that is not qinqin
  (an HTTP error for the first page, or on an online start a native `GET /api/version` re-check, `ServerCheck.java`,
  that is not `"app": "qinqin"`) gets the same screen (`error=notQinqin`); a failure to reach it at all never does.
  A launcher shortcut "Change server" (long-press the icon) forgets the address from outside the web app.
- **`apps/web/src/lib/native` is the web app's only door to the shell.** Every function does nothing in a
  normal browser (it checks `window.Capacitor.isNativePlatform()`), and nothing else in the web app mentions
  the shell or the global. It imports **no `@capacitor/*` package**: the same build runs in browsers, and the
  shell injects the plugins, which `lib/native/shell.ts` reaches through the injected global with local types.
  It offers: the back-button handler, the system-bar colours, and Change server. The only other mention of the
  shell is the account menu row that calls `canChangeServer()` and `changeServer()`.
- **Back button, in this order:** the innermost open overlay (`lib/ui/dismissStack.ts`: `Dialog`, `Sheet`,
  `Drawer` through `modal.ts`, and an open `Menu` register while open), then an Escape key press offered to
  overlays the stack does not know (a reader popup, the highlight editor), then the browser history, then the
  app goes to the background (`lib/native/back.ts`).
- **System bars follow the theme.** The bars are transparent over the page (edge to edge, Android 15+ enforces
  it; MainActivity enables it on older versions); the page paints under them and clears them with
  `env(safe-area-inset-*)`. `lib/native/bars.ts` maps the painted `--chrome` colour to the icon style (dark icons
  on a light colour) and sends it, with the colour, to `QinqinShell.setBars`, which sets the colour behind the
  bars (what shows where the WebView does not paint under them) and the icon appearance.
- **Bridge level and features** (`docs/contracts/version/`): the shell knows what it implements (SHELL_BRIDGE in
  `apps/android/src/firstrun/verify.ts`: level 1, features `files`, `haptics`, `keep-awake`, `local-notifications`,
  `share`, `status-bar`, `tts`; the server lists the features its web app uses when present, the same seven,
  contract 3) and warns on its first-run screen when
  `bridgeCompatibility` against the server's `/api/version` says `shellOutdated` or `serverOutdated`. A server
  never refuses a shell, and the shell never refuses a server. The web app raises the level when it starts to
  rely on a shell behaviour an older shell lacks.
- **Offline and storage stay in the WebView (#35, measured in an emulator, `docs/superpowers/specs/2026-11-23-android-shell-design.md`).**
  The service worker registers over `http://localhost` or https and the app starts offline from its cache; the
  quota is about 60 % of the disk and the web app stores 5 to 20 MB, so there is no native file storage. The session
  token stays in `localStorage` (no Keystore plugin). The manifest declares the network-state permission so the page's
  online and offline events fire. The emulator job (`.github/workflows/android-emulator.yml`) is the only place
  these run.
- **One source of screens.** No screen except the first-run one exists in native code. A feature of the web app
  is a feature of the app.
- **Cleartext.** Android cannot restrict cleartext to address ranges, so the manifest's network security config
  allows it and the shell enforces the rule in code, in two places: the first-run screen (`address.ts`) and the
  native `ServerStore.isAllowedOrigin` (https, or http on a private host: the same rule in Java), which every save and
  every read of the saved address passes. Requests the server's own page makes to other hosts are not restricted by the
  platform.

- **Native device features (#36, plan `docs/superpowers/plans/2026-11-25-native-features.md`).** Each is a small own
  Java plugin in `apps/android` (androidx and the Android framework only: no Play Services, no Firebase, no
  community plugin, no new Gradle dependency) behind one module of `lib/native/`, which does nothing in a browser:
  `QinqinSpeech` (the system text-to-speech engine: language availability, speak with a rate, the system voice settings; `speech.ts`),
  `QinqinFiles` (Storage Access Framework save, chunked: `files.ts`), `QinqinShare` (share sheet, and the queue of
  what arrives from outside: shared text, "Look up in qinqin" from the text selection menu through an activity alias,
  a tapped notification's route: `share.ts`, `incoming.ts`), `QinqinNotifications` (permission, schedule and cancel
  with AlarmManager inexact alarms and NotificationCompat, a boot receiver that arms stored ones again:
  `notifications.ts`), and `QinqinShell.keepAwake` and `.vibrate` (`awake.ts`, `haptics.ts`). The camera and the
  photo picker need no plugin: Capacitor's WebView file chooser serves `input[type=file]`, and the manifest does
  **not** declare the camera permission, so the system camera app takes the picture. Things that come in from outside are
  untrusted: cleaned in Java and again in the web app, capped, shown only as a search query or an in-app path, and
  held until the person is signed in and the workspaces are loaded.
- **Browsers keep what they have.** Without the shell, speech is the page's `speechSynthesis`, saving is an anchor
  download, sharing is `navigator.share` or the clipboard, the screen stays on through the Screen Wake Lock API, the
  grading buzz is `navigator.vibrate` on a touch device, and notifications are unsupported.

## Release build and signing (#148)

- A `v*` tag builds a signed release APK in `build.yml` (job `android`, the reusable `android-apk.yml`) and the
  `release` job attaches `qinqin-<version>.apk` and `qinqin-<version>.apk.sha256` (`sha256sum` format) to the
  GitHub release. No APK means no release: the release job needs the APK job.
- `versionName` is the tag without its `v` (semver, checked like the image job's tag guard). `versionCode` is
  `major*1000000 + minor*10000 + patch*100 + slot`; slot is 99 for a release and orders `alpha.N` (1-29), `beta.N`
  (30-59) and `rc.N` (60-89) below it. `apps/android/scripts/version-code.mjs` holds the rule and its tests; any
  other pre-release label fails the build. Gradle reads `-PqinqinVersionName` and `-PqinqinVersionCode`; a build
  without them (local, debug) is `package.json`'s version with code 1. `package.json`'s `version` is therefore only
  that local default and need not be bumped per release.
- Signing reads four environment variables (`QINQIN_KEYSTORE_FILE`, `QINQIN_KEYSTORE_PASSWORD`, `QINQIN_KEY_ALIAS`,
  `QINQIN_KEY_PASSWORD`) and applies only when all four are set. The workflow decodes the repository secret
  `ANDROID_KEYSTORE_BASE64` to a temporary file and removes it afterwards; the secrets are read only for a tag
  build in `Elaktrato/qinqin`, never on a fork or pull request. A missing secret fails the job with its name.
- The build runs `npm run sync` (first-run screen, `capacitor.config.json`, `www/`) before Gradle, then checks the
  APK: `apksigner verify`, the version read back with `aapt2 dump badging`, and no debug certificate on a release.
- A manual run of `android-apk` (workflow_dispatch) builds a debug-signed `qinqin-<version>-dryrun.apk` as a
  workflow artifact only, with no secrets and no release.
- Extension point: an Android App Bundle for Play (`bundleRelease`, same signing config) is not built; add it as a
  second Gradle task in `android-apk.yml` and a second release asset when a Play listing is decided.
- The keystore is the identity of the app: Android refuses an update signed with another key. The owner keeps an
  offline copy of the keystore and its passwords; losing them means a new package id.

## Consequences

- A web app release reaches every phone with no app release; an old shell with a new server is told so.
- A native piece is a new plugin plus one function in `lib/native`; the rest of the web app stays unaware.
- The service worker (offline) needs a secure context, so a server on plain http gets no offline start in the app
  either.
- The package id is a placeholder (`apps/android/identity.json`) the owner must confirm before the first release.
- The server needs no change; a Content-Security-Policy added later does not block the bridge (it is injected by
  the WebView, not by the page) but must allow what the web app itself needs.

## Allowed / Not allowed

Allowed:

- `lib/native` reading `window.Capacitor` and calling plugins; a component calling `lib/native`'s functions
  (`canChangeServer`, `changeServer`, `saveFile`, `shareText`, `keepAwake`, ...).
- A new overlay registering with `registerDismissable` when it is not built on `modal`, `Menu`, `Dialog`, `Sheet`
  or `Drawer`.
- Native code in `apps/android` for what a WebView cannot do, as a small own plugin before a community one.
- A new plugin or Gradle dependency only with its licence recorded (FOSS, F-Droid-compatible: no Google Play
  Services, Firebase or proprietary SDK) and its transitive tree checked (`./gradlew :app:dependencies`).

Not allowed:

- Importing `@capacitor/*` anywhere in `apps/web`, or reading `window.Capacitor` outside `lib/native`.
- A screen in native code other than the first-run screen.
- Serving the web app from the APK, or giving the bridge to another origin (Capacitor's allowNavigation setting, extra allowed origin rules).
- Behaviour that changes in a browser because of the shell code.

## Enforcement

- `apps/web/src/lib/native/native.dom.test.ts` proves the no-op in a browser, the back order and the bar
  updates in a faked shell; `back.test.ts` and `bars.test.ts` cover the decisions; `apps/web/src/lib/ui/dismissStack.dom.test.ts`
  proves `Dialog`, `Sheet`, `Drawer` and `Menu` register and close innermost first.
- `apps/web/tests/repo/nativeBoundary.test.ts` fails when a file outside `lib/native` mentions `@capacitor/` or the Capacitor global.
- `apps/web/tests/repo/folderRules.test.ts` classifies `lib/native` as a logic folder (no component in it).
- `apps/android/src/firstrun/address.test.ts`, `verify.test.ts` (the bridge rule against
  `docs/contracts/version/bridge-compat.json`), `main.dom.test.ts` and `style.test.ts` (the house-theme colours
  against `apps/web/src/lib/theme/fallback.ts`) cover the first-run screen;
  `apps/android/android/app/src/test/java/qinqin/shell/ServerStoreTest.java` covers the address guard and the cleartext
  rule, `ServerCheckTest.java` the not-qinqin classification. The build workflow runs the first-run screen's tests; the
  emulator job runs the Java tests.
- Review: that no allowNavigation or a second server URL is added in MainActivity, and that a new overlay is
  reachable by the back button.

## Open questions

- Unsent reviews are in localStorage, which Chromium commits a few seconds late: a process kill right after a grade
  loses it (measured, #35). Moving the outbox to IndexedDB belongs to the study data layer.
- Whether plain http for 100.64.0.0/10 (Tailscale and carrier-grade NAT) should count as private. It does not
  today (the secure default); the owner decides.
- Which Android package id the app ships under (`identity.json` is a placeholder) and the app name; the owner also creates the release keystore and its four secrets before the first tag (see the plan of #148).
