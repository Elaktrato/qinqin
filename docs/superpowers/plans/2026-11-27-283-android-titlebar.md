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

(filled in as the work goes)

## Local follow-up

(see below, filled in with the work)
