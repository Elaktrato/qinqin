# The Android app

The Android app is the qinqin web app in a native shell. It has no server of its own: you give it the address of **your** qinqin server and it opens that server's web app, so every screen, rule and feature is the one your server runs, at your server's version. A server update reaches the phone with no app update.

Status: the APK comes with each release (from v0.7.0), for sideloading. It is built and signed by the project owner on their own machine and attached to the GitHub release by hand, not by GitHub's servers. Play Store and F-Droid listings are planned. Building from source: see [Development](Development#android-app).

## Install

1. On the [releases page](https://github.com/Elaktrato/qinqin/releases) open the release you want and download `qinqin-<version>.apk` and `qinqin-<version>.apk.sha256`.
2. Check the download. On a computer, with both files in one folder:

   ```sh
   sha256sum --check qinqin-<version>.apk.sha256
   ```

   It must print `qinqin-<version>.apk: OK`. (On macOS: `shasum -a 256 -c qinqin-<version>.apk.sha256`. On Windows: `certutil -hashfile qinqin-<version>.apk SHA256` and compare with the text in the `.sha256` file.) The checksum shows the file arrived intact; it cannot prove who made it, because it sits beside the APK. Download from the project's releases page only. To check the signature as well, `apksigner verify --print-certs qinqin-<version>.apk` (Android SDK build-tools) prints the signing certificate; every release is signed with the same one, so compare its SHA-256 fingerprint (the `Signer #1 certificate SHA-256 digest` line) with the one printed in the release notes of the first Android release, or with `apps/android/release-fingerprint.txt` in the repository. A release signed with any other certificate is not from the project's key.
3. Copy the APK to the phone, open it, and allow your file manager or browser to install apps when Android asks ("Install unknown apps"). Then open **qinqin**.

Updates: install the newer APK over the old one; your server address and data stay. Android only installs an update that is signed with the same key and has a higher version, so a release APK never installs over a debug build (uninstall that first).

## Server address

The first screen asks for your server's address. Type it the way you would in a browser:

- `qinqin.example.org` becomes `https://qinqin.example.org`. A pasted page address (`https://qinqin.example.org/study`) keeps only the server part: qinqin lives at the root of its address.
- **https is required.** Plain `http://` is accepted only for addresses on your own network (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`, `localhost`, `*.local`, a bare name such as `nas`, IPv6 `fd..`/`fe80..`/`::1`), with a visible warning: anyone on that network can read what you send. On the Android emulator, the host computer is `http://10.0.2.2:PORT`.
- The app checks the address by asking it who it is (`GET /api/version`) and shows the version it found. Clear messages tell you when the server cannot be reached, does not answer in time, has a certificate this phone does not trust, is not a qinqin server (or older than 0.7), or redirects to another address (you can accept the new one in one tap). A warning appears when the app and the server disagree about what the app can do (update the app, or the server).
- Sign in as on the web. The address is kept on the phone; later starts go straight to your server.

**Change server:** account menu (the avatar), **Change server**, or long-press the app icon on the launcher and choose **Change server**. It forgets the address and returns to the first screen. If the saved server cannot be reached at start, or it answers with something that is not qinqin (an error page, a login or parked-domain page, a captive portal), the first screen comes back with **Try again** and **Change server**. The app asks the saved server who it is on each online start, in the background; being offline never triggers this, so the offline start still opens your decks. If Android System WebView is too old (it lacks the features that keep the app's native features to your server), the app refuses to open a server and says to update it.

## What the app does for you

- The **back button and gesture** close an open menu, dialog or sheet first, then go back in the app's history, and at the first page send the app to the background.
- **Links to other websites** open in your browser, never inside the app.
- The **status and navigation bars** follow the theme (qinqin Day and Night, or yours); the page draws under them and keeps clear of notches and the gesture bar. The keyboard does not cover the field you type in.
- Only your server's address gets the app's native features; no other site can use them.

### Phone features

Everything below is the same web app; the app only lends it the phone's parts. In a browser the same buttons do what the browser can (or nothing).

- **Device voice.** When a word has no recording and "Use device voice" is on (Settings, Workspaces, Audio), the app speaks with Android's own text-to-speech: Chinese with a zh-CN voice (else zh-TW or zh-HK), Japanese with a ja-JP voice, slightly slower than normal. If your phone has no voice for a language, Settings, Audio says so with an **Open voice settings** button: install a voice pack there (Android's text-to-speech settings, your engine, Install voice data). Without a voice no play button is shown rather than one that stays silent.
- **Photos for the journal.** **Take a photo** opens your camera app; **Choose a photo** opens the system picker. The app has no camera permission of its own: the camera app takes the picture. The web app still shrinks big photos before uploading.
- **Saving backups.** **Download** in Settings, Account, Your data (and the server backup, and the recovery codes) opens Android's save screen: pick the folder (Downloads is the usual one) and confirm. Cancel there and nothing is saved. A very large backup is held in memory while it is saved; on a phone with little memory prefer downloading it on a computer.
- **Share.** Entry pages and example sentences have a **Share** button (the system share sheet; a browser uses its own share or copies the text). An entry shares its word and first reading only, no dictionary text. Going the other way: **Share** from another app to qinqin, or select a text anywhere and choose **Look up in qinqin**: the lookup opens with that text (up to 200 characters, plain text). If you are not signed in yet it waits until you are.
- **Screen stays on** while a study session runs, and may sleep again at the end of the session or when you leave it.
- **Vibration on grading** (Settings, Study, Feedback, on by default, per workspace): a short buzz for a grade, a longer one for "Again". Also in phone browsers that support it.

## Offline

Offline start and study work as in the browser, through the web app's own service worker ([Install and offline](Install-and-offline)): the same decks, queue and outbox, the same limits. That needs **https** (or `localhost`): over plain http on a home network a browser does not allow a service worker, and neither does the app, so without a connection to the server it shows its first screen with **Try again** instead of your decks. Use an https address if you want offline study. The very first start needs the server too: nothing is saved yet.

Checked in an Android emulator by CI on a pull request that changes the shell, the web app's door to it, the service worker, the offline and study code or the back-button overlay code (not on every change, and not yet on a physical phone): the service worker registers, the app opens from its cache with the server down in about 1 to 3 seconds, a study session offline is saved, and the reviews reach the server exactly once when it is back, also across app restarts.

What is stored on the phone is small: the app shell (about 3 MB) and the cards the web app prepared (about 20 KB per card, plus the stroke data of the characters you wrote). Dictionaries, audio and the stroke data packs stay on the server. The WebView allows about 60 % of the phone's free-disk space, so space is not a limit, and the data is in the app's private area: clearing the app's storage in Android's settings (or **Settings, Account, App, Clear offline data**) removes it. The app asks Android to keep it, but the WebView may say no; the data is not removed by Android's cache cleaning. Reviews graded offline reach the disk a few seconds after the grade: open the app online after an offline session, and do not kill the app in the first seconds after grading.

The session token is kept in the app's private web storage like in a browser; it is not in backups, and ending the session on the server (Settings, sessions) invalidates it.

The outbox is sent when the app opens, when it returns to the front and when the phone reports a connection; there is no background work.

## Notifications

Study reminders are optional and off until you turn them on (Settings, Notifications): the app schedules them on the phone from the server's plan, with no Google service involved, and asks for the Android notification permission only then. See [Reminders](Reminders).

## For the person running the server

See [Reverse proxy](Admin-proxy-and-rate-limiting#the-android-app) for what a proxy must allow, and [record 0010](https://github.com/Elaktrato/qinqin/blob/develop/docs/architecture/0010-android-shell-and-native-bridge.md) for how the shell works.
