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

## Follow-up after the first emulator run (PR #344, head d6a6d3da)

The `emulator (core)` job built the APK (BUILD SUCCESSFUL, so `MainActivity.java` compiles and `testDebugUnitTest`
passed) and failed the new step: `{"ok":false,"webViewTop":128,"titles":[]}`. So the dump has no title, action bar
or toolbar view (the theme fix holds), but the WebView starts at 128 px, not 0.

Why: Capacitor 8.6.2's built-in SystemBars plugin
(`node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/SystemBars.java`, insets handling
`css` by default) sets an insets listener on the decor view. It passes the insets through to the page (WebView at 0)
only when the WebView's major version is 140 or later and the page declares `viewport-fit=cover`; both our pages do.
On an older WebView it pads the decor view by the system bar and cutout insets, and the WebView then starts right
under the status bar. The CI image is API 34 `google_apis`, whose WebView is older than 140; 128 px is about its
status bar (Pixel 6 profile at 2.625x). Record 0010 said "the page paints under the bars", which is true only on
WebView 140+, so the record now says both.

- Ruling: both layouts are right, so the check accepts both. It reads the status bar's bottom from `dumpsys window`
  (InsetsSource `type=statusBars` / `ITYPE_STATUS_BAR` / a top `displayCutout`, or the system UI's `status_bar`
  node when the dump holds it), passes when `webViewTop <= statusBarBottom` and fails when the WebView starts below
  it — what a title bar (about 56 dp) does — or when the dump has a title or action bar node. An unknown status bar
  height fails rather than passes. Forcing the WebView to 0 on old WebViews would go against Capacitor's workaround
  for Chromium bug 40699457 (`env(safe-area-inset-*)` unreliable there) — cost if wrong: a status bar taller than a
  window title plus the bar itself could hide a title gap; the title-node check still catches the framework title.
- Ruling: the step also records the WebView version (`dumpsys webviewupdate`) and saves the `dumpsys window` output
  next to the dump, so a failure can be read from the artifacts.
- Ruling: `Error injecting safe area CSS: TypeError: Cannot read properties of null (reading 'style')` is harmless and
  not caused by our page. The only `.style` read in Capacitor's script is `document.documentElement.style`, and our
  first-run page never removes or replaces `<html>` (static `index.html`, no `document.open`/`write`). The decor's
  insets listener fires when the window attaches, before the WebView has a document, and the script then runs
  against none. Capacitor runs it again after the page commits (`onPageCommitVisible` → `requestApplyInsets`). Each
  activity (re)creation repeats the error (first launch, Open, a failure screen). Also, neither the first-run screen
  nor the web app reads the `--safe-area-inset-*` variables it sets: both use `env(safe-area-inset-*)`. So the
  failed injection changes nothing — cost if wrong: none for the layout; the log line stays as noise.
- Execution: the new `chrome.test.mjs` was written together with the new `chrome.mjs`, not strictly before it. Run
  against the old `chrome.mjs`, the file fails to import (no `statusBarBottom`); with the new one all 11 tests pass.
  The driver change itself runs only in the emulator job.
- Gates: `apps/android` vitest 11 files, 170 tests passed; tsc clean; `node --check e2e/drive.mjs` ok; `apps/web`
  `vitest tests/repo` 587 passed, 1 skipped; `node --test scripts/*.test.mjs` 190 tests, 189 passed, 1 skipped,
  0 failed. The emulator run of the new check is CI's (after the merge).

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
   Look for: the steps "first-run screen: no title bar, the WebView starts at or above the bottom of the status bar
   (#283)" and "web app: no title bar, …" pass (their result shows `webViewTop`, `statusBarBottom` and the WebView
   version); `apps/android/e2e-out/01-first-run.png` and `03-web-app.png` show no black "qinqin" bar
   (the page's own top bar sits directly under the status bar); `chrome-first-run.xml` / `chrome-web-app.xml`
   hold the dumps. Attach `03-web-app.png` to the PR.
   If a step fails: its message lists the title nodes and `webViewTop`. A title node still there means the decor
   is built under a titled theme: check `adb shell dumpsys activity top | grep -i theme`, and whether a Capacitor
   update moved `setTheme`. A reason "starts N px below the status bar" with no title node means something
   else sits between the bar and the WebView: look at `chrome-<where>.xml`. "the status bar height is unknown"
   means the `dumpsys window` format differs on that image: look at `chrome-<where>-dumpsys-window.txt` and
   extend `statusBarBottom` in `e2e/chrome.mjs`.
3. **By hand:** the splash screen still shows at a cold start (icon on the qinqin chrome colour); no title after
   "Change server" (long-press the launcher icon) and after a restart; status and navigation bars take the theme's
   colours in Day and Night.
