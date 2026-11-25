# 0010. Android shell and native bridge

## Status

Accepted

Touched by: #35, #36, #37. A merge from one of these issues that changes what this record names updates the record.

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
  the bridge. (A WebView too old for these features falls back to Capacitor's all-origins interface; the
  navigation rule still keeps other sites out of the main frame.)
- **A failed load never shows Chrome's error page for the app's own origin.** `ShellWebViewClient.java` turns a
  main-frame failure of the saved server (no connection, timeout, certificate) into the first-run screen with
  Retry and Change server. When a service worker can serve the app offline, the navigation does not fail, so the
  web app's own offline start (#35) is untouched.
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
  `apps/android/src/firstrun/verify.ts`: level 1, feature `status-bar`) and warns on its first-run screen when
  `bridgeCompatibility` against the server's `/api/version` says `shellOutdated` or `serverOutdated`. A server
  never refuses a shell, and the shell never refuses a server. The web app raises the level when it starts to
  rely on a shell behaviour an older shell lacks.
- **One source of screens.** No screen except the first-run one exists in native code. A feature of the web app
  is a feature of the app.
- **Cleartext.** Android cannot restrict cleartext to address ranges, so the manifest's network security config
  allows it and the shell enforces the rule in code: https is required, plain http only for private addresses
  (`apps/android/src/firstrun/address.ts`), and `ServerStore.isOrigin` guards what reaches the WebView.

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
  (`canChangeServer`, `changeServer`).
- A new overlay registering with `registerDismissable` when it is not built on `modal`, `Menu`, `Dialog`, `Sheet`
  or `Drawer`.
- Native code in `apps/android` for what a WebView cannot do.

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
  `apps/android/android/app/src/test/java/qinqin/shell/ServerStoreTest.java` covers the address guard.
- Review: that no allowNavigation or a second server URL is added in MainActivity, and that a new overlay is
  reachable by the back button.

## Open questions

- Whether plain http for 100.64.0.0/10 (Tailscale and carrier-grade NAT) should count as private. It does not
  today (the secure default); the owner decides.
- Which Android package id the app ships under (`identity.json` is a placeholder).
