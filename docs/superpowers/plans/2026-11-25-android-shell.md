# Android shell (#34) Implementation Plan

> Executed subagent-driven. Design: `docs/superpowers/specs/2026-11-23-android-shell-design.md` and its addendum
> `docs/superpowers/specs/2026-11-25-android-shell-addendum.md`. Record: `docs/architecture/0010-android-shell-and-native-bridge.md`.

**Goal:** a Capacitor Android app that loads the web app from the user's own server, with back button, system
bars, safe areas, external links and Change server, and a small first-run screen. Everything the user sees stays
the web app.

## Rulings

- Ruling: Capacitor 8.6.2 (core, cli, android) with `@capacitor/app` 8.1.2 as the only Capacitor plugin, all pinned
  without `^` — the back button needs it; the status bar plugin cannot set a colour when the app targets Android
  15+ (edge to edge is enforced), core `SystemBars` already handles insets, the keyboard and icon style, and
  external links go through `Bridge.launchIntent` — a missing plugin is one `npm i` and one `lib/native` function.
- Ruling: the web app reaches plugins through the injected `window.Capacitor`, with no `@capacitor/*` import in
  `apps/web` — the same build runs in browsers, so an import would ship dead code to everyone and the shell
  injects the plugins anyway — if wrong, add the packages and import them in `lib/native` only (small).
- Ruling: Capacitor's configuration is built at each start in `MainActivity` and the activity is recreated to
  switch (set, clear, retry, failure) — `server.url` is build-time, and the bridge's allowed origins are fixed when
  it is created, so runtime navigation cannot give the bridge to the new origin — a flash on the switch.
- Ruling: the saved address lives in an own tiny plugin `QinqinShell` over SharedPreferences, not
  `@capacitor/preferences` — `MainActivity` must read it natively before the WebView exists, and the same plugin
  restarts the activity and colours the window — one more plugin to maintain.
- Ruling: Java, no Kotlin — the Capacitor template is Java and Kotlin adds a Gradle plugin and a runtime for about
  200 lines — a rewrite if the native side grows.
- Ruling: only the origin of an address is kept (path, query and fragment are dropped, and the screen says so) —
  the web app calls `/api/...` with absolute paths and the server has no base path, so a sub-path could never work
  — a deployment under a sub-path behind a rewriting proxy cannot be entered (none is supported today).
