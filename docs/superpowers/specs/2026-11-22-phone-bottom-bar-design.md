# Phone navigation: a bottom bar, with the side menu as an option

Status: approved by the owner on 2026-11-22. Extends the visual rework design
(`2026-11-16-visual-rework-design.md`, §9 "Frame — phone"), which this changes for phones only.

## Why

On the phone, every section sits behind the menu button and a slide-out drawer, so moving between modes
(Decks → Reader → Search) costs two taps and a slide each time. The owner wants the sections one tap away, at
the bottom of the screen where a thumb reaches them, with the drawer kept as a choice for those who prefer it.

## Goals

- Below the phone breakpoint (`FRAME_PHONE_BREAKPOINT`, 720 px), a **bottom bar** of section icons is the
  default navigation.
- Each person decides, in their layout settings:
  - **Phone navigation:** bottom bar (default) or side menu (today's drawer).
  - **Which sections the bar shows, and their order.**
- The choice is stored per account, syncs, backs up, and applies to the Android app later.
- Desktop and tablet widths (720 px and up) do not change.

## Non-goals

- No change to the desktop top bar, the sections themselves, or their URLs.
- No bottom bar on desktop.

## Approaches considered

The problem: with everything switched on there are up to seven sections (Home, Search, Decks, Reader, Journal,
Grammar, Stats, plus future plugin pages), while a bottom bar fits about five.

- **A: you pick, plus "More" (chosen).** The person pins sections and their order in the layout settings. The
  rest are under a "More" item. Most flexible, and it belongs where the home layout is already configured.
- **B: a fixed set plus "More".** Simplest, but people who use Journal or Stats daily always pay an extra tap.
- **C: all sections in a sideways-scrolling bar.** No "More", but sections off-screen are easy to miss.

Owner picked A, with B's set as the default for people who never open the setting.

## Design

**The bar**
- At most **five items**. If all of the person's visible sections fit in five, they are shown in their chosen
  order and there is no "More". Otherwise the first **four pinned** sections are shown, and the fifth item is
  **More**.
- **Default pins** (no stored choice): Home, Decks, Reader, Search. With Journal, Grammar or Stats switched on
  that gives Home, Decks, Reader, Search, More.
- Home is in the bar because the phone has no logo to tap.
- **Items:** icon with a short label under it (small, muted). The current section has its icon and label in the
  accent colour and a short accent mark, following the lighter design rules (no pills, no filled
  backgrounds). Targets at least 44 × 44 px.
- **More** opens the shared bottom sheet (the one the reader's lookup and the journal's corrections use)
  listing the remaining sections with icon and label, the current one marked, and a last row
  "Edit the bar" linking to the setting. More is marked current when the current section is one of its rows.
- The bar sits above the safe-area inset (`env(safe-area-inset-bottom)`), uses `chrome` with a hairline on
  top, and pages get bottom padding and `scroll-padding-bottom` so nothing hides behind it (reintroduce a
  `--bottom-bar-height` token; remove the `noBottomBar.test.ts` guard and replace it with tests for the new
  rules).
- **Hidden in the study session**, which has its own docked grade buttons and an exit. Shown everywhere else.
  (Owner to confirm on a device; hiding in the reader while scrolling is a possible later refinement.)
- When the on-screen keyboard is open, the bar does not ride up over the content (hide it while the visual
  viewport is shrunk by the keyboard, or keep it under the keyboard).
- Accessibility: a `nav` landmark labelled like the desktop bar, `aria-current="page"` on the current item,
  visible focus, reduced motion respected, the bar reachable by keyboard and screen readers in a sensible
  order (after the main content in the reading order or via the skip link, decided by the builder with a
  note).

**The top bar on the phone**
- Bottom-bar mode: page title, workspace flag, avatar (account menu). No menu button.
- Side-menu mode: today's layout, unchanged (menu button, title, flag; the drawer).

**The setting**
- In the layout settings, next to the home widgets (Settings → Home, renamed "Layout" if that reads better,
  builder's call with a redirect for the old URL):
  - "Phone navigation": Bottom bar / Side menu.
  - "Bottom bar": the visible sections as rows with a switch "In the bar" and Move up / Move down (and drag),
    like the home widgets editor; a live preview of the bar; Reset to default.
  - It explains the five-item rule in one line ("Up to four sections, then More", or all five when they fit).
- The setting is visible on every device, so it can be prepared on desktop.

**Storage** (user-global, contract in `docs/contracts/settings/`, with fixtures)

A new `qinqin-core` row `nav-layout`:

```json
{ "version": 1, "phone": "bar", "bar": ["home", "flashcards", "reader", "search"] }
```

- `phone`: `"bar"` or `"drawer"`; anything else reads as `"bar"`.
- `bar`: section ids in order. Ids that are not visible (switched off, unknown, a removed plugin) are skipped,
  not deleted, so they return when the section is switched on again. Sections not listed go under More in
  frame order. Duplicates: the first wins.
- Missing row: the defaults above. Unknown keys are kept on write. A newer `version`: read leniently, never
  overwritten (as other rows do).

## Left to the builder

Exact sizes and label size, the More sheet's layout, how the keyboard case is handled, the reading-order
choice, whether Settings → Home is renamed, and the animation (if any) when switching sections.
