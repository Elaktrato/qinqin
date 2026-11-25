# The Android app

The Android app is the qinqin web app in a native shell. It has no server of its own: you give it the address of **your** qinqin server and it opens that server's web app, so every screen, rule and feature is the one your server runs, at your server's version. A server update reaches the phone with no app update.

Status: not yet published. The first builds come with the Android releases (#147); until then it is built from source (see [Development](Development#android-app)).

## Install

Install the APK of a release (Play Store and F-Droid listings are planned), then open **qinqin**.

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

## Offline

Offline start and study work as in the browser, through the web app's own service worker ([Install and offline](Install-and-offline)): the same decks, queue and outbox, the same limits. That needs **https** (or `localhost`): over plain http on a home network a browser does not allow a service worker, and neither does the app, so without a connection to the server it shows its first screen with **Try again** instead of your decks. Use an https address if you want offline study. The very first start needs the server too: nothing is saved yet.

Checked in an Android emulator by CI on a pull request that changes the shell, the web app's door to it, the service worker, the offline and study code or the back-button overlay code (not on every change, and not yet on a physical phone): the service worker registers, the app opens from its cache with the server down in about 1 to 3 seconds, a study session offline is saved, and the reviews reach the server exactly once when it is back, also across app restarts.

What is stored on the phone is small: the app shell (about 3 MB) and the cards the web app prepared (about 20 KB per card, plus the stroke data of the characters you wrote). Dictionaries, audio and the stroke data packs stay on the server. The WebView allows about 60 % of the phone's free-disk space, so space is not a limit, and the data is in the app's private area: clearing the app's storage in Android's settings (or **Settings, Account, App, Clear offline data**) removes it. The app asks Android to keep it, but the WebView may say no; the data is not removed by Android's cache cleaning. Reviews graded offline reach the disk a few seconds after the grade: open the app online after an offline session, and do not kill the app in the first seconds after grading.

The session token is kept in the app's private web storage like in a browser; it is not in backups, and ending the session on the server (Settings, sessions) invalidates it.

The outbox is sent when the app opens, when it returns to the front and when the phone reports a connection; there is no background work.

## Notifications

Not yet. Local reminders are planned (#137) and will need the Android notification permission, asked only then.

## For the person running the server

See [Reverse proxy](Admin-proxy-and-rate-limiting#the-android-app) for what a proxy must allow, and [record 0010](https://github.com/Elaktrato/qinqin/blob/develop/docs/architecture/0010-android-shell-and-native-bridge.md) for how the shell works.