- Ruling: plain http is accepted for private hosts: localhost, `*.localhost`, `*.local`, single-label names,
  127/8, 10/8 (includes the emulator's 10.0.2.2), 172.16/12, 192.168/16, 169.254/16, IPv6 `::1`, `fc00::/7`,
  `fe80::/10`; not 100.64/10 — the secure default; a bare address typed without a scheme gets https, so http is
  always deliberate — Tailscale users must use https or the owner widens the list.
- Ruling: the platform allows cleartext (network security config) and the shell enforces the private-address rule
  in code — Android cannot express address ranges — a bug in the check would allow http to a public host.
- Ruling: a saved server that fails to load restarts into the first-run screen with the failure in its query
  (Retry, Change server); only main-frame connection, timeout and TLS errors count — Chrome's error page never shows
  for the app's origin, and the screen keeps the saved address, so a bad network does not forget it.
- Ruling: back order is overlay stack, then an Escape key press for overlays outside the stack, then history, then
  `minimizeApp` — the Android habit, and the stack stays generic; the synthetic Escape can double up with a handler
  that closes without `preventDefault` (a hidden tooltip), which is invisible.
- Ruling: the system bars are transparent over the page; `setBars` colours the window behind them from `--chrome`
  and sets icon darkness from the contrast of that colour — a status-bar colour API does not exist on Android 15+.
- Ruling: `applicationId` and the launcher name are a PLACEHOLDER in `apps/android/identity.json`
  (`io.github.elaktrato.qinqin`, `qinqin`), the code package is `qinqin.shell` — the application id can never change
  after a release, so the owner must confirm it before #147; Gradle and `capacitor.config.ts` read the one file.
- Ruling: compile and target SDK 36, min SDK 24 (Capacitor 8's defaults); `google-services` removed and
  `allowBackup` off — no proprietary push library for F-Droid (#149), and the saved address and WebView data are not
  copied into cloud backups.
- Ruling: the shell's bridge is level 1 with feature `status-bar` — what it implements today (docs/contracts/version);
  it warns, never refuses.
- Ruling: the first-run screen asks for one more tap ("Open qinqin") after a successful check — the person sees the
  version and any warning before it is saved.
- Ruling: `setServer` and `retry` work only while the bundled first-run screen is the page (`MainActivity.isFirstRunScreen`),
  and `ServerStore.isAllowedOrigin` repeats the cleartext rule in Java (https, or http on a private host) both when saving
  and when reading the saved value — the saved server's own page is the one remote origin with the bridge and must not
  repoint the app or enable public http; cost if wrong: a legitimate in-app "set server" flow would need a new method
  (Change server uses `clearServer`, which stays callable).
- Ruling: a saved server that answers with something that is not qinqin gets the first-run screen with `error=notQinqin`:
  a native `GET /api/version` re-check on every online start (off the main thread; a real answer other than 200 with
  `"app": "qinqin"` counts, redirects are not followed; any I/O failure is "unknown" and never reacts) plus
  `onReceivedHttpError` (status >= 400) for the initial main-frame load only, plus a launcher shortcut "Change server" —
  offline start stays served by the service worker (a 200); cost if wrong: a server behind an auth proxy that answers
  `/api/version` with 401/302 is offered the first-run screen on every start (Retry and Change server remain; fix is to
  let it through).
- Ruling: a WebView without `WEB_MESSAGE_LISTENER` or `DOCUMENT_START_SCRIPT` refuses to open a remote server
  (first-run screen, `error=webview`, "update Android System WebView") — verified in Capacitor 8.6.2's `MessageHandler`:
  without the listener it calls `addJavascriptInterface(this, "androidBridge")`, which every frame of every page can
  reach; cost if wrong: very old WebViews (pre-2019) cannot use the app at all.
- Ruling: `setBars` accepts `#rrggbb` only in both Java (`ShellPlugin.isBarColor`) and `bars.ts`, which now also reads
  short hex, `#rrggbbaa` and `rgb()`/`rgba()` (alpha dropped) and lets the engine resolve other CSS colours through a probe
  element; an unreadable `--chrome` keeps the last style — cost if wrong: a theme with an exotic `--chrome` keeps stale
  icon colours until the next readable one.
- Ruling: the first-run screen also rejects host names `java.net.URI` rejects (underscore, a leading hyphen, an all-numeric
  last label) so what it accepts the shell accepts; `setServer`'s rejection is shown as the invalid-address problem.
- Ruling: an unfollowed 3xx with a `Location` on another origin (http to https is not followed by the native stack) is
  the `redirect` failure with the https offer — instead of "not a qinqin server".
- Ruling: private hosts keep single-label names (`nas`), `*.local` and `*.localhost` as they are — home-network names are
  the point of the http exception, the first-run screen always warns and https is the default for a bare address;
  cost if wrong: a typed `http://com` or a hostile network answering a one-word name is accepted over plain http.
- Ruling: the server's bridge lists `status-bar` (what its web app uses when the shell has it; contract 2), and the shell
  lists what it implements; the first-run screen's `bridgeCompatibility` copy exists because that bundle cannot import
  the web app, `bridge-compat.json` pins both, and the web app's `getVersion`/`bridgeCompatibility` are not called by a
  screen today (documented) — cost if wrong: a shell older than `status-bar` shows a "missing in this app" warning.
- Ruling: the Android unit tests run in CI: `npm ci && npm test && npm run check` in the build workflow's test job,
  `testDebugUnitTest` in the emulator job, whose path filter now covers the service worker, `lib/pwa`, `lib/study`, the
  dismiss stack, `modal` and `apps/android` — a path-light job and a heavy one; cost if wrong: an emulator run for a change
  that did not need one.
- Ruling: back reaches a Sheet or Drawer's inline rename/confirm first — `modal` offers a synthetic Escape key press
  to the focused element before the dialog's `cancel`; the Escape handlers that close something (lookup popup, deck
  confirmations, tooltip) call `preventDefault` so the back button does not also navigate — cost if wrong: a handler
  that forgets `preventDefault` still double-fires, which a new test per overlay would catch.
- Ruling: licensing wording (`LICENSING.md`): documentation is CC BY 4.0, UI strings, fixtures and contracts are MIT with
  the code, the lemma table and the qinqin themes inside the server are named as CC BY, earlier published copies keep
  their terms, and the HSK paragraph carries the CTI wording; `check-sources` rule g requires exactly `CC-BY-4.0` (plus
  an optional ` (` qualifier) — cost if wrong: the owner may want documentation under another licence.
- Note (#148, release): `apps/android/package.json` version (0.6.0) and `versionCode 1` in `app/build.gradle` are
  hard-coded and must follow the release tag; left to #148. A `v*` tag that is not semver now fails the image job in
  `build.yml` instead of reporting `dev`.

## Tasks

1. [x] Address rules (`address.ts`), verification and the bridge rule (`verify.ts`), tests first.
2. [x] The first-run screen: page, house-theme CSS (a test compares the tokens with `fallback.ts`), strings object,
   `main.ts`; jsdom flow tests.
3. [x] The Capacitor project: pinned packages, identity, Gradle (SDK, no google-services), manifest, network
   security config, theme and icon resources, the wrapper.
4. [x] Native side: `ServerStore` (+ JVM test), `ShellPlugin`, `ShellWebViewClient`, `MainActivity`.
5. [x] `lib/ui/dismissStack` and its wiring in `modal.ts` and `Menu.svelte`; `lib/native` (shell, back, bars, index),
   the layout hook, the account menu row, the catalogue key; folder rule and record 0004.
6. [x] Docs: wiki `Android.md`, sidebar, home, FAQ, install page, proxy section, development section, record 0010.
7. [x] Verify: `npm test` and `npm run check` in `apps/android`, `./gradlew testDebugUnitTest assembleDebug`, web
   `npm run check` and the full vitest, the server's headers by curl.

## Verification log

- Debug APK builds (`./gradlew assembleDebug`, about 3.9 MB); JVM test of the saved-address guard passes.
- The emulator could not run on the build machine: `/dev/kvm` is `root:kvm 0660` and the build user is not in the
  group (`emulator -accel-check`: no permission), and the machine has about 2.5 GB free; software emulation was
  not attempted. So the WebView behaviour below was **not** run, and must be checked once on a phone or an
  emulator with KVM.

## Manual checks (phone or emulator; `adb` allowed, no browser automation)

Start a server (`qinqin serve --addr 0.0.0.0:8085 --data /tmp/qq`), install `app-debug.apk`. On the emulator the
host is `http://10.0.2.2:8085`; `adb reverse tcp:8085 tcp:8085` makes `http://localhost:8085` work, which is a
secure context (a service worker registers).

1. First start: the first-run screen in qinqin Day or Night (follow the phone's setting). Empty Connect: an
   alert, no request. `http://example.com`: refused. `10.0.2.2:8085` (no scheme): https is tried and fails
   (unreachable). `http://10.0.2.2:8085`: warning about plain http, then "Found qinqin <version>", then Open.
2. The web app loads. `chrome://inspect` (debug build) or `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`:
   on the server origin `Capacitor.isNativePlatform()` is true and `Capacitor.Plugins.QinqinShell` and `App` exist;
   on any other origin (open `https://example.org` in the same WebView via a test page) `window.Capacitor` and
   `window.androidBridge` are undefined.
3. A link to another host opens the browser app. The app stays on the server's origin.
4. Back: open the account menu, press back (menu closes, page stays); open a dialog or a sheet, back closes it;
   navigate two pages, back goes back twice; at the first page back sends the app to the background.
5. Rotate and switch Day/Night in Settings: the status bar icons stay readable against the top bar; the bottom bar
   sits above the gesture bar and the keyboard (open a text field).
6. Account menu, Change server: the first-run screen, the form filled with the last address.
7. Stop the server, kill and start the app: with `localhost` (service worker) the app opens and studies offline; with
   plain `http://10.0.2.2` the first-run screen shows "Could not reach", Try again (server back up: loads),
   Change server (form).
8. A server with a bad certificate: "not trusted" message. A server redirecting `http` to `https` on another port:
   "redirects to ...", Use that address.
