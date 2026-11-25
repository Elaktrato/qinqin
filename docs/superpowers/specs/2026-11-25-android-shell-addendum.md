# Android shell: addendum to the design (#34)

Status: builder's addendum to `2026-11-23-android-shell-design.md` (approved). It fixes what that design left to the
builder; the decisions are `Ruling:` lines in `../plans/2026-11-25-android-shell.md`, the structure is record
`docs/architecture/0010-android-shell-and-native-bridge.md`.

## What was built

- `apps/android`: Capacitor 8.6.2 (every package pinned exactly), one plugin (`@capacitor/app`, for the back button)
  plus the shell's own `QinqinShell` plugin.
- The first-run screen (bundled in the APK, vanilla TypeScript, qinqin Day/Night colours, English strings in one
  object): normalise the address, verify it with `GET /api/version` through CapacitorHttp, show the version, warn on
  a bridge mismatch, save, load. It is also the error screen when the saved server cannot be reached.
- Loading from a runtime address: `MainActivity` builds Capacitor's configuration at each start from the saved
  address. The bridge exists for that origin only.
- `apps/web/src/lib/native` (a no-op outside the shell): the back-button stack, system-bar colours, Change server.
- Docs: wiki page `Android.md`, the proxy section, record 0010.

## What the design left open, and the answer

- **Bridge for the server's origin only.** Verified in Capacitor 8.6.2's `Bridge.java` and `MessageHandler.java`: the
  document-start script and the `androidBridge` message listener are limited to the allowed origin rules (the
  `server.url` origin plus the local `https://localhost` origin); other hosts are sent to the system browser by
  `Bridge.launchIntent`. A runtime-navigation approach cannot work: the rules are fixed when the bridge is created.
- **Server CSP.** None is sent today (`browserHeaders` sets `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`
  only; `apps/web/svelte.config.js` has no `csp`). The bridge script is injected by the WebView
  (`WebViewCompat.addDocumentStartJavaScript`), not by the page, so a CSP would not block it.
- **Offline.** The service worker needs a secure context; the shell does not change that. A saved server that
  cannot be reached and has no service worker gets the first-run screen's error with Retry and Change server.
- **Safe areas and keyboard.** `viewport-fit=cover` is already in `app.html`; the frame, the bottom bar, the sheet
  and the drawer already use `env(safe-area-inset-*)`. Capacitor 8's core `SystemBars` plugin passes the insets to
  the page (WebView 140+) or pads the window (older), and lifts the window above the keyboard; no keyboard plugin.
