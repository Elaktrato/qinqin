# Pre-release browser checklist

CI proves the embed is servable and the stroke data is reachable
(`scripts/smoke-embed.sh`), but it does not look at pixels. Before tagging a
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
   (`/ARPHICPL.TXT`, `/OPENCC-JS-LICENSE.TXT`) opens.
7. A hard reload after the previous release picks up the new UI (index is
   `no-store`; hashed assets are cached for a year).

## Why not an automated browser job

A Playwright job would need a browser download (about 150 MB) per run and
canvas/SVG animation assertions that are timing-sensitive, for little beyond
what the HTTP smoke already guards (the data path and the embed). The cost is
not justified yet; revisit if the stroke or heatmap rendering regresses
unnoticed.
