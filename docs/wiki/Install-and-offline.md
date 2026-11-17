# Install as an app and study offline

qinqin is an installable web app (PWA). It is a stopgap for phones; a native Android client is planned.

## Requirements

HTTPS, or `http://localhost` on the same machine. Over plain HTTP (including a LAN address such as `http://192.168.1.20:8080`) browsers refuse service workers: the site works as before, without installing or offline use, and Settings, Account, App says so. Ask your administrator for an HTTPS address ([Reverse proxy, rate limiting and trusted proxies](Admin-proxy-and-rate-limiting)).

## Installing

- Chrome or Edge (Android, desktop): Settings, Account, App, **Install qinqin**, or the browser's own install entry.
- iPhone and iPad (Safari): Share, then Add to Home Screen. Safari has no install button, so the app has none.
- Firefox for Android: menu, Install. Firefox on the desktop cannot install web apps.

## What works offline

The app opens. Your decks and today's study queue (the cards a session started now would hold, plus the next 50 new cards, within your daily limits and vacation days) are saved on the device whenever you use the app online. Offline you study those real cards and grade them; the reviews wait on the device. The time zone is saved with your data, so "today" is computed on the device.

Your study data is read page by page (the paged sync pull), and each page is saved as its own copy, so offline study reads the same pages in the same order; preparing for offline use reads them all. The stroke-order animations of characters you have opened online are saved too: the server now serves them from its stroke data pack, one file per character, so a character never opened online has no animation offline. Font pack slices (the pieces of an installed hanzi or kanji face) are saved the same way, once the page has shown their characters online. The web app does not download data packages (dictionaries stay online); a native client will.

## What does not work offline

The Reader, search, the journal, dictionary lookups, settings changes, adding or editing cards, level sessions, and companion cards a word does not have yet (creating one is a write; the session says "Companion cards return when you are online."). Audio is not saved.

## Sync

A review is sent when you grade it. If the server cannot be reached it waits in a per-user queue and is sent when the browser goes online, when you return to the app, and once a minute while the app is open. Every review has its own id, so a retry never counts twice. There is no background sync: on iOS and in any browser, reviews leave the device when you next open the app.

## Several people on one device

Saved data is kept per sign-in: a different user gets an empty saved copy and the old one is deleted. Signing out deletes the saved copies; if reviews have not been sent, qinqin asks first ("Stay signed in" is the default). Reviews left behind by a session that ended otherwise stay on the device for that user only and are sent after the same user signs in again; they are deleted after 30 days.

## Updates

A new version downloads in the background and a bar says "A new version of qinqin is available. Reload". Nothing changes under an open page until you press Reload.

## Settings, Account, App

Shows the install button, what is saved for offline use, the storage in use, and **Clear offline data** (saved copies only; waiting reviews are kept).

## Limits, honestly

Safari may delete a site's saved data after about a week without use (installed home-screen apps are treated more kindly) or under storage pressure. A review that has not been sent is only as safe as the device: open the app online to send them. There are no push notifications.

**Not verified in a browser by the developers:** installation on Android, iOS and desktop, offline behaviour on real devices and the update flow. These are covered by unit and component tests and by checks of the served files and headers.
