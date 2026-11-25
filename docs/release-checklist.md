# Pre-release browser checklist

CI proves the embed is servable and the stroke data is reachable
(`scripts/smoke-embed.sh`) and drives the main flows in Chromium (the `e2e`
job), but it does not look at pixels. Before tagging a
release, run the built image or `go run ./cmd/qinqin serve` with a fresh build
and walk through this in a real browser (desktop Chrome or Firefox, plus one
phone-width window):

1. Sign in; the home page loads without console errors.
2. Open a character entry (for example 好). The stroke diagram appears; **Play**
   draws the strokes in order and stops; **Loop** repeats until switched off;
   a character with many strokes (for example 趣) animates to the end.
3. Open a Japanese kanji entry: the stroke diagram and readings render.
4. The heatmap widget on the home page renders cells for the last weeks and
   shows a value on hover or focus.
5. Reload a deep link (for example `/entry/5`): the page loads, not a 404.
6. Sources page lists the packs; each licence text link
   (`/ARPHICPL.TXT`, `/OPENCC-JS-LICENSE.TXT`, `/FIGTREE-OFL.TXT`) opens.
7. A hard reload after the previous release picks up the new UI (index is
   `no-store`; hashed assets are cached for a year).

## What the browser suite already covers

The `e2e` CI job (`apps/web/e2e`, [Development](wiki/Development.md#browser-end-to-end-tests)) drives
Chromium through signing in, a study session (grade changes, mixed card types), the reader popup, offline
study and its sync, and the phone bottom bar. It does not look at pixels, stroke animations, the heatmap or
licence texts, and runs no other browser, so the walk-through above stays; the wiki page lists everything the
suite leaves to a person.
