# Native device features (#36) — plan

Design basis: `docs/superpowers/specs/2026-11-23-android-shell-design.md`, ADR 0010. Everything the web app does
with the phone goes through `apps/web/src/lib/native/`, which does nothing in a normal browser (feature-detect on the
injected `window.Capacitor`, no `@capacitor/*` import). No native screens. The shell grows **only own small Java
plugins** (androidx only, no new Gradle dependency, no Play Services); the one stock plugin stays `@capacitor/app`.

## Pieces

| # | Piece | Shell (Java) | `lib/native` | Web use | Bridge feature |
|---|---|---|---|---|---|
| 1 | Device voice | `SpeechPlugin` `QinqinSpeech` on `android.speech.tts.TextToSpeech` | `speech.ts` | `audio/player.ts`, `PlayButton`, `canSound`, Settings > Audio (hint + "Voice settings") | `tts` |
| 2 | Camera / photo picker | none (Capacitor's `BridgeWebChromeClient` handles the file chooser; `CAMERA` stays **undeclared**, so the system camera app is used and no permission prompt appears) | none | `PhotoImport`: two inputs, "Take a photo" (`capture`) and "Choose a photo" (gallery picker; `capture` makes the chooser camera-only) | none |
| 3 | Save a backup | `FilesPlugin` `QinqinFiles`: Storage Access Framework `ACTION_CREATE_DOCUMENT`, chunked write | `files.ts` `saveFile(name, mime, blob)`, `downloadUrl` | `YourData`, `ServerBackup`, `RecoveryCodes` | `files` |
| 4 | Share out / in | `SharePlugin` `QinqinShare`: `ACTION_SEND` chooser; `MainActivity` takes `ACTION_SEND text/plain` and `ACTION_PROCESS_TEXT` into `IncomingStore` | `share.ts`, `incoming.ts` | Share on the entry page and the search sentence; lookup opens `/search?q=` once signed in | `share` |
| 5 | Awake + haptics | `QinqinShell.keepAwake`, `.vibrate` | `awake.ts` (also Screen Wake Lock in browsers), `haptics.ts` | study session; Settings > Study "Vibrate on grading" | `keep-awake`, `haptics` |
| 6 | Notifications groundwork | `NotificationsPlugin` `QinqinNotifications` + `ReminderReceiver` + `BootReceiver` | `notifications.ts` | none yet (#137-#139) | `local-notifications` |

Contract: the server's bridge block lists `tts`, `files`, `share`, `keep-awake`, `haptics`, `local-notifications`;
contract 2 to 3; `SHELL_BRIDGE` in the first-run screen advertises the same; fixtures updated.

## Tasks (test first for logic)

1. Java pure logic + JVM tests: `SpeechLangs` (language candidates, rate and text limits), `IncomingText`
   (sanitise and cap shared text), `ReminderSpec` (validate and encode the stored schedule).
2. Java plugins, manifest (`queries` for the TTS service, `VIBRATE`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`,
   intent filters), `./gradlew testDebugUnitTest assembleDebug`.
3. `lib/native` modules, each with jsdom tests for the browser no-op and a faked shell.
4. Web call sites; haptics setting row `gradeHaptics` + `settings/workspace-settings.json` fixture.
5. Server bridge block, contract CHANGELOG, `SHELL_BRIDGE`, fixtures, ADR 0010, wiki, emulator driver.

## Rulings

- Ruling: own Java plugins, no `@capacitor-community/*` and no `@capacitor/camera`, `filesystem`, `share`,
  `local-notifications` — each needed 30-150 lines of Java we control, none adds a Gradle artifact, F-Droid scanning
  stays trivial. Cost if wrong: maintaining ~600 lines of Java ourselves.
- Ruling: no `CAMERA` permission — the system camera app captures into a FileProvider file; nothing to prompt, nothing
  to revoke. Cost if wrong: if a device lacks a camera app the chooser falls back to the gallery picker.
- Ruling: backups are saved through the Storage Access Framework (the person picks the folder, Downloads is the
  default), not `MediaStore`/`WRITE_EXTERNAL_STORAGE`: works on API 24-36 with no permission. Cost if wrong: one extra
  tap compared to a silent save to Downloads.
- Ruling: shared text is untrusted data: control characters dropped, 2000 characters cap (Java and web), shown only
  as a search query (never HTML), queued until the session is ready. Cost if wrong: a long sentence is cut.
- Ruling: grading haptics is a **workspace setting `gradeHaptics`, default on**, and only does something where a shell or
  `navigator.vibrate` exists. Cost if wrong: a person who dislikes it flips one switch.
- Ruling: device-voice rate 0.9 for learners. Cost if wrong: a constant to change.
- Ruling: notifications use **inexact** `setAndAllowWhileIdle` (no `SCHEDULE_EXACT_ALARM`; a reminder may be late by
  minutes under Doze). Stored schedules are re-armed after reboot and app update (`BootReceiver`, a SharedPreferences
  list; cheap). Cost if wrong: exact alarms need a special-access permission screen and Play review.
- Ruling: a tapped notification and a shared text reach the web app through one queue (`QinqinShare.takeIncoming` plus an
  `incoming` event), validated in the web app (in-app path only). Cost if wrong: another route to validate.

## Licence and dependency record

No new Gradle or npm dependency. Used: `androidx.core` (NotificationCompat, FileProvider; Apache-2.0, already
present through appcompat), Android framework APIs. Verified 2026-11-25 with `./gradlew :app:dependencies --configuration releaseRuntimeClasspath`: the tree is
unchanged by this work (androidx, Kotlin stdlib, Capacitor 8.6.2, `@capacitor/app` 8.1.2 as before); the only
`com.google.*` artifact is `com.google.guava:listenablefuture:1.0`, the empty Apache-2.0 placeholder androidx
pulls in; no `com.google.android.gms`, no Firebase. The new manifest entries are normal permissions
(`VIBRATE`, `RECEIVE_BOOT_COMPLETED`) plus `POST_NOTIFICATIONS`, asked at run time only by a feature that needs it.

## Review fixes (stage 2)

- Ruling: "Change server" goes through `ServerStore.forget` (all three paths: `ShellPlugin.clearServer`,
  `MainActivity.load`, `onNewIntent`), which cancels every stored alarm and every shown notification, then clears the
  address. Native only, not also in `lib/native` — the launcher shortcut has no web page, so the native side is the one
  place all paths share. Cost if wrong: none visible; the call is idempotent. No JVM test for the cancel itself (needs a
  `Context`; the repo has no Robolectric) — only the pure parts are tested.
- Ruling: after a local study change whose facts or plan cannot be fetched, the scheduler cancels **all** device
  notifications (not only today's): the port has no "list pending" and later days' counts are projections from the same
  facts. They return at the next successful replan. Stale mark is in memory only (an app killed offline right after a
  review keeps old text until the next open). Cost if wrong: a person offline for days after studying gets no
  notifications; the cheaper wrong text was judged worse.
- Ruling: counts changed on another device cannot be fixed offline (documented), and the 7-day horizon is documented
  (wiki, ADR 0011) with a native background replan as a follow-up. The web app now also replans on foreground
  (`visibilitychange`) and `online`, through the debounced facts publisher. Cost if wrong: one extra plan fetch per resume.
- Ruling: `EXTRA_ROUTE` is no longer read from any intent. The notification tap opens `NotificationTapActivity`
  (`exported=false`, so no other app can start it), which hands the route to `IncomingStore.pushRoute` in-process and
  starts `MainActivity` with a plain MAIN intent. A private action name on the exported activity would not be safe
  (any app can send any action/extra to an exported component). `IncomingText.route` / `routeHref` also reject `..`,
  dot segments, `%2e`, `%5c`, backslash, `//` and anything not starting with a single `/`. Cost if wrong: one extra
  (invisible) activity hop on a tap; a legitimate path containing `..` is refused.
- Ruling: `cancel()` ends the device scheduler for good (a `stopped` flag checked between steps, and cancel waits for the
  running replan before `cancelAll`). The scheduler is per session, so nothing needs it to restart. Cost if wrong: a
  scheduler reused after cancel would stay silent. The port's batch `schedule` loop is not interruptible; cancel's
  trailing `cancelAll` removes whatever it added.
- Ruling: a 401 that expires the session now runs `forgetThisDevice` too (browser unsubscribe and remembered id; the
  server DELETE may be refused for lack of a token, and the row is pruned by the push service's 404/410 at the next
  send). A user switched under a tab is not covered. Cost if wrong: a stale server row until the next push.
