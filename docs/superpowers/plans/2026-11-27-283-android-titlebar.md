# #283 — Android: no black title bar ("qinqin") above the web app (2026-11-27)

Milestone v0.9.0, phase 1 (foundations and bugs). Branch `feature/v090-283-android-titlebar`. Plan §6: make the
change with unit-level tests where they run; the APK build and the emulator check are local (and the PR's
emulator job).

## What

The activity starts on `AppTheme.NoActionBarLaunch` (parent `Theme.SplashScreen`), whose `postSplashScreenTheme`
is `AppTheme.NoActionBar`. Nothing calls `SplashScreen.installSplashScreen`, so the launch theme is never swapped by
the splash library. Capacitor 8.6.2's `BridgeActivity.onCreate` does call `setTheme(AppTheme_NoActionBar)`, but
only after `super.onCreate`, and `MainActivity.onCreate` calls `EdgeToEdge.enable(this)` first: `EdgeToEdge.enable`
reads `window.getDecorView()`, which makes the window build its decor (and decide on a window title) under the
launch theme. A later `setTheme` cannot take a title back off a decor that is already built. The likely result is
the framework's window title showing the activity label `title_activity_main` = "qinqin". This is a reading of the
code; the emulator confirms it (Local follow-up).

Fix:
- `MainActivity.onCreate` calls `SplashScreen.installSplashScreen(this)` first, before `EdgeToEdge.enable` and
  `super.onCreate`. It switches the activity to `postSplashScreenTheme` (`AppTheme.NoActionBar`) before anything
  builds the decor, and keeps the splash screen working on every API level (on 31+ the system splash, below it
  the library's).
- Both themes say "no title" in the framework's own attributes too (`android:windowNoTitle` true,
  `android:windowActionBar` false), so whichever theme the decor is built under has no title.
- The emulator driver checks after the first-run screen and after the web app opens that the app's window has no
  title or action bar view and that the WebView starts at the top of the window (edge to edge: y = 0, under the
  transparent status bar).

## Tasks

1. This plan.
2. Tests first, then the change (one commit, the suites green): `apps/android/src/theme.test.ts` (a resource and
   source test, vitest: the themes have no title, the launch theme hands over to `AppTheme.NoActionBar`, the
   manifest starts the activity on the launch theme, `installSplashScreen` comes before `EdgeToEdge.enable` and
   `super.onCreate`); `apps/android/e2e/chrome.test.mjs` for the pure parser of the emulator check. See them fail,
   then `MainActivity.java`, `styles.xml`, `e2e/chrome.mjs` and the two driver checks.
3. Docs: record 0010 (the start sequence), `docs/releases/NEXT.md`, this record.

## Rulings

- Ruling: `installSplashScreen` and explicit no-title attributes, both — `installSplashScreen` is the documented
  way to leave a `Theme.SplashScreen` launch theme and keeps the splash; the attributes cover a decor built before
  any swap — cost if wrong: none known; the emulator check shows a title view if one is still there.
- Ruling: keep `EdgeToEdge.enable` before `super.onCreate` (the issue says to keep it as it is), only after
  `installSplashScreen` — cost if wrong: none; it ran before the theme swap until now, too.
- Ruling: the unit-level test is a vitest resource/source test in `apps/android/src/`, not a JVM test — Gradle
  cannot configure the project here (the Android Gradle plugin comes from Google's Maven, which the container's
  proxy refuses), a theme needs the Android framework (Robolectric is not a dependency, and adding one is not
  worth it for one check), and the vitest suite runs in the main CI job without an SDK — cost if wrong: the source
  test checks text order, not behaviour; the emulator check covers the behaviour.
- Ruling: the emulator check reads `uiautomator dump`: a node with id `android:id/title`, `android:id/action_bar`,
  `<pkg>:id/action_bar` or a Toolbar/ActionBar class in the app's package fails it, and so does a WebView whose
  top is not 0 — the dump is the window's real view hierarchy, a screenshot needs a human — cost if wrong: an
  emulator image that puts the window below the status bar (no edge to edge) would fail on the top check; the
  failure message names the bounds.
- Ruling: the check runs in the `shell` suite's first steps (first-run screen and web app); the PR's emulator job
  runs `shell,core`, so it runs on the PR — cost if wrong: none.

