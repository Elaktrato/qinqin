# Install as an app and study offline

qinqin is an installable web app (PWA). It is a stopgap for phones; a native Android client is planned.

## Requirements

HTTPS, or `http://localhost` on the same machine. Over plain HTTP (including a LAN address such as `http://192.168.1.20:8080`) browsers do not allow installing or offline use: the site works as before, without installing or offline use, and Settings → Account → App says so ("This server is reached over plain HTTP, so qinqin works as an ordinary website here."). Ask your administrator for an HTTPS address ([Reverse proxy, rate limiting and trusted proxies](Admin-proxy-and-rate-limiting)).

## Installing

- Chrome or Edge (Android, desktop): Settings → Account → App, **Install qinqin**, or the browser's own install entry.
- iPhone and iPad (Safari): Share, then Add to Home Screen. Safari has no install button, so the app has none.
- Firefox for Android: menu, Install. Firefox on the desktop cannot install web apps.

## What works offline

The app opens. Your decks and today's study queue (the cards a session started now would hold, plus the next 50 new cards, within your daily limits and vacation days) are saved on the device whenever you use the app online, and then up to 200 more of the cards **Study all** would add (due reviews first), so a Study all session offline has its words too; a larger Study all session offline shows only the saved ones (500 words at most in all). Offline you study those real cards and grade them; the reviews wait on the device. The day, vacation and limits follow the same rules offline: the time zone you set is saved with your data, and "today" is computed on the device.

A line at the top says what is happening: "You're offline. Study works with saved cards.", "You're offline. 3 reviews are saved on this device and will be sent when you're back online.", "Can't reach the server. Showing saved data from …", and "All reviews sent." once they have left. Your theme is remembered on the device too, so the app starts in your colours ([Appearance and themes](Appearance-and-themes)).

Your study data is read page by page (the paged sync pull), and each page is saved as its own copy, so offline study reads the same pages in the same order; preparing for offline use reads them all. The stroke-order animations of characters you have opened online are saved too: the server now serves them from its stroke data pack, one file per character, so a character never opened online has no animation offline. Font pack slices (the pieces of an installed hanzi or kanji face) are saved the same way, once the page has shown their characters online. The web app does not download data packages (dictionaries stay online); a native client will.

## What does not work offline

The Reader, search, the journal, grammar lessons, dictionary lookups, settings changes, adding or editing cards, level sessions, and companion cards a word does not have yet (sentence, writing, tone, reverse and cloze cards: creating one is a write; the session says "Companion cards return when you are online."). Audio is not saved.

## Sync

A review is sent when you grade it. If the server cannot be reached it waits on the device, kept for your account only, and is sent when the browser goes online, when you return to the app, and once a minute while the app is open. A review sent twice still counts once. There is no background sync: on iOS and in any browser, reviews leave the device when you next open the app.

## Several people on one device

Saved data is kept per sign-in: a different user gets an empty saved copy and the old one is deleted. The same user signing in again also starts with an empty copy. Signing out deletes the saved copies; if reviews have not been sent, qinqin asks first ("Sign out with unsent reviews?": **Stay signed in**, the default, or **Sign out and delete them**). Reviews left behind by a session that ended otherwise stay on the device for that user only and are sent after the same user signs in again; they are deleted after 30 days. They are never sent under another account.

## Signed-out sessions

If your session was revoked while you were offline (it expired, you ended it on another device, an administrator forced a password change), you can keep studying the saved cards until the device reaches the server. Then the server refuses the session, the saved copies are deleted and you sign in again; the waiting reviews are sent after that sign-in. A session that must first change its password or set up two-step sign-in never studies: the app shows only the page you may use, and waiting reviews stay on the device.

## Updates

A new version downloads in the background and a bar says "A new version of qinqin is available. Reload". Nothing changes under an open page until you press Reload.

## Settings → Account → App

Shows the install button (or "qinqin is installed on this device"; on iPhone and iPad the Share hint), what is saved for offline use ("Offline: ready - 70 cards saved at 09:12", or "not prepared yet"), the storage in use, and **Clear offline data** (saved copies only; waiting reviews are kept).

## Limits, honestly

Safari may delete a site's saved data after about a week without use (installed home-screen apps are treated more kindly) or under storage pressure. A review that has not been sent is only as safe as the device: open the app online to send them. Safari has no install prompt and no background sync. There are no push notifications. Private browsing windows keep nothing.

**Not verified in a browser by the developers:** installation on Android, iOS and desktop, offline behaviour on real devices and the update flow. These are covered by unit and component tests and by checks of the served files and headers.
