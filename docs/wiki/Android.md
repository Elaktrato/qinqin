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

**Change server:** account menu (the avatar), **Change server**. It forgets the address and returns to the first screen. If the saved server cannot be reached at start, the first screen comes back with **Try again** and **Change server**.

## What the app does for you

- The **back button and gesture** close an open menu, dialog or sheet first, then go back in the app's history, and at the first page send the app to the background.
- **Links to other websites** open in your browser, never inside the app.
- The **status and navigation bars** follow the theme (qinqin Day and Night, or yours); the page draws under them and keeps clear of notches and the gesture bar. The keyboard does not cover the field you type in.
- Only your server's address gets the app's native features; no other site can use them.

## Offline

Offline start and study work as in the browser, through the web app's own service worker ([Install and offline](Install-and-offline)): the same decks, queue and outbox, the same limits. That needs **https** (or `localhost`): over plain http on a home network a browser does not allow a service worker, and neither does the app, so without a connection to the server it shows its first screen with **Try again** instead of your decks. Use an https address if you want offline study. The very first start needs the server too: nothing is saved yet.

## Notifications

Not yet. Local reminders are planned (#137) and will need the Android notification permission, asked only then.

## For the person running the server

See [Reverse proxy](Admin-proxy-and-rate-limiting#the-android-app) for what a proxy must allow, and [record 0010](https://github.com/Elaktrato/qinqin/blob/develop/docs/architecture/0010-android-shell-and-native-bridge.md) for how the shell works.