## Execution record

- Root cause read from the code, not seen: Capacitor 8.6.2's `BridgeActivity.onCreate`
  (`node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeActivity.java`) sets
  `AppTheme_NoActionBar` after `super.onCreate`; `MainActivity` called `EdgeToEdge.enable` (which touches the
  decor view) before either. The emulator run confirms or refutes it (Local follow-up).
- Tasks 2 and 3 of the change are one commit (the suites stay green at each commit). Test-first: `src/theme.test.ts`
  and `e2e/chrome.test.mjs` were written and run before the change: 4 theme/source tests failed (no
  `android:windowNoTitle` on either theme, no `installSplashScreen`, no import) and `chrome.test.mjs` failed on the
  missing module; after the change all pass.
- Gradle here: `gradle --no-daemon tasks` in `apps/android/android` fails at configuration: `Could not resolve
  com.android.tools.build:gradle:8.13.0` (dl.google.com refused by the container's proxy, 403). So nothing Java
  compiled or ran here: neither `MainActivity.java` nor the existing JVM unit tests (`testDebugUnitTest`), and the
  emulator check in `e2e/drive.mjs` never ran. `node --check e2e/drive.mjs` passes.
- Gates: `apps/android`: `npx vitest run` 11 files, 163 tests passed; `npm run check` (tsc) clean.
  `apps/web` `npx vitest run tests/repo` (the architecture-record and docs tests): 9 files, 587 passed, 1 skipped.
  `node --test scripts/*.test.mjs`: 190 tests, 189 passed, 1 skipped, 0 failed. No Go and no web app code changed.
- Not checked: the APK build, the title bar on a device or emulator, the splash screen still showing, the system
  bar colours from `setBars`, the screenshot for the PR. All below.

## Local follow-up

The PR's emulator job (`.github/workflows/android-emulator.yml`, core: `shell,core`) runs the new checks; on the
owner's machine, with the Android SDK, an emulator (API 35 or 36, google_apis) and the repository's Go and Node:

1. **Build and unit-test the APK** (compiles `MainActivity.java` with the new import):
   ```sh
   cd apps/web && npm ci && npm run build && cd ../..
   apps/android/e2e/build-server.sh /tmp/qinqin-e2e/qinqin
   cd apps/android && npm ci && npm run sync && cd android
   ./gradlew --no-daemon testDebugUnitTest assembleDebug
   ```
   Look for: BUILD SUCCESSFUL. If `SplashScreen` does not resolve, check that `androidx.core:core-splashscreen`
   is still in `app/build.gradle`'s dependencies.
2. **Run the emulator checks and take the screenshot** (emulator booted, `adb devices` lists it):
   ```sh
   cd <repo root>
   E2E_SUITES=shell E2E_BIN=/tmp/qinqin-e2e/qinqin \
   E2E_APK=apps/android/android/app/build/outputs/apk/debug/app-debug.apk \
   E2E_OUT=apps/android/e2e-out node apps/android/e2e/drive.mjs
   ```
   Look for: the steps "first-run screen: no title bar, the WebView starts at the top (#283)" and "web app: no
   title bar, …" pass; `apps/android/e2e-out/01-first-run.png` and `03-web-app.png` show no black "qinqin" bar
   (the page's own top bar sits directly under the status bar); `chrome-first-run.xml` / `chrome-web-app.xml`
   hold the dumps. Attach `03-web-app.png` to the PR.
   If a step fails: its message lists the title nodes and `webViewTop`. A title node still there means the decor
   is built under a titled theme: check `adb shell dumpsys activity top | grep -i theme`, and whether a Capacitor
   update moved `setTheme`. `webViewTop` > 0 with no title node means the window is not edge to edge on that
   image: check `EdgeToEdge.enable` and compare the status bar height (`adb shell dumpsys window | grep -i
   statusbar`); loosen the check only if the WebView top equals the status bar's bottom on an image that does
   not draw under the bars.
3. **By hand:** the splash screen still shows at a cold start (icon on the qinqin chrome colour); no title after
   "Change server" (long-press the launcher icon) and after a restart; status and navigation bars take the theme's
   colours in Day and Night.
