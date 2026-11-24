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
