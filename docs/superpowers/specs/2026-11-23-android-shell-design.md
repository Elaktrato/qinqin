# Android app — the web app in a native shell

Status: approved by the owner on 2026-11-23. Replaces the "native Kotlin (Jetpack Compose, Room)" client plan
(main design's 2026-11-14 amendment; issues #34–#38 as first written).

## Why

The owner wants **all of qinqin on Android, as on the web**. A native Kotlin rebuild would reimplement every
screen and every shared rule, and then build every future feature twice. The web app is already an installable
app that works offline, with phone layouts, the bottom bar (#188) and a writing pad the owner calls "perfect".
Wrapping it gives full parity at once and keeps every feature single-build.

## Approaches considered

- **A: native Kotlin (the old plan).** Most native feel and control, but the highest cost now and for every
  future feature.
- **B: the web app in a native shell (Capacitor) — chosen.** One codebase, parity on day one; native pieces only
  where the browser falls short.
- **C: mixed.** Native screens where they matter most, the web app elsewhere. Two UI styles and double builds
  for those screens; reachable later from B, screen by screen, if ever needed.

## Design

**Shell.** A Capacitor Android project in `apps/android` (the exact Capacitor version pinned by the builder).

**Where the web app comes from (call made during design; the owner may revisit).** The shell loads the web app
**from the user's own qinqin server** (the URL they enter), not a copy bundled into the APK:
- the SPA calls its API with relative paths (`/api/...`), so it talks to the server it came from with no CORS
  or extra configuration;
- the web app's version always matches the server's, which matters for self-hosted servers on different
  versions;
- every server update reaches the phone without an app update;
- offline start and offline study come from the existing service worker, precache and outbox.
The APK bundles only a small native first-run screen: "Server address", checked by calling the server's version
or health route, then opening it. A "Change server" action is reachable from the app's menu.

**Native pieces (through Capacitor plugins).** Only where the WebView falls short:
- **secure storage** for the session token (Android Keystore), if the web's storage isn't adequate inside the
  shell;
- **text-to-speech** for the "device voice" audio fallback (the WebView's `speechSynthesis` is unreliable);
- **files:** camera and photo picker for journal photo import, downloads and sharing for backup exports;
- **share:** share out (an entry, a sentence) and receive shared text (opens a lookup or, later, reader import
  #69);
- **screen awake** during study sessions, optional haptics on grading;
- **system bars** coloured from the active theme's tokens; safe areas; the Android back button and back gesture
  mapped to the web app's history (and closing sheets, menus and dialogs first);
- **notifications:** local notifications as the groundwork for reminders (#137). Push comes with #139's
  design, and the F-Droid build needs a variant without proprietary push libraries.

**Large offline data.** The data packages (dictionaries per language, strokes, audio) must work offline in the
shell as on the web. If the WebView's storage quota or eviction rules make that unreliable, store the packages
through native file storage and serve them to the web app via the bridge. The builder measures first.

**What does not change.** The web app, the server's API, and `docs/contracts/` stay the source of truth. The
contracts were written for a Kotlin client; most of that reimplementation falls away, but they still bind the
server and the web app, and they stay as they are.

**Releases** (#147–#149):
- CI builds a signed APK and an AAB, with the version taken from the release tag;
- the signing key is held as repository secrets;
- Play Store and F-Droid listings. F-Droid needs an open-source licence file in the repository (none exists
  today; the owner chooses), a build without proprietary dependencies, and ideally reproducible builds.

## Left to the builder

The Capacitor version and plugins; how the first-run screen looks (house theme); how http is handled for servers
on a home network (recommendation: HTTPS required, plain http allowed only for private addresses with a
warning); whether the token needs native storage; whether packages need native storage (measure first); and how
the Android build is tested (an emulator in CI with Playwright's Android/WebView automation, or similar).

## Storage and offline measurements (#35)

Measured on 2026-11-25 by the `android-emulator` workflow (`.github/workflows/android-emulator.yml`, driver in
`apps/android/e2e/`): Android 14 (API 34, google_apis, x86_64, 8 GB data partition), the WebView that image ships
(Chromium 113), the debug APK, the real server binary with the real SPA, a learner with four Japanese cards. The
server is reached with `adb reverse`, so the app's address is `http://localhost:8085` (private http, and a secure
context: the service worker registers; a LAN IP over plain http would not get one, as the wiki says). The driver
speaks the Chrome DevTools Protocol to the WebView's socket; no Playwright. Run 45562976959 (all steps green, 8 min
in all; the numbers below are from it and the runs before it, which differ by noise only).

**Service worker and offline start (a).** Registered (scope `http://localhost:8085/`, state `activated`) and
controlling after one reload, with the Capacitor bridge present on the server origin. After the app's own offline
preparation ("Offline: ready - 4 cards saved", 6.5 s) the server was stopped (and airplane mode switched on), the app
force-stopped and started: it opens from the cache ("Can't reach the server. Showing saved data" or "You're
offline. Study works with saved cards."), with no first-run error screen. Cold start by `am start -W`: first run
(first-run screen) 2.1 to 4.3 s; online with the service worker 1.0 to 2.1 s, until the page has text 2.0 to 4.8 s;
offline 0.8 to 1.4 s, until text 1.9 to 3.5 s. Offline start is not slower than online.

**Airplane-mode session with exactly-once sync (b).** Offline, four cards were studied in the real UI (grades
Again, Hard, Good, Easy), the banner said "4 reviews are saved on this device", the app was force-stopped and started
again offline (the outbox still held 4), then the network and server came back: the outbox drained in 2.1 s
("All reviews sent."), the server holds exactly 4 review events with 4 distinct ids and the four grades, and two
more restarts later it still holds 4. Caveat: the emulator's airplane mode did not always change `navigator.onLine`
(on one run it did, and the `online` event path was used; on the last it did not, and the one-minute poll or the
start flush did the work). Neither path duplicated a review.

**Storage quota and eviction (c).**

| What | Measured |
|---|---|
| `navigator.storage.estimate()` quota | 4,981,238,169 bytes (about 60 % of the 8.1 GB data partition: the quota follows the disk) |
| usage after the offline preparation of 4 cards | about 5.0 MB (caches 4.97 MB: the app shell 149 entries, 3.3 MB; the credential partition 18 entries, 73 KB; no IndexedDB; 13 KB of service-worker registrations) |
| writing 32 MB cache entries up to 1 GiB | no error; the quota is not near |
| `navigator.storage.persisted()` after the app asked | false |
| `navigator.storage.persist()` called by the driver | false (the WebView refuses, as Chrome does for a page that is not an installed app) |
| cache entries after force-stop + `pm trim-caches` + relaunch | all kept (167 before, 168 after) |

What the web app stores offline is small. It does **not** download data packages: dictionaries, audio and the stroke
pack stay on the server, and offline holds only the study round's entries, the strokes of the characters of writing
cards that were opened, font slices and the app shell. Sizes of the real data, for scale: the bundled packs in
`plugins/data` total 36 MB (JMdict 11 MB, Unihan 8 MB, Jiten frequency 6 MB, CC-CEDICT 3.9 MB); the stroke data is
9,574 characters, 32 MB in all, 3.4 KB per character (at most 8.6 KB); the Kanji alive audio pack baked into the image
is about 69 MB (10,156 clips). A full offline round is at most 500 entries and the strokes of their characters: with
the measured 18 KB per card (entry, API reads) that is under 10 MB plus at most 3.4 MB of strokes for 1,000
characters; the app shell is 3.3 MB. Even the whole 32 MB of stroke data would be under 1 % of the quota.

Ruling: no native file storage for data packages; the WebView's Cache API stays the only offline store — the needed
space is 5 to 20 MB against a 5 GB quota, a 1 GiB write succeeded, entries survive a force-stop and cache trimming,
and the web app downloads no package that could be large — if wrong (a future web feature that downloads packages
of 100 MB or more, or a device whose storage is evicted), a native package store behind `lib/native` and a plugin
that serves files to the service worker, which is a new plugin and a serving rule, not a rewrite. Revisit with a
measurement when packages move to the device.

Ruling: the shell asks for persistent storage once (`requestPersistOnce` counts the shell as installed), although
the WebView answers false — the request is free and a WebView that grants it (another vendor, a later version)
protects the data — nothing depends on the answer; the data lives in the app's private directory and a trim of
caches did not touch it. Not testable here: eviction under real low-disk pressure; a phone restart (the data is on
disk and a force-stop and a process kill kept it).

**A durability risk found: unsent reviews in localStorage.** The outbox is localStorage, which Chromium writes to
disk a few seconds after a change. On two emulator runs a process kill within seconds of grading lost reviews that
were already shown as saved: a force-stop right after the session lost 2 of 4, and an Android kill 1 s after the
last grade (Play Services restart on the emulator image) lost 3 of 4. With the kill 8 s or later after the last
grade all 4 survived and were sent once. So a review graded offline is at risk for about 5 s after the grade if the
process dies (crash, battery pull, the system kills a foreground app); a normal swipe-away or home press leaves
that time. Not a blocker for this issue, and the same in a browser, but a follow-up should move the outbox to
IndexedDB (committed when the transaction ends) or flush on `pagehide`; the web app's study data layer owns it.

**Session token (d).** The token is the bearer string in `localStorage` under `qinqin.token`
(`apps/web/src/lib/api/client.ts`); there is no session cookie, so the cookie store and its flush do not matter. In
the shell it lives in the WebView's data in the app's private directory (`allowBackup` is off, so not in cloud or
adb backups; other apps cannot read it; `run-as` works only on debuggable builds). It survives a restart (every
relaunch above was signed in) and is gone with an app-data wipe or uninstall. A token is revocable on the server
(session list, forced password change) and the password is never stored.

Ruling: the session token stays in the WebView's web storage; no Keystore plugin — Keystore protects against
another app or a backup reading the file, which `allowBackup=false` and the sandbox already stop without root, and
it does not protect against the real exposure, a script on the page, because the page would have to read the token
back from the plugin to send it; a plugin costs about 150 lines of Java, an async token read before the first API
call, a change in `client.ts`'s synchronous `getToken()`, and a library or own cipher code to keep — if wrong (a
rooted-device or malware threat the owner wants covered), a `lib/native` token store behind the same `getToken`
and a plugin using `EncryptedSharedPreferences` or the Keystore directly, plus a one-time migration of the stored
token, and sessions can be revoked meanwhile.

**Two defects found and fixed here.** (1) The web app's back handler assumed `App.addListener` returns a promise;
the injected plugin proxy returns the handle itself, so `startBackHandler` threw `then is not a function` in the
layout and the page stayed blank on the real device: `lib/native/back.ts` now accepts both (a jsdom test covers the
synchronous handle). (2) Without `ACCESS_NETWORK_STATE` the WebView cannot see the network, so `navigator.onLine`
stays true and the web app's `online`/`offline` events never fire; the manifest now declares it (a normal
permission, no prompt), and `navigator.onLine` followed airplane mode on the run after that. Ruling: declare
`ACCESS_NETWORK_STATE` — the web app's offline banner and outbox flush listen to those events — a missing
permission would show the offline state only after a request fails and delay a flush to the next poll.

**Not verified:** a physical phone (the done-when item "airplane-mode test on a real phone" and a phone restart
remain for the owner), the reader and dictionary offline (they are online-only in the web app), eviction under disk
pressure, other WebView versions (the image's is Chromium 113; a phone's is current and updates by itself), the
writing pad on touch, the bridge's absence on a foreign origin.
