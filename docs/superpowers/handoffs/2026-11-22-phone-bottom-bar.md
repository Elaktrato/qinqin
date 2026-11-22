# Phone bottom bar handoff — 2026-11-22

Issue [#188](https://github.com/Elaktrato/qinqin/issues/188), built from `develop` on `feature/phone-bottom-bar`
and merged `--no-ff` into `develop`. Design: `docs/superpowers/specs/2026-11-22-phone-bottom-bar-design.md`
(merged from `ccr-021a511a-kj8k4p` with this work; `develop`'s newer copy of the visual rework design was kept).
Nothing went to `main`, no tag, no release.

## 1. What shipped

- **The `nav-layout` row** (`qinqin-core`, user-global): `{"version": 1, "phone": "bar" | "drawer", "bar": [ids]}`.
  Parse, write and the bar's items are specified in `docs/contracts/settings/README.md` with the fixture
  `docs/contracts/settings/nav-layout.json` (`parse`, `write`, `items`), decoded by the web tests
  (`lib/frame/navLayout.test.ts`, `barItems.test.ts`) and pinned on the server for sync and backup/restore
  (`server/cmd/qinqin/core_nav_layout_test.go`, `server/internal/backup/nav_layout_test.go`; no server code: the
  generic plugin-row path carries it).
- **The five-item rule** (`lib/frame/barItems.ts`, pure): all sections when five or fewer are visible, else four
  pins and More; More is current when the page belongs to one of its rows.
- **The bottom bar** (`lib/frame/BottomBar.svelte`): icon with a label, the current item in the accent with a short
  mark under the label, 56 px tall items (≥ 44 px targets), above `env(safe-area-inset-bottom)`, `chrome` with a
  hairline on top, a `nav` landmark named "Main" (the desktop bar's name; only one is ever displayed),
  `aria-current="page"` on links and `aria-current="true"` on More. More opens the shared bottom sheet
  (`lib/ui/Sheet.svelte`) with the remaining sections and **Edit the bar** (`/settings?tab=layout#bottom-bar`).
- **The phone top bar** (`PhoneBar.svelte`): bar mode = title, page actions, flag, avatar (account menu), no menu
  button and no drawer. Side-menu mode is exactly as before.
- **Layout**: `--bottom-bar-height` (3.5rem) and `--bottom-bar-space` (0, or the bar plus the safe area while the
  bar shows) in `app.css`; the page panel's bottom padding and `scroll-padding-bottom` on `:root[data-bottom-bar]`,
  phone media query only; the scheduling and card-manager toasts rise above the bar. The study session
  (`/study/session`) hides the bar. `noBottomBar.test.ts` is replaced by `lib/frame/bottomBarRules.test.ts`.
- **Settings → Layout** (was Home; `?tab=home` is replaced by `?tab=layout`, the fragment kept): the home widgets,
  then **Phone navigation** (Bottom bar / Side menu) and the **Bottom bar** editor (switches "In the bar", Move up
  / Move down and drag, "Under More" for pins past the fourth, a live preview, Reset to default, the five-item
  rule in one line). Saves are optimistic, queued one at a time, and a failed save offers Retry / Discard.
- **Desktop and tablet (720 px and up)** do not change: `layout.dom.test.ts` compares the desktop bar's markup in
  both modes, and `bottomBarRules.test.ts` holds every bar rule inside the phone media query.

## 2. Rulings

- **Settings → Home renamed Layout**, tab id `layout`; old `?tab=home` links redirect (`RENAMED_TABS` in
  `lib/settings/tabs.ts`). The catalogue key `settings.tabs.home` is retired.
- **Fewer than four visible pins** with more than five sections: the bar shows those pins and More; it never fills
  the gap with unpinned sections (that would bring back a section the person just took out).
- **Pins past the fourth** go first under More, in pin order, then the unpinned sections in frame order.
- **Reading order**: the bar is rendered after the page (after `main`), outside the banner, as its own `nav`
  landmark; screen readers reach it after the content or through landmark navigation. No second skip link.
- **On-screen keyboard**: the bar hides (`display: none`) while the visual viewport is shrunk by more than 150 px
  (pinch zoom told apart by its scale), or while a text field has focus on a touch screen (for browsers that
  resize the layout viewport instead). Cost: on a touch screen with a hardware keyboard the bar hides while typing.
- **`viewport-fit=cover`** added to `app.html`, so `env(safe-area-inset-*)` is non-zero on phones without a home
  button; the frame pads by the top, left and right insets (0 on desktop browsers).
- **The mark** sits under the label: on the bar's top edge it read as an underline of the page text behind it.
- **Instant paint**: the last value read is cached on the device per user (`qinqin.navLayout.v1`), so a reload
  shows the person's mode at once; the row is re-read on sign-in, on opening Settings → Layout, and when the app
  comes back to the front (at most once a minute). Signing out clears it.
- **More as current**: a button cannot be "the page", so More carries `aria-current="true"` plus the same visual
  mark; the sheet marks the actual row with `aria-current="page"`.

## 3. What to check by hand (on a real phone)

1. **Both modes**: Settings → Layout → Phone navigation; switch between Bottom bar and Side menu; the top bar
   changes (avatar vs menu button) and the choice follows you to another device after reopening the app.
2. **The bar editor**: switch Journal or Stats into the bar, reorder, drag, watch the preview; with more than five
   sections only four pins plus More show; Reset to default.
3. **More**: opens the bottom sheet; the current section is marked there and More is marked in the bar; "Edit the
   bar" lands on the editor.
4. **The installed app** (home-screen web app): the bar sits above the home indicator; nothing hides behind it at
   the bottom of a long page (Settings, a deck list).
5. **The keyboard**: type in Search, the journal, an entry's note — the bar must not ride up over the field.
6. **The study session**: no bar; the docked grade buttons are unobstructed; leaving the session brings it back.
7. **A phone without a home button** (iPhone X or later, Android gesture navigation): the safe area under the bar;
   in landscape, nothing under the notch.
8. Desktop and tablet: nothing changed.

## 4. Gates

See the merge commit and §5 of this file for the final run.
