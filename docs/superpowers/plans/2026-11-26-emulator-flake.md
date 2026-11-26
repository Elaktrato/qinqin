# Emulator flake: root cause and fix (2026-11-26)

The `android-emulator` jobs failed about one run in two ("Runtime.evaluate: no answer in 60 s", "DevTools socket
closed", now and then a Maven 429). Scope: CI and the e2e driver only (`apps/android/e2e`,
`.github/workflows/android-emulator.yml`); no product code.

## What the logs show

Twelve failed jobs and eight passing ones from 2026-11-25/26 were read (job logs and the uploaded `logcat.txt`).

- Boot time (27–39 s) and the Google Play services wait (`restarts: 0`, about 20.5 s) are the same in passing and
  failing runs. Not the cause. `Unable to connect to adb daemon on port: 5037` and the `default_boot` snapshot
  warning are in every run, passing ones too: noise.
- The shell logs `Capacitor: App destroyed` once per activity destroy. A passing run has **one**: the planned
  `recreate()` that opens the server page after the first-run screen. A failing run has **two or more**: the system
  relaunched `MainActivity` again, some seconds after the first page loaded (`WindowManager: finishDrawing of
  relaunch`, no `Schedule relaunch activity` line: not the shell's own `recreate()`). The process lives on (same pid),
  the WebView of the first page is destroyed (`Application attempted to call on a destroyed WebView`), the new page
  renders fine (the failure screenshot shows the signed-in Home), but the driver's DevTools socket is bound to the
  dead page: every `Runtime.evaluate` on it never answers or the socket closes, and every later step fails the same
  way. That is the whole "flake": 4 of 4 control runs with a second destroy failed; the one control run with a single
  destroy passed.
- The relaunch comes in a burst of package changes on the `google_apis` image (`PACKAGE_CHANGED`/`ADDED`/`DATA_CLEARED`
  broadcasts, Phenotype and Play services updating, `InputReader: Reconfiguring input devices, changes=KEYBOARD_LAYOUTS`).
  `am get-config` polled every second shows only window-inset changes (`h842dp`/`h818dp`), no `mcc`/`mnc`/`fontScale`
  change: **which configuration bit relaunches the activity is not found.** The manifest's `configChanges` list is the
  Capacitor default; a phone user would see the web app reload, not a hang.
- Other failures: Maven 429 (the build step never reached the emulator); a Google Play services death after the
  20 s quiet window that killed the app once (job 139610314117, `depends on provider ...FontsProvider in dying proc`);
  two `TypeError: Cannot read properties of undefined (reading 'Plugins')` in the native-plugins step (probably the same
  relaunch: `window.Capacitor` is missing on a page that is being replaced) and one IME text check in earlier runs;
  none of these recurred in the 17 runs of this branch.

## Fix (driver and CI only)

1. `recover.mjs`: counts `App destroyed` lines from a background `adb logcat Capacitor:D *:S`; a step that fails with a
   dead-page error **while a relaunch happened during it** attaches to the page that is on screen now (`reattach`) and
   runs once more (`Recorder.step`; the summary marks the step `retried`). A DevTools call pending on a page that was
   destroyed fails at once instead of after 60 s. Switched off with `E2E_RECOVER=0` (for A/B runs). Unit-tested
   (`recover.test.mjs`).
2. The first-run "Open" click is sent from a `setTimeout`, so its reply arrives before the page is destroyed (a
   reply raced the planned recreate and made the step look dead).
3. Maven 429: `~/.gradle` dependency cache (`actions/cache`), and the Gradle build is repeated (up to three attempts,
   60 s and 120 s apart) only when the log shows a network error; a compile error or unit test failure stops at once.
4. `workflow_dispatch` inputs for experiments: `target`, `cores`, `ram`, `recover`, `diag`; a dispatch with `suites`
   runs one emulator (matrix entry `custom`) instead of two.

## Measurements (core suites `shell,core`, `workflow_dispatch` on this branch)

| Variant | Runs | Pass | Unplanned relaunch seen |
|---|---|---|---|
| control (`recover=0`, google_apis, 2 cores, 3 GB) | 5 | 1 | 4 of 5, all four failed |
| recovery on (first commit) | 5 | 3 (+1 build failed on Maven 429) | 3 of 4, two recovered |
| recovery on + Open-click fix + longer backoff | 8 | 8 | 3 of 8 (two recovered by a retry, one fell between steps) |
| 4 cores, 4 GB, `recover=0` | 4 | 3 | 1 of 4 (passed by luck); the failure was a first-run page that never appeared |
| `target: default` (AOSP, no Google apps), `recover=0` | 4 | 4 | 0 of 4 |

Baseline from the history before this branch: about one core run in two failed.

## Rulings

Ruling: recover from an unplanned relaunch in the driver and keep the google_apis image — it is the one fix that
works on the image the app meets on phones (Play services, Phenotype, keyboard layouts), and it passed 8 of 8 — cost if
wrong: the relaunch still happens, so a step that is not safe to repeat could run twice (the retry is once, only after a
relaunch, only for dead-page errors; server-side effects of a step that died halfway are not undone), and the cause stays
unknown.

Ruling: do not move the job to the AOSP image (`target: default`) yet — it passed 4 of 4 with no relaunch and is the most
promising way to remove the cause, but the extended suites (IME composition, touch, perf) were not tried on it, it has
no Play services (the driver's Play services wait burns its full 120 s there), and four runs are a small sample — cost
if wrong: the job keeps one relaunch in about three runs, handled by the recovery.

Ruling: more cores and RAM are not the fix — 3 of 4 passed but one run still relaunched, and the other run failed on a
page that never appeared — cost if wrong: none, defaults unchanged.

Ruling: no Maven mirror (Google's `maven-central.storage-download.googleapis.com` would avoid the 429) — unsigned
third-party copies of the dependencies would enter the build with no dependency verification in the project — cost if
wrong: a cold-cache build can still fail after three attempts when many jobs start together (it happened once, 10
simultaneous runs); the cache fixes the warm case.

Ruling: no product change for the relaunch (for example more `configChanges` in the manifest, which includes no `mcc`,
`mnc` or `fontScale`) — the changing bit was not identified, and an unneeded entry would hide a real reload from the
web app — cost if wrong: a phone user could see the page reload once after a configuration change.

## Not verified

- The relaunch's trigger. `E2E_DIAG=1` shows no configuration change besides insets; a `dumpsys` of the activity's
  configuration at the moment of the relaunch (or `adb shell dumpsys activity activities` diffs) would name it.
- The extended suites (pages, ime, touch, perf) with the recovery; they run nightly now.
- The Gradle cache across pull requests: a cache saved on a PR ref is readable by that ref only; the nightly run on
  the default branch is what warms the cache for all PRs.
- Samples are small (5, 8, 4, 4 runs): 8 of 8 against 1 of 5 is clear, but it is not a rate to the percent.
