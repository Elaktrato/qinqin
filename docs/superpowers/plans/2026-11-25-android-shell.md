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
